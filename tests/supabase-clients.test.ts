/**
 * Phase B1 — Supabase client foundation guards.
 *
 * Establishes (WITHOUT connecting to Supabase or touching the database):
 *   1. getConfig() never exposes SUPABASE_SECRET_KEY (even when it is set).
 *   2. The server-only secret accessor + admin client fail safely when the
 *      secret is absent, and resolve it only on the server.
 *   3. The admin/secret modules carry the `server-only` boundary and cannot
 *      enter a client bundle.
 *   4. Browser client modules never reference database URLs, service-role
 *      credentials, or server-only modules.
 *   5. Existing demo sessions still route exclusively to the in-memory sandbox.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// The real `server-only` package throws when imported outside a Server
// Component; tests simulate the server runtime by neutralizing that marker so
// the server modules can be imported here.
vi.mock("server-only", () => ({}));

import { getConfig } from "@/config/environment";
import { getSupabaseServerSecrets } from "@/server/config/secrets";
import { createAdminClient } from "@/server/supabase/admin";
import { demoSandbox, runtimeFor } from "@/server/runtime";
import { createDemoSession } from "@/server/session";
import { MemoryOrders } from "@/server/db/memory-store";
import { getEnv, setEnv } from "./helpers/env";

const ROOT = path.resolve(__dirname, "..");
function readSrc(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** Remove block + line comments so prose in JSDoc cannot trip token scans. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, "$1");
}

function importFroms(src: string): string[] {
  return Array.from(src.matchAll(/from\s+["']([^"']+)["']/g)).map((m) => m[1]!);
}

// Capture the real environment once; restore after the whole suite so no
// secret or URL is left mutated for other test files.
const ORIGINAL: Record<string, string | undefined> = {
  SUPABASE_SECRET_KEY: getEnv("SUPABASE_SECRET_KEY"),
  SUPABASE_URL: getEnv("SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_URL: getEnv("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: getEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
};
afterAll(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) setEnv(key, value);
});

// ---------------------------------------------------------------------------
describe("Phase B1 — getConfig never exposes the Supabase secret", () => {
  it("does not surface SUPABASE_SECRET_KEY even when it is set in the environment", () => {
    setEnv("SUPABASE_SECRET_KEY", "sb_secret_SENTINEL_VALUE");
    setEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    setEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_placeholder");

    const cfg = getConfig() as unknown as Record<string, unknown>;
    const serialized = JSON.stringify(cfg);

    expect(serialized).not.toContain("SENTINEL_VALUE");
    expect(serialized).not.toContain("SUPABASE_SECRET_KEY");
    expect(cfg).not.toHaveProperty("supabaseSecretKey");
    expect(cfg).not.toHaveProperty("serviceRoleKey");
    // The public publishable value is unaffected and never the secret.
    expect(cfg.supabasePublishableKey).toBe("sb_publishable_placeholder");
  });
});

// ---------------------------------------------------------------------------
describe("Phase B1 — server-only secret + admin client fail safely", () => {
  it("returns a null secret when SUPABASE_SECRET_KEY is absent", () => {
    setEnv("SUPABASE_SECRET_KEY", undefined);
    expect(getSupabaseServerSecrets().secretKey).toBeNull();
  });

  it("resolves the secret only on the server accessor (never in getConfig)", () => {
    setEnv("SUPABASE_SECRET_KEY", "sb_secret_present");
    expect(getSupabaseServerSecrets().secretKey).toBe("sb_secret_present");
    // Still not exposed through the public config.
    expect(JSON.stringify(getConfig())).not.toContain("sb_secret_present");
  });

  it("createAdminClient throws clearly when the secret is absent (no silent substitution)", () => {
    setEnv("SUPABASE_SECRET_KEY", undefined);
    setEnv("SUPABASE_URL", undefined);
    setEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    expect(() => createAdminClient()).toThrowError(/SUPABASE_SECRET_KEY/);
  });

  it("createAdminClient throws when the URL is absent even if the secret is present", () => {
    setEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    setEnv("SUPABASE_URL", undefined);
    setEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    expect(() => createAdminClient()).toThrowError(/SUPABASE_URL/);
  });

  it("createAdminClient returns a working client when both secret and URL are present", () => {
    setEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    setEnv("SUPABASE_URL", "https://fnvfdlsbednamrvnsrlm.supabase.co");
    const client = createAdminClient();
    expect(client).toBeTruthy();
    expect(typeof client.auth.admin.listUsers).toBe("function");
  });
});

// ---------------------------------------------------------------------------
describe("Phase B1 — admin/secret modules are server-only (client-bundle guard)", () => {
  const adminSrc = stripComments(readSrc("src/server/supabase/admin.ts"));
  const secretsSrc = stripComments(readSrc("src/server/config/secrets.ts"));
  const serverSrc = stripComments(readSrc("src/server/supabase/server.ts"));

  it("admin client imports the server-only boundary", () => {
    expect(readSrc("src/server/supabase/admin.ts")).toMatch(/import\s+["']server-only["']/);
  });

  it("server-only secret accessor imports the server-only boundary", () => {
    expect(readSrc("src/server/config/secrets.ts")).toMatch(/import\s+["']server-only["']/);
  });

  it("server cookie client imports the server-only boundary", () => {
    expect(readSrc("src/server/supabase/server.ts")).toMatch(/import\s+["']server-only["']/);
  });

  it("admin client never opts into the client boundary", () => {
    expect(readSrc("src/server/supabase/admin.ts")).not.toMatch(/["']client-only["']/);
  });

  it("admin client reads the privileged key only via the server-only accessor", () => {
    // The literal secret key name is centralized in the secrets module, not
    // re-read directly in the admin factory.
    expect(adminSrc).not.toMatch(/process\.env\[?["']SUPABASE_SECRET_KEY/);
    expect(secretsSrc).toMatch(/SUPABASE_SECRET_KEY/);
  });

  it("admin client imports only server-safe dependencies", () => {
    const allowed = (m: string) =>
      m === "server-only" || m === "@supabase/supabase-js" || m.startsWith("@/server/");
    for (const m of importFroms(adminSrc)) {
      expect(allowed(m), `unexpected admin import: ${m}`).toBe(true);
    }
  });

  it("server cookie client uses next/headers cookies + public keys only", () => {
    expect(serverSrc).toMatch(/next\/headers/);
    expect(serverSrc).toMatch(/createServerClient/);
    expect(serverSrc).not.toMatch(/SUPABASE_SECRET_KEY/);
    expect(serverSrc).not.toMatch(/DATABASE_URL|DIRECT_URL/);
  });
});

// ---------------------------------------------------------------------------
describe("Phase B1 — browser client is free of server secrets / DB / server modules", () => {
  const clientSrc = stripComments(readSrc("src/lib/supabase/client.ts"));

  it("does not reference database URLs or service-role credentials", () => {
    expect(clientSrc).not.toMatch(/DATABASE_URL|DIRECT_URL|POSTGRES_URL/);
    expect(clientSrc).not.toMatch(/SUPABASE_SECRET_KEY/i);
    expect(clientSrc).not.toMatch(/service[-_ ]?role/i);
  });

  it("does not import server-only markers or any @/server module", () => {
    expect(clientSrc).not.toMatch(/["']server-only["']/);
    expect(importFroms(clientSrc).some((m) => m.startsWith("@/server/"))).toBe(false);
  });

  it("uses only the public project URL + publishable key via getConfig", () => {
    expect(clientSrc).toMatch(/getConfig/);
    expect(clientSrc).toMatch(/createBrowserClient/);
    expect(importFroms(clientSrc)).toContain("@supabase/ssr");
  });
});

// ---------------------------------------------------------------------------
describe("Phase B1 — demo sessions still route to the in-memory sandbox", () => {
  it("routes a demo session exclusively to the in-memory sandbox (never Prisma)", () => {
    const session = createDemoSession({
      userId: "usr_demo_owner",
      role: "owner",
      email: "owner@hansan.local",
    });
    expect(session.mode).toBe("demo");
    expect(session.dataScope).toBe("DEMO");

    const runtime = runtimeFor(session);
    expect(runtime).not.toBeNull();
    expect(runtime!.scope).toBe("DEMO");
    expect(runtime!.orders).toBeInstanceOf(MemoryOrders);
  });

  it("the demo sandbox uses memory adapters and DEMO scope", () => {
    const sandbox = demoSandbox();
    expect(sandbox.scope).toBe("DEMO");
    expect(sandbox.orders).toBeInstanceOf(MemoryOrders);
  });
});


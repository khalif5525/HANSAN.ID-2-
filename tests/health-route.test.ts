import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { setEnv } from "./helpers/env";

const DB_KEY = "DATABASE_URL";
const SUPABASE_URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";
const SUPABASE_KEY = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

describe("health route", () => {
  beforeEach(() => {
    setEnv(DB_KEY, undefined);
    setEnv(SUPABASE_URL_KEY, undefined);
    setEnv(SUPABASE_KEY, undefined);
  });

  afterEach(() => {
    setEnv(DB_KEY, undefined);
    setEnv(SUPABASE_URL_KEY, undefined);
    setEnv(SUPABASE_KEY, undefined);
  });

  it("reports not-configured states by default", async () => {
    const res = await GET();
    const json = (await res.json()) as { status: string; integrations: Record<string, string> };
    expect(json.status).toBe("ok");
    expect(json.integrations.database).toBe("not-configured");
    expect(json.integrations.auth).toBe("development-only-planned");
    expect(json.integrations.payments).toBe("not-configured");
  });

  it("reports configured when required env vars are present", async () => {
    setEnv(DB_KEY, "postgresql://user@host:6543/postgres");
    setEnv(SUPABASE_URL_KEY, "https://example.supabase.co");
    setEnv(SUPABASE_KEY, "sb_publishable_placeholder");

    const res = await GET();
    const json = (await res.json()) as { status: string; integrations: Record<string, string> };
    expect(json.status).toBe("ok");
    expect(json.integrations.database).toBe("configured");
    expect(json.integrations.auth).toBe("configured");
  });
});
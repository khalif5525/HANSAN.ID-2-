/**
 * Phase B2 — live session issuance + membership gating.
 *
 * Uses MOCKED Supabase + Prisma dependencies only. No network, no database.
 * Covers: happy-path issuance, every rejection path, deterministic multi-
 * membership resolution, forged-field rejection, fail-closed secret handling,
 * and continued demo-sandbox isolation.
 */
import { describe, expect, it, vi } from "vitest";

// The real `server-only` package throws outside a Server Component.
vi.mock("server-only", () => ({}));

// File-wide mocks for the ROUTE test (the service tests inject their own deps).
vi.mock("@/server/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/server/db/client", () => ({ getPrisma: vi.fn() }));

import { createClient as mockCreateClient } from "@/server/supabase/server";
import { getPrisma as mockGetPrisma } from "@/server/db/client";
import {
  resolveLiveActor,
  establishLiveSession,
  type LiveSessionDb,
  type LiveSessionMembershipRow,
  type LiveSessionOutletRow,
  type LiveSessionUserRow,
} from "@/server/auth/live-session";
import {
  createDemoSession,
  getSessionSecret,
  SESSION_COOKIE,
  verifySession,
} from "@/server/session";
import { demoSandbox, runtimeFor } from "@/server/runtime";
import { MemoryOrders } from "@/server/db/memory-store";
import { POST as liveSignIn } from "@/app/api/auth/live/route";
import { setEnv } from "./helpers/env";

const TEST_SECRET = "test-secret-at-least-32-characters-long!!";

function makeDb(opts: {
  user?: LiveSessionUserRow | null;
  memberships?: LiveSessionMembershipRow[];
  outlets?: LiveSessionOutletRow[];
}): { db: LiveSessionDb; authSubjects: string[] } {
  const authSubjects: string[] = [];
  const db: LiveSessionDb = {
    user: {
      findUnique: async ({ where }) => {
        authSubjects.push(where.authSubject);
        return opts.user ?? null;
      },
    },
    membership: { findMany: async () => opts.memberships ?? [] },
    outlet: { findMany: async () => opts.outlets ?? [] },
  };
  return { db, authSubjects };
}

const ACTIVE_USER: LiveSessionUserRow = { id: "usr_owner1", email: "owner@acme.test", active: true };

function ownerMembership(overrides: Partial<LiveSessionMembershipRow> = {}): LiveSessionMembershipRow {
  return {
    organizationId: "ten_acme",
    role: "OWNER",
    outletId: null,
    organization: { id: "ten_acme", active: true },
    outlet: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
describe("Phase B2 — resolveLiveActor (membership gating)", () => {
  it("resolves an active owner (null outlet => all active org outlets, sorted)", async () => {
    const { db, authSubjects } = makeDb({
      user: ACTIVE_USER,
      memberships: [ownerMembership()],
      outlets: [{ id: "out_b" }, { id: "out_a" }],
    });
    const resolved = await resolveLiveActor(db, "sb_sub_owner");
    expect(resolved).toEqual({
      userId: "usr_owner1",
      email: "owner@acme.test",
      role: "owner",
      tenantId: "ten_acme",
      outletIds: ["out_a", "out_b"],
    });
    // Lookup is by the verified Supabase subject, never a client-supplied id.
    expect(authSubjects).toEqual(["sb_sub_owner"]);
  });

  it("rejects an unknown authSubject (no linked HANSAN user)", async () => {
    const { db } = makeDb({ user: null });
    await expect(resolveLiveActor(db, "sb_sub_unknown")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
    });
  });

  it("rejects an inactive user", async () => {
    const { db } = makeDb({ user: { ...ACTIVE_USER, active: false }, memberships: [ownerMembership()] });
    await expect(resolveLiveActor(db, "sb_sub_owner")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("rejects a user with no active membership (no default Owner/Developer)", async () => {
    const { db } = makeDb({ user: ACTIVE_USER, memberships: [] });
    await expect(resolveLiveActor(db, "sb_sub_owner")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects when the organization is inactive", async () => {
    const { db } = makeDb({
      user: ACTIVE_USER,
      memberships: [ownerMembership({ organization: { id: "ten_acme", active: false } })],
    });
    await expect(resolveLiveActor(db, "sb_sub_owner")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an inactive referenced outlet", async () => {
    const { db } = makeDb({
      user: ACTIVE_USER,
      memberships: [
        ownerMembership({
          role: "POS",
          outletId: "out_x",
          outlet: { id: "out_x", organizationId: "ten_acme", active: false },
        }),
      ],
    });
    await expect(resolveLiveActor(db, "sb_sub_owner")).rejects.toMatchObject({ code: "OUTLET_MISMATCH" });
  });

  it("rejects an outlet that belongs to a different organization", async () => {
    const { db } = makeDb({
      user: ACTIVE_USER,
      memberships: [
        ownerMembership({
          role: "POS",
          outletId: "out_x",
          outlet: { id: "out_x", organizationId: "ten_other", active: true },
        }),
      ],
    });
    await expect(resolveLiveActor(db, "sb_sub_owner")).rejects.toMatchObject({ code: "OUTLET_MISMATCH" });
  });

  it("rejects a membership whose referenced outlet row is missing", async () => {
    const { db } = makeDb({
      user: ACTIVE_USER,
      memberships: [ownerMembership({ role: "POS", outletId: "out_gone", outlet: null })],
    });
    await expect(resolveLiveActor(db, "sb_sub_owner")).rejects.toMatchObject({ code: "OUTLET_MISMATCH" });
  });

  it("rejects an outlet-scoped role when the org has no active outlets", async () => {
    const { db } = makeDb({
      user: ACTIVE_USER,
      memberships: [ownerMembership({ role: "POS", outletId: null })],
      outlets: [],
    });
    await expect(resolveLiveActor(db, "sb_sub_owner")).rejects.toMatchObject({ code: "OUTLET_MISMATCH" });
  });

  it("allows an owner with zero outlets (owner/finance bypass outlet checks)", async () => {
    const { db } = makeDb({ user: ACTIVE_USER, memberships: [ownerMembership()], outlets: [] });
    const resolved = await resolveLiveActor(db, "sb_sub_owner");
    expect(resolved.role).toBe("owner");
    expect(resolved.outletIds).toEqual([]);
  });

  it("resolves same-role multi-outlet memberships deterministically (union, sorted)", async () => {
    const { db } = makeDb({
      user: ACTIVE_USER,
      memberships: [
        ownerMembership({ role: "POS", outletId: "out_2", outlet: { id: "out_2", organizationId: "ten_acme", active: true } }),
        ownerMembership({ role: "POS", outletId: "out_1", outlet: { id: "out_1", organizationId: "ten_acme", active: true } }),
      ],
    });
    const resolved = await resolveLiveActor(db, "sb_sub_owner");
    expect(resolved.role).toBe("pos");
    expect(resolved.outletIds).toEqual(["out_1", "out_2"]);
  });

  it("fails closed on multiple distinct roles (no silent merge)", async () => {
    const { db } = makeDb({
      user: ACTIVE_USER,
      memberships: [ownerMembership({ role: "OWNER" }), ownerMembership({ role: "FINANCE" })],
    });
    await expect(resolveLiveActor(db, "sb_sub_owner")).rejects.toMatchObject({
      code: "MEMBERSHIP_AMBIGUOUS",
    });
  });

  it("fails closed on memberships across multiple organizations", async () => {
    const { db } = makeDb({
      user: ACTIVE_USER,
      memberships: [
        ownerMembership({ organizationId: "ten_a", organization: { id: "ten_a", active: true } }),
        ownerMembership({ organizationId: "ten_b", organization: { id: "ten_b", active: true } }),
      ],
    });
    await expect(resolveLiveActor(db, "sb_sub_owner")).rejects.toMatchObject({
      code: "MEMBERSHIP_AMBIGUOUS",
    });
  });
});

// ---------------------------------------------------------------------------
describe("Phase B2 — establishLiveSession (issuance)", () => {
  const ownerDb = () =>
    makeDb({ user: ACTIVE_USER, memberships: [ownerMembership()], outlets: [{ id: "out_a" }] }).db;
  const identity = { id: "sb_sub_owner", email: "owner@acme.test" };

  it("issues a signed live session (mode live, dataScope PRODUCTION) that verifies", async () => {
    const { payload, token } = await establishLiveSession({
      db: ownerDb(),
      getUser: async () => identity,
      secret: TEST_SECRET,
    });
    expect(payload.mode).toBe("live");
    expect(payload.dataScope).toBe("PRODUCTION");
    expect(payload.sub).toBe("usr_owner1");
    expect(payload.role).toBe("owner");
    expect(payload.tenantId).toBe("ten_acme");
    expect(await verifySession(token, TEST_SECRET)).toEqual(payload);
  });

  it("rejects a tampered live token (role escalation attempt)", async () => {
    const { token } = await establishLiveSession({ db: ownerDb(), getUser: async () => identity, secret: TEST_SECRET });
    const parts = token.split(".");
    const forged = JSON.parse(Buffer.from(parts[1]!, "base64url").toString()) as Record<string, unknown>;
    forged.role = "developer";
    forged.dataScope = "DEMO";
    const forgedBody = Buffer.from(JSON.stringify(forged)).toString("base64url");
    expect(await verifySession(`v1.${forgedBody}.${parts[2]}`, TEST_SECRET)).toBeNull();
  });

  it("cannot issue when Supabase returns no identity", async () => {
    await expect(
      establishLiveSession({ db: ownerDb(), getUser: async () => null, secret: TEST_SECRET }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("cannot issue for an identity with no linked HANSAN user", async () => {
    await expect(
      establishLiveSession({ db: makeDb({ user: null }).db, getUser: async () => identity, secret: TEST_SECRET }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("fails closed with AUTH_NOT_CONFIGURED when the signing secret is missing", async () => {
    await expect(
      establishLiveSession({ db: ownerDb(), getUser: async () => identity, secret: null }),
    ).rejects.toMatchObject({ code: "AUTH_NOT_CONFIGURED", status: 503 });
  });

  it("never issues a token when a membership check fails", async () => {
    const db = makeDb({ user: ACTIVE_USER, memberships: [] }).db;
    await expect(
      establishLiveSession({ db, getUser: async () => identity, secret: TEST_SECRET }),
    ).rejects.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("Phase B2 — demo isolation is preserved", () => {
  it("demo sessions still route exclusively to the in-memory sandbox", () => {
    const demo = createDemoSession({ userId: "usr_demo_owner", role: "owner", email: "owner@hansan.local" });
    const runtime = runtimeFor(demo);
    expect(runtime).not.toBeNull();
    expect(runtime!.scope).toBe("DEMO");
    expect(runtime!.orders).toBeInstanceOf(MemoryOrders);
    expect(runtime).toBe(demoSandbox());
  });

  it("a live session never resolves to the demo sandbox", () => {
    // getPrisma is mocked to null here => live routing fails closed, never demo.
    vi.mocked(mockGetPrisma).mockReturnValue(null);
    const live = {
      v: 1 as const,
      mode: "live" as const,
      sub: "usr_owner1",
      role: "owner" as const,
      email: "owner@acme.test",
      tenantId: "ten_acme",
      outletIds: ["out_a"],
      dataScope: "PRODUCTION" as const,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    expect(runtimeFor(live)).not.toBe(demoSandbox());
  });
});

// ---------------------------------------------------------------------------
describe("Phase B2 — POST /api/auth/live endpoint", () => {
  const fakeDb = makeDb({
    user: ACTIVE_USER,
    memberships: [ownerMembership()],
    outlets: [{ id: "out_a" }],
  }).db;

  function mockSupabase(user: { id: string; email: string } | null) {
    vi.mocked(mockCreateClient).mockReturnValue({
      auth: {
        getUser: async () =>
          user
            ? { data: { user }, error: null }
            : { data: { user: null }, error: new Error("no session") },
      },
    } as unknown as ReturnType<typeof mockCreateClient>);
  }

  it("ignores forged body fields and derives the session from the database", async () => {
    vi.mocked(mockGetPrisma).mockReturnValue(fakeDb as unknown as ReturnType<typeof mockGetPrisma>);
    mockSupabase({ id: "sb_sub_owner", email: "owner@acme.test" });

    // Attacker tries to inject identity/role/tenant/outlets via the body.
    const forgedBody = JSON.stringify({
      userId: "usr_attacker",
      role: "developer",
      tenantId: "ten_evil",
      outletIds: ["out_evil"],
    });
    const res = await liveSignIn(
      new Request("http://localhost/api/auth/live", { method: "POST", body: forgedBody }),
    );
    expect(res.status).toBe(200);

    const token = res.cookies.get(SESSION_COOKIE)?.value;
    expect(token).toBeTruthy();
    const secret = getSessionSecret().secret;
    const verified = await verifySession(token, secret);
    expect(verified?.mode).toBe("live");
    expect(verified?.sub).toBe("usr_owner1"); // from DB, not the forged userId
    expect(verified?.role).toBe("owner"); // from DB, not the forged role
    expect(verified?.tenantId).toBe("ten_acme"); // from DB, not the forged tenant
    expect(verified?.outletIds).toEqual(["out_a"]);
  });

  it("returns 401 and sets no cookie when Supabase has no identity", async () => {
    vi.mocked(mockGetPrisma).mockReturnValue(fakeDb as unknown as ReturnType<typeof mockGetPrisma>);
    mockSupabase(null);
    const res = await liveSignIn(new Request("http://localhost/api/auth/live", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBeFalsy();
  });

  it("returns 503 when persistence is not configured", async () => {
    vi.mocked(mockGetPrisma).mockReturnValue(null);
    mockSupabase({ id: "sb_sub_owner", email: "owner@acme.test" });
    const res = await liveSignIn(new Request("http://localhost/api/auth/live", { method: "POST" }));
    expect(res.status).toBe(503);
  });

  it("fails closed with 503 in production when SESSION_SECRET is missing", async () => {
    const prevSecret = process.env.SESSION_SECRET;
    const prevEnv = process.env.NODE_ENV;
    try {
      setEnv("SESSION_SECRET", "");
      setEnv("NODE_ENV", "production");
      vi.mocked(mockGetPrisma).mockReturnValue(fakeDb as unknown as ReturnType<typeof mockGetPrisma>);
      mockSupabase({ id: "sb_sub_owner", email: "owner@acme.test" });
      const res = await liveSignIn(new Request("http://localhost/api/auth/live", { method: "POST" }));
      expect(res.status).toBe(503);
      expect(res.cookies.get(SESSION_COOKIE)?.value).toBeFalsy();
    } finally {
      setEnv("SESSION_SECRET", prevSecret);
      setEnv("NODE_ENV", prevEnv);
    }
  });
});




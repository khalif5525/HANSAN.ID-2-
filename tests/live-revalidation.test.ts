/**
 * Phase B3 — live session revalidation & revocation.
 *
 * Mocked Supabase + Prisma only. No network, no database. Covers: the
 * revalidation core (inactive user/org/membership/outlet, tenant/outlet/role
 * drift, missing/invalid/inconsistent Supabase identity), fail-closed behavior,
 * sign-out revocation, CSRF/origin, and preserved demo isolation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// server-only throws outside a Server Component; neutralize it. The Supabase
// server client + Prisma getPrisma are mocked so no real network/DB is touched.
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getPrisma: vi.fn() }));
vi.mock("@/server/supabase/server", () => ({ createClient: vi.fn() }));

import { getPrisma } from "@/server/db/client";
import { createClient } from "@/server/supabase/server";
import { revalidateLiveSession, requireRevalidatedLiveContext } from "@/server/auth/revalidate";
import {
  getSessionSecret,
  signSession,
  SESSION_COOKIE,
  createDemoSession,
  type SessionPayload,
} from "@/server/session";
import { runtimeFor, demoSandbox } from "@/server/runtime";
import { MemoryOrders } from "@/server/db/memory-store";
import { POST as signOutRoute } from "@/app/api/auth/signout/route";
import { POST as ordersPost } from "@/app/api/orders/route";
import { POST as liveSignIn } from "@/app/api/auth/live/route";
import type {
  LiveSessionDb,
  LiveSessionMembershipRow,
  LiveSessionOutletRow,
  LiveSessionUserRow,
} from "@/server/auth/live-session";
import { setEnv } from "./helpers/env";

afterEach(() => {
  vi.mocked(getPrisma).mockReset();
  vi.mocked(createClient).mockReset();
});

function liveSession(overrides: Partial<SessionPayload> = {}): SessionPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    v: 1,
    mode: "live",
    sub: "usr_owner1",
    role: "owner",
    email: "owner@acme.test",
    tenantId: "ten_acme",
    outletIds: ["out_a"],
    dataScope: "PRODUCTION",
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
}

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

function identityAs(id: string, email: string | null = "owner@acme.test") {
  return { id, email };
}

// ---------------------------------------------------------------------------
describe("Phase B3 — revalidateLiveSession (request-time core)", () => {
  it("returns the CURRENT actor for a valid identity + active membership", async () => {
    const { db, authSubjects } = makeDb({
      user: ACTIVE_USER,
      memberships: [ownerMembership()],
      outlets: [{ id: "out_a" }],
    });
    const actor = await revalidateLiveSession(liveSession(), {
      db,
      getUser: async () => identityAs("sb_sub_owner"),
    });
    expect(actor).toEqual({ userId: "usr_owner1", role: "owner", tenantId: "ten_acme", outletIds: ["out_a"] });
    expect(authSubjects).toEqual(["sb_sub_owner"]);
  });

  it("rejects when the Supabase identity is missing / refresh failed", async () => {
    const { db } = makeDb({ user: ACTIVE_USER, memberships: [ownerMembership()] });
    await expect(
      revalidateLiveSession(liveSession(), { db, getUser: async () => null }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  it("rejects an unknown authSubject (no linked HANSAN user)", async () => {
    const { db } = makeDb({ user: null });
    await expect(
      revalidateLiveSession(liveSession(), { db, getUser: async () => identityAs("sb_sub_unknown") }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("rejects an inactive User after issuance", async () => {
    const { db } = makeDb({ user: { ...ACTIVE_USER, active: false }, memberships: [ownerMembership()] });
    await expect(
      revalidateLiveSession(liveSession(), { db, getUser: async () => identityAs("sb_sub_owner") }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("rejects when the Membership was deactivated (no active membership)", async () => {
    const { db } = makeDb({ user: ACTIVE_USER, memberships: [] });
    await expect(
      revalidateLiveSession(liveSession(), { db, getUser: async () => identityAs("sb_sub_owner") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects when the Organization was deactivated", async () => {
    const { db } = makeDb({
      user: ACTIVE_USER,
      memberships: [ownerMembership({ organization: { id: "ten_acme", active: false } })],
    });
    await expect(
      revalidateLiveSession(liveSession(), { db, getUser: async () => identityAs("sb_sub_owner") }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects when a granted Outlet was deactivated", async () => {
    const { db } = makeDb({
      user: ACTIVE_USER,
      memberships: [
        ownerMembership({ role: "POS", outletId: "out_x", outlet: { id: "out_x", organizationId: "ten_acme", active: false } }),
      ],
    });
    await expect(
      revalidateLiveSession(liveSession(), { db, getUser: async () => identityAs("sb_sub_owner") }),
    ).rejects.toMatchObject({ code: "OUTLET_MISMATCH" });
  });

  it("rejects an Outlet that now belongs to a different organization", async () => {
    const { db } = makeDb({
      user: ACTIVE_USER,
      memberships: [
        ownerMembership({ role: "POS", outletId: "out_x", outlet: { id: "out_x", organizationId: "ten_other", active: true } }),
      ],
    });
    await expect(
      revalidateLiveSession(liveSession(), { db, getUser: async () => identityAs("sb_sub_owner") }),
    ).rejects.toMatchObject({ code: "OUTLET_MISMATCH" });
  });
});

describe("Phase B3 — revalidateLiveSession (identity/tenant/drift)", () => {
  it("rejects when the Supabase identity maps to a DIFFERENT HANSAN user than the session", async () => {
    // Authenticated identity is sb_sub_other -> usr_other, but the session sub is usr_owner1.
    const { db } = makeDb({
      user: { id: "usr_other", email: "other@acme.test", active: true },
      memberships: [ownerMembership()],
      outlets: [{ id: "out_a" }],
    });
    await expect(
      revalidateLiveSession(liveSession(), { db, getUser: async () => identityAs("sb_sub_other") }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("rejects when the session tenant no longer matches the active organization", async () => {
    const { db } = makeDb({ user: ACTIVE_USER, memberships: [ownerMembership()], outlets: [{ id: "out_a" }] });
    await expect(
      revalidateLiveSession(liveSession({ tenantId: "ten_old" }), {
        db,
        getUser: async () => identityAs("sb_sub_owner"),
      }),
    ).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
  });

  it("fails closed on multi-organization membership", async () => {
    const { db } = makeDb({
      user: ACTIVE_USER,
      memberships: [
        ownerMembership({ organizationId: "ten_a", organization: { id: "ten_a", active: true } }),
        ownerMembership({ organizationId: "ten_b", organization: { id: "ten_b", active: true } }),
      ],
    });
    await expect(
      revalidateLiveSession(liveSession(), { db, getUser: async () => identityAs("sb_sub_owner") }),
    ).rejects.toMatchObject({ code: "MEMBERSHIP_AMBIGUOUS" });
  });

  it("does NOT trust the cookie role — reflects the CURRENT database role", async () => {
    const { db } = makeDb({ user: ACTIVE_USER, memberships: [ownerMembership({ role: "OWNER" })], outlets: [{ id: "out_a" }] });
    const actor = await revalidateLiveSession(liveSession({ role: "pos" }), {
      db,
      getUser: async () => identityAs("sb_sub_owner"),
    });
    expect(actor.role).toBe("owner");
  });

  it("does NOT trust the cookie outlets — reflects the CURRENT database outlets", async () => {
    const { db } = makeDb({ user: ACTIVE_USER, memberships: [ownerMembership()], outlets: [{ id: "out_new" }] });
    const actor = await revalidateLiveSession(liveSession({ outletIds: ["out_old"] }), {
      db,
      getUser: async () => identityAs("sb_sub_owner"),
    });
    expect(actor.outletIds).toEqual(["out_new"]);
  });

  it("refuses to revalidate a non-live (demo) session", async () => {
    const demo = createDemoSession({ userId: "usr_demo", role: "owner", email: "d@hansan.local" });
    await expect(
      revalidateLiveSession(demo, { db: makeDb({}).db, getUser: async () => null }),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

// ---------------------------------------------------------------------------
describe("Phase B3 — requireRevalidatedLiveContext (route helper)", () => {
  it("fails closed with 503 when persistence is unavailable", async () => {
    vi.mocked(getPrisma).mockReturnValue(null);
    await expect(requireRevalidatedLiveContext(liveSession())).rejects.toMatchObject({
      code: "PERSISTENCE_NOT_CONFIGURED",
      status: 503,
    });
  });

  it("returns the revalidated context when identity + membership are valid", async () => {
    const { db } = makeDb({ user: ACTIVE_USER, memberships: [ownerMembership()], outlets: [{ id: "out_a" }] });
    vi.mocked(getPrisma).mockReturnValue(db as unknown as ReturnType<typeof getPrisma>);
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: "sb_sub_owner", email: "owner@acme.test" } }, error: null }) },
    } as unknown as ReturnType<typeof createClient>);
    const ctx = await requireRevalidatedLiveContext(liveSession());
    expect(ctx.actor).toEqual({ userId: "usr_owner1", role: "owner", tenantId: "ten_acme", outletIds: ["out_a"] });
    expect(ctx.session.mode).toBe("live");
  });

  it("fails closed (401) when the Supabase identity is gone", async () => {
    const { db } = makeDb({ user: ACTIVE_USER, memberships: [ownerMembership()], outlets: [{ id: "out_a" }] });
    vi.mocked(getPrisma).mockReturnValue(db as unknown as ReturnType<typeof getPrisma>);
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: new Error("no session") }) },
    } as unknown as ReturnType<typeof createClient>);
    await expect(requireRevalidatedLiveContext(liveSession())).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

// ---------------------------------------------------------------------------
describe("Phase B3 — orders route revalidates live sessions before writing", () => {
  it("fails closed (401) when a live session's Supabase identity is gone", async () => {
    const secret = getSessionSecret().secret!;
    const token = (await signSession(liveSession({ role: "owner" }), secret))!;
    // A non-null db makes runtimeFor(live) PRODUCTION so revalidation is reached.
    vi.mocked(getPrisma).mockReturnValue({} as unknown as ReturnType<typeof getPrisma>);
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: new Error("revoked") }) },
    } as unknown as ReturnType<typeof createClient>);
    const res = await ordersPost(
      new Request("http://localhost/api/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "k-reval",
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
        },
        body: JSON.stringify({ orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("uses the REVALIDATED role for the permission gate (a downgrade is denied)", async () => {
    const secret = getSessionSecret().secret!;
    // Cookie claims owner, but the DB now grants only KDS.
    const token = (await signSession(liveSession({ role: "owner" }), secret))!;
    const { db } = makeDb({
      user: ACTIVE_USER,
      memberships: [
        ownerMembership({ role: "KDS", outletId: "out_a", outlet: { id: "out_a", organizationId: "ten_acme", active: true } }),
      ],
    });
    vi.mocked(getPrisma).mockReturnValue(db as unknown as ReturnType<typeof getPrisma>);
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: "sb_sub_owner", email: "owner@acme.test" } }, error: null }) },
    } as unknown as ReturnType<typeof createClient>);
    const res = await ordersPost(
      new Request("http://localhost/api/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "k-downgrade",
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
        },
        body: JSON.stringify({ orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] }),
      }),
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("ROLE_NOT_PERMITTED");
  });
});

// ---------------------------------------------------------------------------
describe("Phase B3 — sign-out revocation", () => {
  it("clears the HANSAN cookie AND revokes the Supabase session", async () => {
    const secret = getSessionSecret().secret!;
    const token = (await signSession(
      createDemoSession({ userId: "usr_demo_owner", role: "owner", email: "o@hansan.local" }),
      secret,
    ))!;
    const signOutMock = vi.fn(async () => ({ error: null }));
    vi.mocked(createClient).mockReturnValue({ auth: { signOut: signOutMock } } as unknown as ReturnType<typeof createClient>);

    const res = await signOutRoute(
      new Request("http://localhost/api/auth/signout", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBeFalsy(); // HANSAN cookie cleared
    expect(signOutMock).toHaveBeenCalledTimes(1); // Supabase session revoked
  });

  it("still clears the HANSAN cookie when Supabase revocation throws", async () => {
    const signOutMock = vi.fn(async () => {
      throw new Error("supabase unreachable");
    });
    vi.mocked(createClient).mockReturnValue({ auth: { signOut: signOutMock } } as unknown as ReturnType<typeof createClient>);
    const res = await signOutRoute(new Request("http://localhost/api/auth/signout", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(res.cookies.get(SESSION_COOKIE)?.value).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
describe("Phase B3 — CSRF/origin on cookie-authenticated state-changing routes", () => {
  it("orders POST rejects a cross-origin request (403)", async () => {
    const secret = getSessionSecret().secret!;
    const token = (await signSession(
      createDemoSession({ userId: "usr_pos", role: "pos", email: "p@hansan.local" }),
      secret,
    ))!;
    const res = await ordersPost(
      new Request("http://localhost/api/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "k-csrf",
          origin: "https://evil.example",
          cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
        },
        body: JSON.stringify({ orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("live sign-in rejects a cross-origin request (403)", async () => {
    const res = await liveSignIn(
      new Request("http://localhost/api/auth/live", { method: "POST", headers: { origin: "https://evil.example" } }),
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe("Phase B3 — demo isolation preserved", () => {
  it("demo sessions still route to the in-memory sandbox and skip revalidation", () => {
    const demo = createDemoSession({ userId: "usr_demo_owner", role: "owner", email: "o@hansan.local" });
    const runtime = runtimeFor(demo);
    expect(runtime!.scope).toBe("DEMO");
    expect(runtime!.orders).toBeInstanceOf(MemoryOrders);
    expect(runtime).toBe(demoSandbox());
  });

  it("a live session never resolves to the demo sandbox", () => {
    vi.mocked(getPrisma).mockReturnValue(null);
    expect(runtimeFor(liveSession())).not.toBe(demoSandbox());
  });
});





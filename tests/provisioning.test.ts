/**
 * Phase 4 — Owner / staff / Developer provisioning.
 *
 * Mocked admin + Prisma ports only: NO network, NO database, NO real Supabase
 * project, NO real credentials. Covers first-Owner bootstrap atomicity +
 * compensating delete, idempotent repeat runs, staff-invitation tenant scoping
 * (owner-org only; POS/KDS require outlets; Developer never invitable),
 * Developer provisioning without business membership, the Bearer secret gate
 * (fail closed), and route-level secret/origin/session wiring.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// The real `server-only` package throws outside a Server Component.
vi.mock("server-only", () => ({}));
vi.mock("@/server/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/server/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/server/db/client", () => ({ getPrisma: vi.fn() }));

import { createAdminClient } from "@/server/supabase/admin";
import { createClient } from "@/server/supabase/server";
import { getPrisma } from "@/server/db/client";
import {
  inviteStaff,
  provisionDeveloper,
  provisionOwner,
  type InviteStaffInput,
  type OrgRoleValue,
  type ProvisioningAdmin,
  type ProvisioningDb,
  type ProvisioningTx,
} from "@/server/auth/provisioning";
import type { LiveSessionMembershipRow, LiveSessionUserRow } from "@/server/auth/live-session";
import { assertProvisionSecret } from "@/server/auth/admin-guard";
import { ERROR_CODES } from "@/domain/shared/errors";
import { POST as postProvisionOwner } from "@/app/api/admin/provision-owner/route";
import { POST as postProvisionDeveloper } from "@/app/api/admin/provision-developer/route";
import { POST as postStaffInvite } from "@/app/api/staff/invite/route";
import {
  createDemoSession,
  getSessionSecret,
  signSession,
  SESSION_COOKIE,
  type SessionPayload,
} from "@/server/session";
import { setEnv } from "./helpers/env";

// ---------------------------------------------------------------------------
// In-memory Prisma port: implements the structural ProvisioningDb with
// snapshot/rollback so a thrown error behaves like a rolled-back transaction.
// ---------------------------------------------------------------------------
interface StoreOrg { id: string; name: string; slug: string; dataScope: "PRODUCTION" | "DEMO"; active: boolean }
interface StoreOutlet { id: string; organizationId: string; name: string; active: boolean }
interface StoreUser { id: string; authSubject: string; email: string; displayName: string; active: boolean }
interface StoreMembership { id: string; userId: string; organizationId: string; outletId: string | null; role: OrgRoleValue; active: boolean }
interface Store {
  orgs: StoreOrg[];
  outlets: StoreOutlet[];
  users: StoreUser[];
  memberships: StoreMembership[];
  /** Set to a model name to make its next `create` throw (simulated DB failure). */
  failCreate?: "organization" | "outlet" | "user" | "membership";
}

function emptyStore(): Store {
  return { orgs: [], outlets: [], users: [], memberships: [] };
}

function makeDb(store: Store): { db: ProvisioningDb } {
  const tx: ProvisioningTx = {
    organization: {
      create: async ({ data }) => {
        if (store.failCreate === "organization") { store.failCreate = undefined; throw new Error("simulated organization failure"); }
        store.orgs.push({ ...data });
        return { id: data.id };
      },
      findUnique: async ({ where }) =>
        (where.slug ? store.orgs.find((o) => o.slug === where.slug) : store.orgs.find((o) => o.id === where.id)) ?? null,
    },
    outlet: {
      create: async ({ data }) => {
        if (store.failCreate === "outlet") { store.failCreate = undefined; throw new Error("simulated outlet failure"); }
        store.outlets.push({ ...data });
        return { id: data.id };
      },
      findMany: async ({ where }) =>
        store.outlets.filter(
          (o) => o.organizationId === where.organizationId && (where.active === undefined || o.active === where.active),
        ),
    },
    user: {
      findUnique: async ({ where }) => {
        const row = where.email
          ? store.users.find((u) => u.email === where.email)
          : store.users.find((u) => u.authSubject === where.authSubject);
        return row ? { id: row.id, active: row.active } : null;
      },
      create: async ({ data }) => {
        if (store.failCreate === "user") { store.failCreate = undefined; throw new Error("simulated user failure"); }
        store.users.push({ ...data });
        return { id: data.id };
      },
    },
    membership: {
      create: async ({ data }) => {
        if (store.failCreate === "membership") { store.failCreate = undefined; throw new Error("simulated membership failure"); }
        const id = `mbr_${store.memberships.length + 1}`;
        store.memberships.push({ id, ...data });
        return { id };
      },
    },
  };

  const db: ProvisioningDb = {
    $transaction: async <T>(fn: (t: ProvisioningTx) => Promise<T>): Promise<T> => {
      const snapshot = {
        orgs: [...store.orgs],
        outlets: [...store.outlets],
        users: [...store.users],
        memberships: [...store.memberships],
      };
      try {
        return await fn(tx);
      } catch (error) {
        store.orgs = snapshot.orgs;
        store.outlets = snapshot.outlets;
        store.users = snapshot.users;
        store.memberships = snapshot.memberships;
        throw error;
      }
    },
  };
  return { db };
}

// Mocked Supabase admin port: records every call; no network.
function makeAdmin(opts: { createUserError?: string; inviteError?: string } = {}) {
  const calls = {
    created: [] as Array<{ email: string; password: string; email_confirm: boolean; app_metadata?: Record<string, unknown> }>,
    invited: [] as Array<{ email: string }>,
    deleted: [] as string[],
  };
  const admin: ProvisioningAdmin = {
    auth: {
      admin: {
        createUser: async (a) => {
          if (opts.createUserError) return { data: { user: null }, error: { message: opts.createUserError } };
          calls.created.push(a);
          return { data: { user: { id: `sb_created_${calls.created.length}`, email: a.email } }, error: null };
        },
        inviteUserByEmail: async (email) => {
          if (opts.inviteError) return { data: { user: null }, error: { message: opts.inviteError } };
          calls.invited.push({ email });
          return { data: { user: { id: `sb_invited_${calls.invited.length}`, email } }, error: null };
        },
        deleteUser: async (uid) => {
          calls.deleted.push(uid);
          return { error: null };
        },
      },
    },
  };
  return { admin, calls };
}

const OWNER_INPUT = {
  email: "owner@acme.test",
  password: "sup3r-secret-pw",
  organizationName: "Acme Foods",
  organizationSlug: "acme-foods",
  outletName: "Main Counter",
};

// ---------------------------------------------------------------------------
describe("Phase 4 — provisionOwner (first-Owner bootstrap)", () => {
  it("creates Supabase identity + org + first outlet + user + OWNER membership atomically", async () => {
    const store = emptyStore();
    const { db } = makeDb(store);
    const { admin, calls } = makeAdmin();

    const result = await provisionOwner({ db, admin, input: OWNER_INPUT });

    expect(result.created).toBe(true);
    expect(result.role).toBe("OWNER");
    // Supabase identity created with email confirmed (operator-set password).
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0]).toMatchObject({ email: OWNER_INPUT.email, email_confirm: true });
    expect(result.authSubject).toBe("sb_created_1");
    // Org + outlet + user + single all-outlet OWNER membership persisted.
    expect(store.orgs).toHaveLength(1);
    expect(store.orgs[0]).toMatchObject({ slug: "acme-foods", name: OWNER_INPUT.organizationName, dataScope: "PRODUCTION", active: true });
    expect(store.orgs[0]!.id).toMatch(/^ten_/);
    expect(store.outlets).toHaveLength(1);
    expect(store.outlets[0]).toMatchObject({ organizationId: store.orgs[0]!.id, name: OWNER_INPUT.outletName, active: true });
    expect(store.users).toHaveLength(1);
    expect(store.users[0]).toMatchObject({ email: OWNER_INPUT.email, authSubject: "sb_created_1", active: true });
    expect(store.memberships).toHaveLength(1);
    // OWNER spans all outlets => outletId null.
    expect(store.memberships[0]).toMatchObject({ role: "OWNER", outletId: null, organizationId: store.orgs[0]!.id, active: true });
    expect(result.outletIds).toEqual([store.outlets[0]!.id]);
  });

  it("rejects an invalid email / short password / bad slug without touching Supabase or Prisma", async () => {
    const store = emptyStore();
    const { db } = makeDb(store);
    const { admin, calls } = makeAdmin();
    await expect(provisionOwner({ db, admin, input: { ...OWNER_INPUT, email: "not-an-email" } })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    await expect(provisionOwner({ db, admin, input: { ...OWNER_INPUT, password: "short" } })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    await expect(provisionOwner({ db, admin, input: { ...OWNER_INPUT, organizationSlug: "Bad Slug!" } })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    expect(calls.created).toHaveLength(0);
    expect(store.users).toHaveLength(0);
  });

  it("is idempotent by email: a repeat run returns created:false without a second Supabase user", async () => {
    const store = emptyStore();
    const { db } = makeDb(store);
    const { admin, calls } = makeAdmin();
    const first = await provisionOwner({ db, admin, input: OWNER_INPUT });
    const repeat = await provisionOwner({ db, admin, input: OWNER_INPUT });
    expect(first.created).toBe(true);
    expect(repeat.created).toBe(false);
    expect(repeat.userId).toBe(first.userId);
    // No duplicate Supabase identity or duplicate org/user rows.
    expect(calls.created).toHaveLength(1);
    expect(store.users).toHaveLength(1);
    expect(store.orgs).toHaveLength(1);
  });
});


// ---------------------------------------------------------------------------
describe("Phase 4 — provisionOwner compensation (Prisma failure rolls back Supabase)", () => {
  it("deletes the just-created Supabase user when the Prisma transaction fails", async () => {
    const store = emptyStore();
    const { db } = makeDb(store);
    const { admin, calls } = makeAdmin();
    // Fail on user.create inside the transaction (after the Supabase user exists).
    store.failCreate = "user";
    await expect(provisionOwner({ db, admin, input: OWNER_INPUT })).rejects.toMatchObject({
      message: "simulated user failure",
    });
    // The compensating action removed the orphaned Supabase identity.
    expect(calls.deleted).toEqual(["sb_created_1"]);
    // The failed transaction rolled back every Prisma write.
    expect(store.orgs).toHaveLength(0);
    expect(store.outlets).toHaveLength(0);
    expect(store.users).toHaveLength(0);
    expect(store.memberships).toHaveLength(0);
  });

  it("fails closed (INTERNAL) when Supabase createUser errors, without writing to Prisma", async () => {
    const store = emptyStore();
    const { db } = makeDb(store);
    const { admin, calls } = makeAdmin({ createUserError: "admin disabled" });
    await expect(provisionOwner({ db, admin, input: OWNER_INPUT })).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
    });
    expect(calls.deleted).toHaveLength(0);
    expect(store.users).toHaveLength(0);
  });

  it("rejects a duplicate organization slug as a conflict", async () => {
    const store = emptyStore();
    store.orgs.push({ id: "ten_existing", name: "Existing", slug: "acme-foods", dataScope: "PRODUCTION", active: true });
    const { db } = makeDb(store);
    const { admin, calls } = makeAdmin();
    await expect(provisionOwner({ db, admin, input: OWNER_INPUT })).rejects.toMatchObject({
      code: ERROR_CODES.CONFLICT,
    });
    // Compensating delete of the Supabase user created before the tx threw.
    expect(calls.deleted).toEqual(["sb_created_1"]);
    expect(store.orgs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 4 — provisionDeveloper (platform role, no business membership)", () => {
  it("creates a Supabase user + User row with NO membership and a platform role", async () => {
    const store = emptyStore();
    const { db } = makeDb(store);
    const { admin, calls } = makeAdmin();
    const result = await provisionDeveloper({
      db,
      admin,
      input: { email: "dev@hansan.test", password: "dev-pass-123456", displayName: "Dana" },
    });
    expect(result.created).toBe(true);
    expect(result.role).toBe("DEVELOPER");
    expect(result.organizationId).toBe("");
    expect(result.outletIds).toEqual([]);
    // No business membership is ever minted for a Developer.
    expect(store.memberships).toHaveLength(0);
    expect(store.users).toHaveLength(1);
    expect(calls.created[0]).toMatchObject({
      email: "dev@hansan.test",
      email_confirm: true,
      app_metadata: { hansan_platform_role: "developer" },
    });
  });

  it("is idempotent by email and rolls back the Supabase user on a Prisma failure", async () => {
    const store = emptyStore();
    const { db } = makeDb(store);
    const { admin, calls } = makeAdmin();
    const first = await provisionDeveloper({ db, admin, input: { email: "dev@hansan.test", password: "dev-pass-123456" } });
    const repeat = await provisionDeveloper({ db, admin, input: { email: "dev@hansan.test", password: "dev-pass-123456" } });
    expect(first.created).toBe(true);
    expect(repeat.created).toBe(false);
    expect(calls.created).toHaveLength(1);

    // A fresh email that fails in Prisma triggers a compensating Supabase delete.
    store.failCreate = "user";
    await expect(
      provisionDeveloper({ db, admin, input: { email: "dev2@hansan.test", password: "dev-pass-123456" } }),
    ).rejects.toMatchObject({ message: "simulated user failure" });
    expect(calls.deleted).toEqual(["sb_created_2"]);
  });

  it("validates input and rejects a weak password", async () => {
    const store = emptyStore();
    const { db } = makeDb(store);
    const { admin } = makeAdmin();
    await expect(provisionDeveloper({ db, admin, input: { email: "nope", password: "dev-pass-123456" } })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    await expect(provisionDeveloper({ db, admin, input: { email: "dev@hansan.test", password: "x" } })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  });
});


// ---------------------------------------------------------------------------
describe("Phase 4 — inviteStaff (owner-initiated, tenant-scoped)", () => {
  const ACTOR = { userId: "usr_owner1", organizationId: "ten_acme" };

  function storeWithOrg(): Store {
    const store = emptyStore();
    store.outlets.push(
      { id: "out_a", organizationId: "ten_acme", name: "A", active: true },
      { id: "out_b", organizationId: "ten_acme", name: "B", active: true },
    );
    return store;
  }

  it("invites POS staff scoped to the ACTOR's org + explicit outlets (one membership per outlet)", async () => {
    const store = storeWithOrg();
    const { db } = makeDb(store);
    const { admin, calls } = makeAdmin();
    const result = await inviteStaff({
      db,
      admin,
      actor: ACTOR,
      input: { email: "cashier@acme.test", role: "POS", outletIds: ["out_a", "out_b"] },
    });
    expect(result.created).toBe(true);
    expect(result.role).toBe("POS");
    expect(result.organizationId).toBe("ten_acme");
    // Invited via Supabase invite (invitee sets their own password), not createUser.
    expect(calls.invited).toHaveLength(1);
    expect(calls.created).toHaveLength(0);
    // Two memberships (one per outlet) in the ACTOR's org — never a foreign tenant.
    expect(store.memberships).toHaveLength(2);
    for (const m of store.memberships) {
      expect(m.organizationId).toBe("ten_acme");
      expect(m.role).toBe("POS");
      expect(m.active).toBe(true);
    }
    expect(store.memberships.map((m) => m.outletId).sort()).toEqual(["out_a", "out_b"]);
  });

  it("rejects an outlet that belongs to a DIFFERENT organization (tenant isolation)", async () => {
    const store = storeWithOrg();
    // An outlet that is NOT in ten_acme.
    store.outlets.push({ id: "out_evil", organizationId: "ten_evil", name: "Evil", active: true });
    const { db } = makeDb(store);
    const { admin, calls } = makeAdmin();
    await expect(
      inviteStaff({ db, admin, actor: ACTOR, input: { email: "x@acme.test", role: "POS", outletIds: ["out_evil"] } }),
    ).rejects.toMatchObject({ code: ERROR_CODES.OUTLET_MISMATCH });
    expect(calls.invited).toHaveLength(0);
    expect(store.users).toHaveLength(0);
  });

  it("requires at least one outlet for POS/KDS but allows all-outlet for OWNER/FINANCE", async () => {
    const store = storeWithOrg();
    const { db } = makeDb(store);
    const { admin, calls } = makeAdmin();
    // POS with no outlets -> rejected.
    await expect(
      inviteStaff({ db, admin, actor: ACTOR, input: { email: "p@acme.test", role: "POS", outletIds: [] } }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    // FINANCE with no outlets -> all-outlet membership (outletId null).
    const finance = await inviteStaff({
      db,
      admin,
      actor: ACTOR,
      input: { email: "f@acme.test", role: "FINANCE", outletIds: [] },
    });
    expect(finance.created).toBe(true);
    expect(store.memberships).toHaveLength(1);
    expect(store.memberships[0]).toMatchObject({ role: "FINANCE", outletId: null });
    expect(calls.invited).toHaveLength(1);
  });

  it("rejects an unsupported role (e.g. DEVELOPER) so a body cannot mint a platform role", async () => {
    const store = storeWithOrg();
    const { db } = makeDb(store);
    const { admin } = makeAdmin();
    await expect(
      inviteStaff({
        db,
        admin,
        actor: ACTOR,
        input: { email: "x@acme.test", role: "DEVELOPER" as InviteStaffInput["role"], outletIds: [] },
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it("is idempotent by email and compensates the Supabase invite on a Prisma failure", async () => {
    const store = storeWithOrg();
    const { db } = makeDb(store);
    const { admin, calls } = makeAdmin();
    const first = await inviteStaff({
      db,
      admin,
      actor: ACTOR,
      input: { email: "cashier@acme.test", role: "POS", outletIds: ["out_a"] },
    });
    const repeat = await inviteStaff({
      db,
      admin,
      actor: ACTOR,
      input: { email: "cashier@acme.test", role: "POS", outletIds: ["out_a"] },
    });
    expect(first.created).toBe(true);
    expect(repeat.created).toBe(false);
    expect(calls.invited).toHaveLength(1);
    expect(store.users).toHaveLength(1);

    // A Prisma failure after the invite triggers a compensating Supabase delete.
    store.failCreate = "user";
    await expect(
      inviteStaff({ db, admin, actor: ACTOR, input: { email: "new@acme.test", role: "KDS", outletIds: ["out_a"] } }),
    ).rejects.toMatchObject({ message: "simulated user failure" });
    expect(calls.deleted).toEqual(["sb_invited_2"]);
    // The failed invite left no partial user behind.
    expect(store.users).toHaveLength(1);
  });

  it("fails closed (INTERNAL) when the Supabase invite errors", async () => {
    const store = storeWithOrg();
    const { db } = makeDb(store);
    const { admin } = makeAdmin({ inviteError: "email rate limited" });
    await expect(
      inviteStaff({ db, admin, actor: ACTOR, input: { email: "x@acme.test", role: "POS", outletIds: ["out_a"] } }),
    ).rejects.toMatchObject({ code: ERROR_CODES.INTERNAL });
  });
});


const OWNER_SECRET = "owner-provision-secret-0123456789abcdef";
const DEV_SECRET = "developer-provision-secret-0123456789abcdef";

const ORIGINAL_OWNER_SECRET = process.env.HANSAN_PROVISION_SECRET;
const ORIGINAL_DEV_SECRET = process.env.HANSAN_DEVELOPER_PROVISION_SECRET;

afterEach(() => {
  setEnv("HANSAN_PROVISION_SECRET", ORIGINAL_OWNER_SECRET);
  setEnv("HANSAN_DEVELOPER_PROVISION_SECRET", ORIGINAL_DEV_SECRET);
  vi.mocked(getPrisma).mockReset();
  vi.mocked(createAdminClient).mockReset();
  vi.mocked(createClient).mockReset();
});

function adminReq(url: string, opts: { bearer?: string; ip?: string; origin?: string; body?: unknown } = {}): Request {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  if (opts.bearer) headers.set("authorization", `Bearer ${opts.bearer}`);
  if (opts.ip) headers.set("x-forwarded-for", opts.ip);
  if (opts.origin) headers.set("origin", opts.origin);
  return new Request(url, { method: "POST", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}

function wireRoute(store: Store, adminOpts: Parameters<typeof makeAdmin>[0] = {}) {
  const { db } = makeDb(store);
  const { admin, calls } = makeAdmin(adminOpts);
  vi.mocked(getPrisma).mockReturnValue(db as unknown as ReturnType<typeof getPrisma>);
  vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>);
  return { calls };
}

// ---------------------------------------------------------------------------
describe("Phase 4 — assertProvisionSecret (Bearer gate, fail-closed)", () => {
  function catchError(fn: () => unknown): { code?: string; status?: number } {
    try {
      fn();
    } catch (error) {
      return error as { code?: string; status?: number };
    }
    throw new Error("expected the guard to throw, but it did not");
  }

  it("throws AUTH_NOT_CONFIGURED (503) when the secret is unset (path disabled)", () => {
    const thrown = catchError(() => assertProvisionSecret(adminReq("http://x", { bearer: "anything" }), null));
    expect(thrown).toMatchObject({ code: ERROR_CODES.AUTH_NOT_CONFIGURED, status: 503 });
  });

  it("throws UNAUTHENTICATED (401) for a missing, wrong, or non-Bearer token", () => {
    expect(catchError(() => assertProvisionSecret(adminReq("http://x"), OWNER_SECRET))).toMatchObject({
      code: ERROR_CODES.UNAUTHENTICATED,
      status: 401,
    });
    expect(catchError(() => assertProvisionSecret(adminReq("http://x", { bearer: "wrong" }), OWNER_SECRET))).toMatchObject({
      code: ERROR_CODES.UNAUTHENTICATED,
      status: 401,
    });
    const basic = new Request("http://x", { headers: { authorization: `Basic ${OWNER_SECRET}` } });
    expect(catchError(() => assertProvisionSecret(basic, OWNER_SECRET))).toMatchObject({
      code: ERROR_CODES.UNAUTHENTICATED,
      status: 401,
    });
  });

  it("passes only for the exact secret (case-insensitive Bearer scheme)", () => {
    expect(() => assertProvisionSecret(adminReq("http://x", { bearer: OWNER_SECRET }), OWNER_SECRET)).not.toThrow();
    const lower = new Request("http://x", { headers: { authorization: `bearer ${OWNER_SECRET}` } });
    expect(() => assertProvisionSecret(lower, OWNER_SECRET)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("Phase 4 — POST /api/admin/provision-owner", () => {
  it("rejects a cross-origin request (403) before the secret", async () => {
    setEnv("HANSAN_PROVISION_SECRET", OWNER_SECRET);
    const res = await postProvisionOwner(
      adminReq("http://localhost/api/admin/provision-owner", { origin: "https://evil.example", bearer: OWNER_SECRET, ip: "10.0.0.1" }),
    );
    expect(res.status).toBe(403);
  });

  it("fails closed (503) when HANSAN_PROVISION_SECRET is not configured", async () => {
    setEnv("HANSAN_PROVISION_SECRET", undefined);
    const res = await postProvisionOwner(
      adminReq("http://localhost/api/admin/provision-owner", { bearer: OWNER_SECRET, ip: "10.0.0.2" }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe(ERROR_CODES.AUTH_NOT_CONFIGURED);
  });

  it("rejects a wrong Bearer token (401)", async () => {
    setEnv("HANSAN_PROVISION_SECRET", OWNER_SECRET);
    const res = await postProvisionOwner(
      adminReq("http://localhost/api/admin/provision-owner", { bearer: "wrong", ip: "10.0.0.3" }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe(ERROR_CODES.UNAUTHENTICATED);
  });

  it("provisions the first owner (201) then an idempotent repeat (200), never echoing the password", async () => {
    setEnv("HANSAN_PROVISION_SECRET", OWNER_SECRET);
    const store = emptyStore();
    const { calls } = wireRoute(store);

    const first = await postProvisionOwner(
      adminReq("http://localhost/api/admin/provision-owner", { bearer: OWNER_SECRET, ip: "10.0.0.4", body: OWNER_INPUT }),
    );
    expect(first.status).toBe(201);
    const firstJson = await first.json();
    expect(firstJson.ok).toBe(true);
    expect(firstJson.data).toMatchObject({ role: "OWNER", created: true });
    expect(JSON.stringify(firstJson)).not.toContain(OWNER_INPUT.password);
    expect(store.memberships[0]).toMatchObject({ role: "OWNER", outletId: null });

    const repeat = await postProvisionOwner(
      adminReq("http://localhost/api/admin/provision-owner", { bearer: OWNER_SECRET, ip: "10.0.0.4", body: OWNER_INPUT }),
    );
    expect(repeat.status).toBe(200);
    expect((await repeat.json()).data).toMatchObject({ created: false });
    expect(calls.created).toHaveLength(1);
    expect(store.users).toHaveLength(1);
  });

  it("rate-limits repeated attempts from the same IP (429)", async () => {
    setEnv("HANSAN_PROVISION_SECRET", OWNER_SECRET);
    let last: Response | undefined;
    for (let i = 0; i < 12; i += 1) {
      last = await postProvisionOwner(
        adminReq("http://localhost/api/admin/provision-owner", { bearer: "wrong", ip: "10.0.0.99" }),
      );
    }
    expect(last?.status).toBe(429);
    expect((await last!.json()).error.code).toBe(ERROR_CODES.RATE_LIMITED);
  });
});

// ---------------------------------------------------------------------------
describe("Phase 4 — POST /api/admin/provision-developer", () => {
  it("uses its OWN secret: the owner secret is rejected (401)", async () => {
    setEnv("HANSAN_DEVELOPER_PROVISION_SECRET", DEV_SECRET);
    setEnv("HANSAN_PROVISION_SECRET", OWNER_SECRET);
    const res = await postProvisionDeveloper(
      adminReq("http://localhost/api/admin/provision-developer", { bearer: OWNER_SECRET, ip: "10.0.1.1" }),
    );
    expect(res.status).toBe(401);
  });

  it("fails closed (503) when the developer secret is unset", async () => {
    setEnv("HANSAN_DEVELOPER_PROVISION_SECRET", undefined);
    const res = await postProvisionDeveloper(
      adminReq("http://localhost/api/admin/provision-developer", { bearer: DEV_SECRET, ip: "10.0.1.2" }),
    );
    expect(res.status).toBe(503);
  });

  it("provisions a Developer (201) with NO business membership", async () => {
    setEnv("HANSAN_DEVELOPER_PROVISION_SECRET", DEV_SECRET);
    const store = emptyStore();
    const { calls } = wireRoute(store);
    const res = await postProvisionDeveloper(
      adminReq("http://localhost/api/admin/provision-developer", {
        bearer: DEV_SECRET,
        ip: "10.0.1.3",
        body: { email: "dev@hansan.test", password: "dev-pass-123456" },
      }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ role: "DEVELOPER", created: true });
    expect(store.memberships).toHaveLength(0);
    expect(calls.created[0]).toMatchObject({ app_metadata: { hansan_platform_role: "developer" } });
  });
});

// ---------------------------------------------------------------------------
// Staff invite route: REAL requireAuth + revalidation logic over MOCKED ports.
// ---------------------------------------------------------------------------
const SUPA_ID = "sb_sub_owner";

function liveSessionCookie(overrides: Partial<SessionPayload> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
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
  const secret = getSessionSecret().secret!;
  return signSession(payload, secret).then((token) => `${SESSION_COOKIE}=${token}`);
}

/** Combined Prisma port: top-level = revalidation reads; $transaction = provisioning writes. */
function combinedDb(
  store: Store,
  reval: { user: LiveSessionUserRow | null; memberships: LiveSessionMembershipRow[]; outlets: { id: string }[] },
) {
  const { db: provisionDb } = makeDb(store);
  return {
    $transaction: provisionDb.$transaction,
    user: {
      findUnique: async (args: { where: { authSubject?: string; email?: string } }) => {
        if (args.where.authSubject !== undefined) return reval.user;
        const row = store.users.find((u) => u.email === args.where.email);
        return row ? { id: row.id, active: row.active } : null;
      },
    },
    membership: { findMany: async () => reval.memberships },
    outlet: { findMany: async () => reval.outlets },
  };
}

function ownerRevalMembership(): LiveSessionMembershipRow {
  return {
    organizationId: "ten_acme",
    role: "OWNER",
    outletId: null,
    organization: { id: "ten_acme", active: true },
    outlet: null,
  };
}

function wireStaffRoute(
  store: Store,
  reval: { user: LiveSessionUserRow | null; memberships: LiveSessionMembershipRow[]; outlets: { id: string }[] },
  adminOpts: Parameters<typeof makeAdmin>[0] = {},
) {
  const db = combinedDb(store, reval);
  vi.mocked(getPrisma).mockReturnValue(db as unknown as ReturnType<typeof getPrisma>);
  vi.mocked(createClient).mockReturnValue({
    auth: {
      getUser: async () =>
        reval.user
          ? { data: { user: { id: SUPA_ID, email: reval.user.email } }, error: null }
          : { data: { user: null }, error: new Error("no session") },
    },
  } as unknown as ReturnType<typeof createClient>);
  const { admin, calls } = makeAdmin(adminOpts);
  vi.mocked(createAdminClient).mockReturnValue(admin as unknown as ReturnType<typeof createAdminClient>);
  return { calls };
}

function inviteReq(cookie: string | undefined, ip: string, body: unknown, origin?: string): Request {
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": ip });
  if (cookie) headers.set("cookie", cookie);
  if (origin) headers.set("origin", origin);
  return new Request("http://localhost/api/staff/invite", { method: "POST", headers, body: JSON.stringify(body) });
}


describe("Phase 4 — POST /api/staff/invite", () => {
  function storeWithOrg(): Store {
    const store = emptyStore();
    store.outlets.push(
      { id: "out_a", organizationId: "ten_acme", name: "A", active: true },
      { id: "out_b", organizationId: "ten_acme", name: "B", active: true },
    );
    return store;
  }
  const revalOk = {
    user: { id: "usr_owner1", email: "owner@acme.test", active: true } as LiveSessionUserRow,
    memberships: [ownerRevalMembership()],
    outlets: [{ id: "out_a" }, { id: "out_b" }],
  };

  it("rejects a demo session (403) before any Supabase/Prisma call", async () => {
    const store = storeWithOrg();
    wireStaffRoute(store, revalOk);
    const secret = getSessionSecret().secret!;
    const demoToken = (await signSession(createDemoSession({ userId: "usr_demo", role: "owner", email: "d@x.local" }), secret))!;
    const res = await postStaffInvite(inviteReq(`${SESSION_COOKIE}=${demoToken}`, "10.0.2.1", { email: "a@b.test", role: "POS" }));
    expect(res.status).toBe(403);
    expect(store.users).toHaveLength(0);
  });

  it("rejects an unauthenticated request (401)", async () => {
    const store = storeWithOrg();
    wireStaffRoute(store, revalOk);
    const res = await postStaffInvite(inviteReq(undefined, "10.0.2.2", { email: "a@b.test", role: "POS" }));
    expect(res.status).toBe(401);
  });

  it("rejects a cross-origin request (403)", async () => {
    const store = storeWithOrg();
    wireStaffRoute(store, revalOk);
    const cookie = await liveSessionCookie();
    const res = await postStaffInvite(inviteReq(cookie, "10.0.2.3", { email: "a@b.test", role: "POS" }, "https://evil.example"));
    expect(res.status).toBe(403);
  });

  it("allows a revalidated OWNER to invite POS staff into their own org (201)", async () => {
    const store = storeWithOrg();
    const { calls } = wireStaffRoute(store, revalOk);
    const cookie = await liveSessionCookie();
    const res = await postStaffInvite(inviteReq(cookie, "10.0.2.4", { email: "cashier@acme.test", role: "POS", outletIds: ["out_a"] }));
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ role: "POS", created: true });
    expect(store.memberships[0]).toMatchObject({ organizationId: "ten_acme", role: "POS", outletId: "out_a" });
    expect(calls.invited).toHaveLength(1);
  });

  it("rejects a non-owner (KDS) even with a valid live session (403)", async () => {
    const store = storeWithOrg();
    wireStaffRoute(store, {
      user: { id: "usr_kds1", email: "kds@acme.test", active: true },
      memberships: [
        {
          organizationId: "ten_acme",
          role: "KDS",
          outletId: "out_a",
          organization: { id: "ten_acme", active: true },
          outlet: { id: "out_a", organizationId: "ten_acme", active: true },
        },
      ],
      outlets: [{ id: "out_a" }],
    });
    const cookie = await liveSessionCookie({ sub: "usr_kds1", role: "kds", email: "kds@acme.test" });
    const res = await postStaffInvite(inviteReq(cookie, "10.0.2.5", { email: "x@acme.test", role: "POS", outletIds: ["out_a"] }));
    expect(res.status).toBe(403);
    expect(store.users).toHaveLength(0);
  });

  it("fails closed (401) when the Supabase identity has been revoked", async () => {
    const store = storeWithOrg();
    wireStaffRoute(store, { ...revalOk, user: null });
    const cookie = await liveSessionCookie();
    const res = await postStaffInvite(inviteReq(cookie, "10.0.2.6", { email: "x@acme.test", role: "POS", outletIds: ["out_a"] }));
    expect(res.status).toBe(401);
    expect(store.users).toHaveLength(0);
  });
});

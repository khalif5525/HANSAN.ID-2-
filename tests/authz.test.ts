/**
 * Phase 3 — server-side authorization tests: fail-closed auth, RBAC
 * denials + audit, tenant/outlet boundaries, demo isolation, CSRF origin.
 */
import { describe, expect, it } from "vitest";
import {
  createDemoSession,
  signSession,
  SESSION_COOKIE,
  DEMO_TENANT_ID,
} from "@/server/session";
import {
  assertDemoScope,
  assertSameOrigin,
  authorize,
  authorizeRecord,
  authorizeWorkspace,
  requireAuth,
  type AuthContext,
} from "@/server/authz";
import { MemoryAudit } from "./helpers/memory";
import { getEnv, setEnv, setNodeEnv } from "./helpers/env";

const TEST_SECRET = "test-secret-at-least-32-characters-long!!";
// Anchor to the CURRENT time so issued sessions stay valid (exp = now + TTL).
// A hard-coded timestamp would rot into "already expired" as real time passes.
const now = new Date();

function demoCtx(role: AuthContext["session"]["role"]): AuthContext {
  const session = createDemoSession({ userId: `usr_demo_${role}`, role, email: `${role}@hansan.local`, now });
  return {
    session,
    actor: { userId: session.sub, role: session.role, tenantId: session.tenantId, outletIds: session.outletIds },
  };
}

describe("server authorization", () => {
  it("requireAuth fails closed with UNAUTHENTICATED when no cookie", async () => {
    const req = new Request("http://localhost/api/orders");
    await expect(requireAuth(req)).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  it("requireAuth fails closed with AUTH_NOT_CONFIGURED when production secret missing", async () => {
    const prevSecret = getEnv("SESSION_SECRET");
    const prevNodeEnv = getEnv("NODE_ENV");
    try {
      setEnv("SESSION_SECRET", "");
      setNodeEnv("production");
      const payload = createDemoSession({ userId: "usr_demo_owner", role: "owner", email: "owner@hansan.local", now });
      const token = await signSession(payload, "some-other-secret-entirely-long-enough-x");
      const req = new Request("http://localhost/api/orders", {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      });
      await expect(requireAuth(req)).rejects.toMatchObject({ code: "AUTH_NOT_CONFIGURED", status: 503 });
    } finally {
      setEnv("SESSION_SECRET", prevSecret);
      setNodeEnv(prevNodeEnv);
    }
  });

  it("requireAuth accepts a valid cookie", async () => {
    const payload = createDemoSession({ userId: "usr_demo_kds", role: "kds", email: "kds@hansan.local", now });
    const token = await signSession(payload, TEST_SECRET);
    const prev = getEnv("SESSION_SECRET");
    try {
      setEnv("SESSION_SECRET", TEST_SECRET);
      const req = new Request("http://localhost/api/kds", { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
      const ctx = await requireAuth(req);
      expect(ctx.session.role).toBe("kds");
      expect(ctx.actor.tenantId).toBe(DEMO_TENANT_ID);
    } finally {
      setEnv("SESSION_SECRET", prev);
    }
  });

  it("denies out-of-grant permissions and records an audit event", () => {
    const audit = new MemoryAudit();
    const kds = demoCtx("kds");
    expect(() => authorize(kds, "kds:view_queue", audit)).not.toThrow();
    expect(() => authorize(kds, "pos:order_create", audit)).toThrowError(/lacks permission/);
    expect(() => authorize(kds, "finance:refund_approve", audit)).toThrowError(/lacks permission/);
    expect(audit.events).toHaveLength(2);
    expect(audit.events[0]!.action).toBe("auth.access_denied");
    expect(audit.events[0]!.entityId).toBe("pos:order_create");
  });
  it("access-denied audit uses the revalidated actor identity, not stale session claims", () => {
    const audit = new MemoryAudit();
    const session = createDemoSession({ userId: "usr_stale_session", role: "kds", email: "kds@hansan.local", now });
    const ctx: AuthContext = {
      session,
      actor: { userId: "usr_revalidated", role: "kds", tenantId: "ten_revalidated", outletIds: [] },
    };
    expect(() => authorize(ctx, "pos:order_create", audit)).toThrowError(/lacks permission/);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]!.actorId).toBe("usr_revalidated");
    expect(audit.events[0]!.actorRole).toBe("kds");
    expect(audit.events[0]!.tenantId).toBe("ten_revalidated");
  });

  it("developer role holds no business permissions (platform/business separation)", () => {
    const audit = new MemoryAudit();
    const dev = demoCtx("developer");
    expect(() => authorize(dev, "dev:system", audit)).not.toThrow();
    expect(() => authorize(dev, "pos:order_create", audit)).toThrow();
    expect(() => authorize(dev, "finance:view", audit)).toThrow();
    expect(() => authorize(dev, "hq:view", audit)).toThrow();
  });

  it("enforces workspace boundaries server-side", () => {
    const pos = demoCtx("pos");
    expect(() => authorizeWorkspace(pos, "/pos")).not.toThrow();
    expect(() => authorizeWorkspace(pos, "/hq")).toThrowError(/denied/);
    expect(() => authorizeWorkspace(pos, "/developer")).toThrowError(/denied/);
  });

  it("enforces tenant and outlet boundaries on records", () => {
    const pos = demoCtx("pos");
    expect(() => authorizeRecord(pos, { tenantId: DEMO_TENANT_ID, outletId: "out_demo_sandbox" })).not.toThrow();
    expect(() => authorizeRecord(pos, { tenantId: "ten_other" })).toThrowError(/Cross-tenant/);
    expect(() => authorizeRecord(pos, { tenantId: DEMO_TENANT_ID, outletId: "out_elsewhere" })).toThrowError(/Outlet/);
  });

  it("demo sessions can never address production scope", () => {
    const pos = demoCtx("pos");
    expect(() => assertDemoScope(pos, "DEMO")).not.toThrow();
    expect(() => assertDemoScope(pos, "PRODUCTION")).toThrowError(/Demo sessions cannot access production/);
  });

  it("rejects cross-origin mutations, allows same-origin and absent origin", () => {
    const same = new Request("http://localhost/api/orders", { method: "POST", headers: { origin: "http://localhost" } });
    expect(() => assertSameOrigin(same)).not.toThrow();
    const none = new Request("http://localhost/api/orders", { method: "POST" });
    expect(() => assertSameOrigin(none)).not.toThrow();
    const cross = new Request("http://localhost/api/orders", { method: "POST", headers: { origin: "https://evil.example" } });
    expect(() => assertSameOrigin(cross)).toThrowError(/Cross-origin/);
  });
});


/**
 * In-memory integration tests (Phase 4) - the real POS order lifecycle at the
 * API boundary, exercised through the route handlers against the process-local
 * DEMO sandbox (runtimeFor -> demoSandbox). No fake production records: the
 * demo sandbox starts empty and physically never reaches Postgres.
 *
 * Wiring note: the route resolves its ports via runtimeFor(session) ->
 * demoSandbox(), so these tests seed THAT sandbox catalog and assert on THAT
 * sandbox orders map + the shared serverAudit sink - not separate local doubles.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE, type SessionPayload } from "@/server/session";
import { getTaxConfig } from "@/config/tax";
import { demoSandbox } from "@/server/runtime";
import { serverAudit } from "@/server/audit";
import { MemoryCatalog, MemoryOrders } from "@/server/db/memory-store";
import { PosService } from "@/domain/pos/service";
import { POST, GET } from "@/app/api/orders/route";
import { GET as GET_ORDER_BY_ID } from "@/app/api/orders/[id]/route";
import type { OrderView } from "@/server/compose";
import type { ProductRecord } from "@/domain/shared/ports";
import { getEnv } from "./helpers/env";

const DEMO_SECRET = "test-demo-secret-not-for-production-use";
const DEMO_TENANT = "ten_demo";
const DEMO_OUTLET = "out_demo";
const DB_CONFIGURED = Boolean(
  getEnv("DATABASE_URL") || getEnv("POSTGRES_URL") || getEnv("PRISMA_DATABASE_URL"),
);

// requireAuth verifies against getSessionSecret(); point it at the test secret
// so the demo auth cookie is accepted (this is never a real credential).
function setSecret(): void {
  const env = process.env as Record<string, string | undefined>;
  env.SESSION_SECRET = DEMO_SECRET;
}
setSecret();

// The demo sandbox is a process-local singleton; reset it so each test starts
// from an empty, isolated store.
beforeEach(() => {
  delete (globalThis as unknown as { __hansanDemoRuntime?: unknown }).__hansanDemoRuntime;
});

async function demoSession(params: {
  role: "pos" | "owner" | "kds" | "finance";
  userId: string;
  tenantId?: string;
  outletId?: string;
}): Promise<{ session: SessionPayload; token: string }> {
  const session: SessionPayload = {
    v: 1,
    mode: "demo",
    sub: params.userId,
    role: params.role,
    email: `${params.userId}@hansan.local`,
    tenantId: params.tenantId ?? DEMO_TENANT,
    outletIds: [params.outletId ?? DEMO_OUTLET],
    dataScope: "DEMO",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const token = (await signSession(session, DEMO_SECRET)) ?? "";
  return { session, token };
}

/** Seed the SANDBOX catalog (the one the route actually reads). */
function seedProduct(productId: string, overrides: Partial<ProductRecord> = {}): void {
  const catalog = demoSandbox().catalog as MemoryCatalog;
  catalog.put({
    id: productId,
    tenantId: DEMO_TENANT,
    categoryId: "cat_demo",
    name: `${productId} Item`,
    priceIdr: 25_000,
    station: "kitchen",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
}

function sandboxOrders(): MemoryOrders {
  return demoSandbox().orders as MemoryOrders;
}

function authHeaders(token: string): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` };
}

async function callPost(token: string, body: unknown, idempotencyKey: string) {
  const req = new Request("http://localhost/api/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      ...authHeaders(token),
    },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

async function callGetList(token: string, search = "") {
  const req = new Request(`http://localhost/api/orders${search ? `?${search}` : ""}`, {
    method: "GET",
    headers: authHeaders(token),
  });
  const res = await GET(req);
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

async function callGetById(token: string, orderId: string) {
  const req = new Request(`http://localhost/api/orders/by-id?id=${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: authHeaders(token),
  });
  const res = await GET_ORDER_BY_ID(req);
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

function failCode(json: Record<string, unknown>): string {
  return (json as { ok: false; error: { code: string } }).error.code;
}

function okData<T>(json: Record<string, unknown>): T {
  expect(json.ok).toBe(true);
  return json.data as T;
}

describe("POS order API (Phase 4)", () => {
  it("places an order and derives totals from persisted catalog prices", async () => {
    seedProduct("p1", { name: "Nasi Goreng", priceIdr: 25_000, station: "kitchen" });
    seedProduct("p2", { name: "Es Jeruk", priceIdr: 8_000, station: "bar" });

    const { token } = await demoSession({ role: "pos", userId: "usr_pos_create" });
    const res = await callPost(
      token,
      {
        orderType: "dine-in",
        tableId: "tab_1",
        customerId: "cust_1",
        discountIdr: 500,
        lines: [
          { productId: "p1", quantity: 2, note: "extra egg" },
          { productId: "p2", quantity: 1 },
        ],
      },
      "idem-order-1",
    );

    expect(res.status).toBe(201);
    const data = okData<Record<string, unknown>>(res.json);
    expect(data.orderNumber).toBe("ORD-00001");
    expect(data.state).toBe("placed");
    expect(data.paymentState).toBe("unpaid");
    expect(data.subtotalIdr).toBe(2 * 25_000 + 8_000);
    expect(data.discountIdr).toBe(500);
    expect(data.taxIdr).toBe(0);
    expect(data.grandTotalIdr).toBe(2 * 25_000 + 8_000 - 500);
    expect(data.lineCount).toBe(2);
    expect(sandboxOrders().rows.size).toBe(1);

    const lines = data.lines as Record<string, unknown>[];
    const line1 = lines[0]!;
    expect(line1["unitPriceIdr"]).toBe(25_000);
    expect(line1["station"]).toBe("kitchen");
    expect(line1["productName"]).toBe("Nasi Goreng");
  });

  it("replays the persisted order on an Idempotency-Key retry (no duplicate)", async () => {
    seedProduct("p1");
    const { token } = await demoSession({ role: "pos", userId: "usr_pos_idem" });
    const payload = { orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] };

    const first = await callPost(token, payload, "idem-1");
    expect(first.status).toBe(201);
    const firstId = okData<{ id: string }>(first.json).id;

    const replay = await callPost(token, payload, "idem-1");
    expect(replay.status).toBe(200);
    expect(okData<{ id: string }>(replay.json).id).toBe(firstId);
    expect(sandboxOrders().rows.size).toBe(1);

    const second = await callPost(token, payload, "idem-2");
    expect(second.status).toBe(201);
    expect(sandboxOrders().rows.size).toBe(2);
  });

  it("rejects invalid quantity and empty lines with VALIDATION_FAILED", async () => {
    seedProduct("p1");
    const { token } = await demoSession({ role: "pos", userId: "usr_pos_validate" });

    const badQty = await callPost(
      token,
      { orderType: "dine-in", tableId: "t", lines: [{ productId: "p1", quantity: 0 }] },
      "idem-badq",
    );
    expect(badQty.status).toBe(400);
    expect(failCode(badQty.json)).toBe("VALIDATION_FAILED");

    const overQty = await callPost(
      token,
      { orderType: "dine-in", tableId: "t", lines: [{ productId: "p1", quantity: 1000 }] },
      "idem-overq",
    );
    expect(overQty.status).toBe(400);

    const empty = await callPost(token, { orderType: "dine-in", tableId: "t", lines: [] }, "idem-empty");
    expect(empty.status).toBe(400);
    expect(failCode(empty.json)).toBe("VALIDATION_FAILED");
  });

  it("rejects unknown products with NOT_FOUND", async () => {
    const { token } = await demoSession({ role: "pos", userId: "usr_pos_unknown" });
    const res = await callPost(
      token,
      { orderType: "take-away", lines: [{ productId: "nope", quantity: 1 }] },
      "idem-badprod",
    );
    expect(res.status).toBe(404);
    expect(failCode(res.json)).toBe("NOT_FOUND");
  });

  it("blocks roles that lack pos:order_create (403, nothing persisted)", async () => {
    seedProduct("p1");
    const { token } = await demoSession({ role: "kds", userId: "usr_kds_blocked" });
    const res = await callPost(
      token,
      { orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] },
      "idem-role",
    );
    expect(res.status).toBe(403);
    expect(failCode(res.json)).toBe("ROLE_NOT_PERMITTED");
    expect(sandboxOrders().rows.size).toBe(0);
  });

  it("keeps demo records isolated across tenants", async () => {
    seedProduct("p1");
    seedProduct("p1b", { tenantId: "ten_demo_2" });

    const a = await demoSession({ role: "pos", userId: "usr_pos_a", tenantId: "ten_demo", outletId: "out_d1" });
    const b = await demoSession({ role: "pos", userId: "usr_pos_b", tenantId: "ten_demo_2", outletId: "out_d2" });

    const createdA = await callPost(
      a.token,
      { orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] },
      "idem-a",
    );
    expect(createdA.status).toBe(201);
    const orderAId = okData<{ id: string }>(createdA.json).id;

    const createdB = await callPost(
      b.token,
      { orderType: "take-away", lines: [{ productId: "p1b", quantity: 1 }] },
      "idem-b",
    );
    expect(createdB.status).toBe(201);

    // A different tenant cannot read another tenant order. The scoped adapter
    // hides foreign rows (null) before authorizeRecord, so the route returns
    // 404 NOT_FOUND — existence is never leaked (Phase 8 hardening).
    const cross = await callGetById(b.token, orderAId);
    expect(cross.status).toBe(404);
    expect(failCode(cross.json)).toBe("NOT_FOUND");

    // Each tenant history shows only its own order.
    const historyA = await callGetList(a.token, "limit=10");
    expect(okData<{ orders: OrderView[] }>(historyA.json).orders).toHaveLength(1);
    const historyB = await callGetList(b.token, "limit=10");
    expect(okData<{ orders: OrderView[] }>(historyB.json).orders).toHaveLength(1);
  });

  it.runIf(!DB_CONFIGURED)(
    "fails closed (503) for a live session when persistence is not configured",
    async () => {
      const live: SessionPayload = {
        v: 1,
        mode: "live",
        sub: "usr_live",
        role: "owner",
        email: "live@hansan.local",
        tenantId: "org_prod",
        outletIds: ["out_prod"],
        dataScope: "PRODUCTION",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const token = (await signSession(live, DEMO_SECRET)) ?? "";
      const res = await callPost(
        token,
        { orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] },
        "idem-live",
      );
      expect(res.status).toBe(503);
      expect(failCode(res.json)).toBe("PERSISTENCE_NOT_CONFIGURED");
    },
  );

  it("persists an unpaid order and captures payment through the service", async () => {
    seedProduct("p1", { name: "Kopi", priceIdr: 15_000, station: "bar" });
    const { session, token } = await demoSession({ role: "pos", userId: "usr_pos_pay" });

    const created = await callPost(
      token,
      { orderType: "take-away", lines: [{ productId: "p1", quantity: 2 }] },
      "idem-pay",
    );
    expect(created.status).toBe(201);
    const orderId = okData<{ id: string }>(created.json).id;

    // Pay through the SAME sandbox the route persisted into.
    const pos = new PosService({
      orders: sandboxOrders(),
      catalog: demoSandbox().catalog,
      audit: serverAudit,
      payments: demoSandbox().payments,
      tax: getTaxConfig(),
      clock: () => new Date(),
    });
    const paid = await pos.pay(orderId, { organizationId: session.tenantId }, session.sub, "cash");
    expect(paid.paymentState).toBe("paid");
    expect(paid.state).toBe("placed");
    expect(await sandboxOrders().findById(orderId, { organizationId: session.tenantId })).not.toBeNull();

    await expect(pos.pay(orderId, { organizationId: session.tenantId }, session.sub, "cash")).rejects.toMatchObject({
      code: "PAYMENT_STATE_INVALID",
    });
  });

  it("lists order history scoped to the session outlet, newest first", async () => {
    seedProduct("p1");
    const { token } = await demoSession({ role: "pos", userId: "usr_pos_history" });

    await callPost(
      token,
      { orderType: "dine-in", tableId: "t1", lines: [{ productId: "p1", quantity: 1 }] },
      "idem-h1",
    );
    await callPost(
      token,
      { orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] },
      "idem-h2",
    );

    const res = await callGetList(token, "limit=10");
    expect(res.status).toBe(200);
    const data = okData<{ orders: OrderView[]; total: number }>(res.json);
    expect(data.total).toBe(2);
    expect(data.orders).toHaveLength(2);
    expect(new Set(data.orders.map((o) => o.orderNumber))).toEqual(
      new Set(["ORD-00001", "ORD-00002"]),
    );
    // Newest-first ordering is guaranteed by the adapter sort (createdAt desc).
    expect(String(data.orders[0]!.createdAt) >= String(data.orders[1]!.createdAt)).toBe(true);
  });

  it("reads one order by id and denies cross-tenant reads", async () => {
    seedProduct("p1");
    const { token } = await demoSession({ role: "pos", userId: "usr_pos_byid" });
    const created = await callPost(
      token,
      { orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] },
      "idem-one",
    );
    expect(created.status).toBe(201);
    const orderId = okData<{ id: string }>(created.json).id;

    const one = await callGetById(token, orderId);
    expect(one.status).toBe(200);
    expect(okData<{ id: string }>(one.json).id).toBe(orderId);

    const other = await demoSession({ role: "pos", userId: "usr_pos_other", tenantId: "ten_demo_2" });
    const denied = await callGetById(other.token, orderId);
    expect(denied.status).toBe(404);
    expect(failCode(denied.json)).toBe("NOT_FOUND");
  });

  it("emits an order.created audit event for a fresh order", async () => {
    seedProduct("p1");
    const { session, token } = await demoSession({ role: "pos", userId: "usr_pos_audit" });

    const created = await callPost(
      token,
      { orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] },
      "idem-audit",
    );
    expect(created.status).toBe(201);
    const orderId = okData<{ id: string }>(created.json).id;

    const events = serverAudit
      .recent(200)
      .filter((e) => e.action === "order.created" && e.entityId === orderId);
    expect(events).toHaveLength(1);
    expect(events[0]!.actorId).toBe(session.sub);
    expect(events[0]!.actorRole).toBe("pos");
    expect(events[0]!.tenantId).toBe(DEMO_TENANT);
    expect(events[0]!.entityType).toBe("order");
  });
});
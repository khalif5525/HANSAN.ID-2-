/**
 * OA14 — Refund API route-level integration tests (local DEMO sandbox evidence).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { signSession, SESSION_COOKIE, type SessionPayload } from "@/server/session";
import { demoSandbox } from "@/server/runtime";
import { serverAudit } from "@/server/audit";
import { MemoryCatalog, MemoryOrders } from "@/server/db/memory-store";
import type { OrderRecord } from "@/domain/shared/ports";
import type { RefundRecord } from "@/domain/finance/ports";
import { POST as REFUND_REQUEST_POST } from "@/app/api/refunds/route";
import { PATCH as REFUND_DECIDE_PATCH } from "@/app/api/refunds/[id]/route";
import { ERROR_CODES } from "@/domain/shared/errors";
import { getEnv } from "./helpers/env";

const DEMO_SECRET = "test-demo-secret-not-for-production-use";
const DEMO_TENANT = "ten_demo";
const DEMO_OUTLET = "out_demo";
const DEMO_TENANT_2 = "ten_demo_2";
const DEMO_OUTLET_2 = "out_demo_2";

function setSecret(): void {
  const env = process.env as Record<string, string | undefined>;
  env.SESSION_SECRET = DEMO_SECRET;
}
setSecret();

beforeEach(() => {
  delete (globalThis as unknown as { __hansanDemoRuntime?: unknown }).__hansanDemoRuntime;
});

async function demoSession(params: {
  role: "pos" | "owner" | "finance";
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

function authHeaders(token: string): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` };
}

function seedPaidOrder(
  orders: MemoryOrders,
  overrides: { id?: string; tenantId?: string; outletId?: string; grandTotalIdr?: number } = {},
): void {
  const order = {
    id: overrides.id ?? "ord_paid_1",
    tenantId: overrides.tenantId ?? DEMO_TENANT,
    outletId: overrides.outletId ?? DEMO_OUTLET,
    orderNumber: "ORD-00001",
    orderType: "take-away" as const,
    tableId: null,
    customerId: null,
    lines: [
      {
        id: "l1",
        productId: "p1",
        productName: "Mie Goreng",
        quantity: 2,
        unitPriceIdr: 25_000,
        modifierIds: [],
        station: "kitchen",
        state: "active",
        prepStatus: "pending",
      },
    ],
    subtotalIdr: overrides.grandTotalIdr ?? 50_000,
    discountIdr: 0,
    taxIdr: 0,
    grandTotalIdr: overrides.grandTotalIdr ?? 50_000,
    state: "completed" as const,
    paymentState: "paid" as const,
    createdBy: "usr_pos",
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-01-01T10:00:00.000Z",
  };
  orders.rows.set(order.id, order as OrderRecord);
}

function seedProduct(catalog: MemoryCatalog, productId: string, tenantId = DEMO_TENANT): void {
  catalog.put({
    id: productId,
    tenantId,
    categoryId: "cat_demo",
    name: `${productId} Item`,
    priceIdr: 25_000,
    station: "kitchen",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
}

async function callRefundRequest(
  token: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...authHeaders(token),
  };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const req = new Request("http://localhost/api/refunds", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const res = await REFUND_REQUEST_POST(req);
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

async function callRefundDecide(
  token: string,
  refundId: string,
  action: "approve" | "reject" | "complete",
): Promise<{ status: number; json: Record<string, unknown> }> {
  const req = new Request(`http://localhost/api/refunds/${refundId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify({ action }),
  });
  const res = await REFUND_DECIDE_PATCH(req);
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

describe("Refund request API (POST /api/refunds)", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const req = new Request("http://localhost/api/refunds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: "ord_1", amountIdr: 10_000, reason: "wrong" }),
    });
    const res = await REFUND_REQUEST_POST(req);
    expect(res.status).toBe(401);
    expect(failCode((await res.json()) as Record<string, unknown>)).toBe(
      ERROR_CODES.UNAUTHENTICATED,
    );
  });

  it("rejects a request body that is not an object with 400", async () => {
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const res = await callRefundRequest(token, "not-an-object");
    expect(res.status).toBe(400);
    expect(failCode(res.json)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("rejects missing amountIdr with 400", async () => {
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const res = await callRefundRequest(token, { orderId: "ord_1", reason: "wrong" });
    expect(res.status).toBe(400);
    expect(failCode(res.json)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("rejects non-integer amountIdr with 400", async () => {
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const res = await callRefundRequest(token, {
      orderId: "ord_1",
      amountIdr: 10.5,
      reason: "wrong",
    });
    expect(res.status).toBe(400);
    expect(failCode(res.json)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("rejects zero or negative amountIdr with 400", async () => {
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const zero = await callRefundRequest(token, {
      orderId: "ord_1",
      amountIdr: 0,
      reason: "wrong",
    });
    expect(zero.status).toBe(400);
    expect(failCode(zero.json)).toBe(ERROR_CODES.VALIDATION_FAILED);

    const negative = await callRefundRequest(token, {
      orderId: "ord_1",
      amountIdr: -100,
      reason: "wrong",
    });
    expect(negative.status).toBe(400);
    expect(failCode(negative.json)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("rejects missing reason with 400", async () => {
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const res = await callRefundRequest(token, { orderId: "ord_1", amountIdr: 10_000 });
    expect(res.status).toBe(400);
    expect(failCode(res.json)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("rejects refund on a missing order as NOT_FOUND (no leak)", async () => {
    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const res = await callRefundRequest(token, {
      orderId: "ord_missing",
      amountIdr: 10_000,
      reason: "wrong",
    });
    expect(res.status).toBe(404);
    expect(failCode(res.json)).toBe(ERROR_CODES.NOT_FOUND);
  });

  it("rejects refund on an unpaid order as REFUND_NOT_ELIGIBLE", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    orders.rows.set("ord_unpaid", {
      id: "ord_unpaid",
      tenantId: DEMO_TENANT,
      outletId: DEMO_OUTLET,
      orderNumber: "ORD-00002",
      orderType: "take-away" as const,
      tableId: null,
      customerId: null,
      lines: [],
      subtotalIdr: 10_000,
      discountIdr: 0,
      taxIdr: 0,
      grandTotalIdr: 10_000,
      state: "placed" as const,
      paymentState: "unpaid" as const,
      createdBy: "usr_pos",
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z",
    });

    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const res = await callRefundRequest(token, {
      orderId: "ord_unpaid",
      amountIdr: 10_000,
      reason: "wrong",
    });
    expect(res.status).toBe(409);
    expect(failCode(res.json)).toBe(ERROR_CODES.REFUND_NOT_ELIGIBLE);
  });

  it("rejects refund amount above order grand total with 400", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders, { grandTotalIdr: 50_000 });

    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const res = await callRefundRequest(token, {
      orderId: "ord_paid_1",
      amountIdr: 50_001,
      reason: "over",
    });
    expect(res.status).toBe(400);
    expect(failCode(res.json)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("rejects cross-tenant refund as NOT_FOUND (no existence leak)", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders, { tenantId: DEMO_TENANT });

    const { token } = await demoSession({
      role: "pos",
      userId: "usr_evil",
      tenantId: DEMO_TENANT_2,
      outletId: DEMO_OUTLET_2,
    });
    const res = await callRefundRequest(token, {
      orderId: "ord_paid_1",
      amountIdr: 10_000,
      reason: "cross",
    });
    expect(res.status).toBe(404);
    expect(failCode(res.json)).toBe(ERROR_CODES.NOT_FOUND);
  });

  it("accepts a valid paid, in-outlet, capped refund and returns 201", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders);

    const { token } = await demoSession({ role: "pos", userId: "usr_pos" });
    const res = await callRefundRequest(token, {
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      reason: "defective unit",
    });
    expect(res.status).toBe(201);
    const data = okData<{ status: string; amountIdr: number; orderId: string; tenantId: string; id: string }>(res.json);
    expect(data.status).toBe("pending");
    expect(data.amountIdr).toBe(30_000);
    expect(data.orderId).toBe("ord_paid_1");
    expect(data.tenantId).toBe(DEMO_TENANT);

    const requested = serverAudit.recent().find((e) => e.action === "finance.refund_requested");
    expect(requested).toBeDefined();
    expect(requested!.entityId).toBe(data.id);
    expect(requested!.tenantId).toBe(DEMO_TENANT);
  });
});

describe("Refund decision API (PATCH /api/refunds/[id])", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const req = new Request("http://localhost/api/refunds/ref_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    const res = await REFUND_DECIDE_PATCH(req);
    expect(res.status).toBe(401);
  });

  it("rejects POS role attempting to approve (403, insufficient role)", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders);

    const { token: posToken } = await demoSession({
      role: "pos",
      userId: "usr_pos",
    });
    const requestRes = await callRefundRequest(posToken, {
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      reason: "wrong",
    });
    const refundId = okData<{ id: string }>(requestRes.json).id;

    const decideRes = await callRefundDecide(posToken, refundId, "approve");
    expect(decideRes.status).toBe(403);
    expect(failCode(decideRes.json)).toBe(ERROR_CODES.ROLE_NOT_PERMITTED);
  });

  it("rejects developer role (no business permissions)", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders);

    const { token: posToken } = await demoSession({ role: "pos", userId: "usr_pos" });
    const requestRes = await callRefundRequest(posToken, {
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      reason: "wrong",
    });
    const refundId = okData<{ id: string }>(requestRes.json).id;

    const devSession: SessionPayload = {
      v: 1,
      mode: "demo",
      sub: "usr_dev",
      role: "developer",
      email: "dev@hansan.local",
      tenantId: DEMO_TENANT,
      outletIds: [DEMO_OUTLET],
      dataScope: "DEMO",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const devToken = (await signSession(devSession, DEMO_SECRET)) ?? "";

    const decideRes = await callRefundDecide(devToken, refundId, "approve");
    expect(decideRes.status).toBe(403);
    expect(failCode(decideRes.json)).toBe(ERROR_CODES.ROLE_NOT_PERMITTED);
  });

  it("allows owner to approve a pending refund (different actor than requester)", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders);

    const { token: posToken } = await demoSession({
      role: "pos",
      userId: "usr_cashier",
    });
    const requestRes = await callRefundRequest(posToken, {
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      reason: "wrong",
    });
    const refundId = okData<{ id: string }>(requestRes.json).id;

    const { token: ownerToken } = await demoSession({
      role: "owner",
      userId: "usr_owner",
    });
    const approveRes = await callRefundDecide(ownerToken, refundId, "approve");
    expect(approveRes.status).toBe(200);
    const data = okData<{ status: string; decidedBy: string | undefined }>(approveRes.json);
    expect(data.status).toBe("approved");
    expect(data.decidedBy).toBe("usr_owner");

    const approved = serverAudit.recent().find((e) => e.action === "finance.refund_approved");
    expect(approved).toBeDefined();
    expect(approved!.entityId).toBe(refundId);
    expect(approved!.tenantId).toBe(DEMO_TENANT);
  });

  it("allows finance to complete an approved refund", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders);

    const { token: posToken } = await demoSession({ role: "pos", userId: "usr_cashier" });
    const requestRes = await callRefundRequest(posToken, {
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      reason: "wrong",
    });
    const refundId = okData<{ id: string }>(requestRes.json).id;

    const { token: ownerToken } = await demoSession({ role: "owner", userId: "usr_owner" });
    await callRefundDecide(ownerToken, refundId, "approve");

    const { token: financeToken } = await demoSession({
      role: "finance",
      userId: "usr_finance",
    });
    const completeRes = await callRefundDecide(financeToken, refundId, "complete");
    expect(completeRes.status).toBe(200);
    const data = okData<{ status: string }>(completeRes.json);
    expect(data.status).toBe("completed");

    const completed = serverAudit.recent().find((e) => e.action === "finance.refund_completed");
    expect(completed).toBeDefined();
  });

  it("rejects self-approval (requester cannot approve their own refund)", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders);

    const { token } = await demoSession({
      role: "owner",
      userId: "usr_owner",
    });
    const requestRes = await callRefundRequest(token, {
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      reason: "wrong",
    });
    const refundId = okData<{ id: string }>(requestRes.json).id;

    const decideRes = await callRefundDecide(token, refundId, "approve");
    expect(decideRes.status).toBe(403);
    expect(failCode(decideRes.json)).toBe(ERROR_CODES.REFUND_SELF_APPROVAL_FORBIDDEN);
  });

  it("rejects deciding an already-decided refund (409 CONFLICT)", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders);

    const { token: posToken } = await demoSession({ role: "pos", userId: "usr_cashier" });
    const requestRes = await callRefundRequest(posToken, {
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      reason: "wrong",
    });
    const refundId = okData<{ id: string }>(requestRes.json).id;

    const { token: ownerToken } = await demoSession({ role: "owner", userId: "usr_owner" });
    await callRefundDecide(ownerToken, refundId, "approve");

    const decideRes = await callRefundDecide(ownerToken, refundId, "reject");
    expect(decideRes.status).toBe(409);
    expect(failCode(decideRes.json)).toBe(ERROR_CODES.REFUND_ALREADY_DECIDED);
  });

  it("rejects completing a non-approved refund (409 CONFLICT)", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders);

    const { token: posToken } = await demoSession({ role: "pos", userId: "usr_cashier" });
    const requestRes = await callRefundRequest(posToken, {
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      reason: "wrong",
    });
    const refundId = okData<{ id: string }>(requestRes.json).id;

    const { token: financeToken } = await demoSession({
      role: "finance",
      userId: "usr_finance",
    });
    const completeRes = await callRefundDecide(financeToken, refundId, "complete");
    expect(completeRes.status).toBe(409);
    expect(failCode(completeRes.json)).toBe(ERROR_CODES.REFUND_ALREADY_DECIDED);
  });

  it("rejects cross-tenant decision as NOT_FOUND (no existence leak)", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders, { tenantId: DEMO_TENANT });

    const { token: posToken } = await demoSession({ role: "pos", userId: "usr_cashier" });
    const requestRes = await callRefundRequest(posToken, {
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      reason: "wrong",
    });
    const refundId = okData<{ id: string }>(requestRes.json).id;

    const { token: ownerToken } = await demoSession({
      role: "owner",
      userId: "usr_evil",
      tenantId: DEMO_TENANT_2,
    });
    const decideRes = await callRefundDecide(ownerToken, refundId, "approve");
    expect(decideRes.status).toBe(404);
    expect(failCode(decideRes.json)).toBe(ERROR_CODES.NOT_FOUND);
  });

  it("rejects deciding a refund for a missing refundId (404)", async () => {
    const { token } = await demoSession({ role: "owner", userId: "usr_owner" });
    const res = await callRefundDecide(token, "ref_nonexistent", "approve");
    expect(res.status).toBe(404);
    expect(failCode(res.json)).toBe(ERROR_CODES.NOT_FOUND);
  });

  it("does not persist state on failed decision (no partial mutation)", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders);

    const { token: posToken } = await demoSession({ role: "pos", userId: "usr_cashier" });
    const requestRes = await callRefundRequest(posToken, {
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      reason: "wrong",
    });
    const refundId = okData<{ id: string }>(requestRes.json).id;

    const { token: ownerToken } = await demoSession({ role: "owner", userId: "usr_owner" });
    await callRefundDecide(ownerToken, refundId, "approve");

    const decideRes = await callRefundDecide(ownerToken, refundId, "approve");
    expect(decideRes.status).toBe(409);

    const finance = demoSandbox().finance as import("@/server/db/memory-store").MemoryFinance;
    const current = await finance.getRefund(refundId, DEMO_TENANT);
    expect(current!.status).toBe("approved");
    expect(current!.decidedBy).toBe("usr_owner");
  });
});

describe("Refund idempotency (POST /api/refunds with Idempotency-Key)", () => {
  it("retry after success returns original 201 and does not create a duplicate refund", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders);

    const { token } = await demoSession({ role: "pos", userId: "usr_cashier" });
    const key = "idem_refund_1";

    const first = await callRefundRequest(token, {
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      reason: "defective unit",
    }, key);
    expect(first.status).toBe(201);
    const firstId = okData<{ id: string }>(first.json).id;

    const retry = await callRefundRequest(token, {
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      reason: "defective unit",
    }, key);
    expect(retry.status).toBe(201);
    expect(okData<{ id: string }>(retry.json).id).toBe(firstId);

    // Exactly one refund record exists.
    const finance = demoSandbox().finance as import("@/server/db/memory-store").MemoryFinance;
    const refunds = await finance.listRefunds(DEMO_TENANT);
    expect(refunds.filter((r) => r.orderId === "ord_paid_1")).toHaveLength(1);
  });

  it("retry after an error releases the claim so a valid retry executes", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders, { grandTotalIdr: 50_000 });

    const { token } = await demoSession({ role: "pos", userId: "usr_cashier" });
    const key = "idem_refund_error";

    // First attempt: amount above grand total → validation error, claim released.
    const err = await callRefundRequest(token, {
      orderId: "ord_paid_1",
      amountIdr: 999_999,
      reason: "over",
    }, key);
    expect(err.status).toBe(400);

    // Retry with same key, valid payload → executes successfully.
    const ok = await callRefundRequest(token, {
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      reason: "defective unit",
    }, key);
    expect(ok.status).toBe(201);

    const finance = demoSandbox().finance as import("@/server/db/memory-store").MemoryFinance;
    const refunds = await finance.listRefunds(DEMO_TENANT);
    expect(refunds.filter((r) => r.orderId === "ord_paid_1")).toHaveLength(1);
  });

  it("conflicting payload under the same idempotency key → 409 CONFLICT", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders);

    const { token } = await demoSession({ role: "pos", userId: "usr_cashier" });
    const key = "idem_refund_conflict";

    const first = await callRefundRequest(token, {
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      reason: "defective unit",
    }, key);
    expect(first.status).toBe(201);

    const conflicting = await callRefundRequest(token, {
      orderId: "ord_paid_1",
      amountIdr: 40_000,
      reason: "different amount",
    }, key);
    expect(conflicting.status).toBe(409);
    expect(failCode(conflicting.json)).toBe(ERROR_CODES.CONFLICT);
  });

  it("maps unsupported requestHash input to 400 VALIDATION_FAILED", async () => {
    const { token } = await demoSession({ role: "pos", userId: "usr_cashier" });
    const req = new Request("http://localhost/api/refunds", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "idem_refund_unsupported",
        ...authHeaders(token),
      },
      body: '{"orderId":"ord_paid_1","amountIdr":30000,"reason":"defective unit","extra":1e999}',
    });
    const res = await REFUND_REQUEST_POST(req);
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(failCode(json)).toBe(ERROR_CODES.VALIDATION_FAILED);
  });


  it("cross-tenant idempotency key isolation: same key, different tenant → separate refunds", async () => {
    const orders = demoSandbox().orders as MemoryOrders;
    const catalog = demoSandbox().catalog as MemoryCatalog;
    seedProduct(catalog, "p1");
    seedPaidOrder(orders, { tenantId: DEMO_TENANT });
    seedPaidOrder(orders, {
      id: "ord_paid_2",
      tenantId: DEMO_TENANT_2,
      outletId: DEMO_OUTLET_2,
      grandTotalIdr: 80_000,
    });

    const { token: tok1 } = await demoSession({
      role: "pos", userId: "usr_a", tenantId: DEMO_TENANT, outletId: DEMO_OUTLET,
    });
    const { token: tok2 } = await demoSession({
      role: "pos", userId: "usr_b", tenantId: DEMO_TENANT_2, outletId: DEMO_OUTLET_2,
    });
    const key = "idem_shared_key";

    const r1 = await callRefundRequest(tok1, {
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      reason: "tenant one",
    }, key);
    expect(r1.status).toBe(201);

    const r2 = await callRefundRequest(tok2, {
      orderId: "ord_paid_2",
      amountIdr: 50_000,
      reason: "tenant two",
    }, key);
    expect(r2.status).toBe(201);
    expect(okData<{ id: string }>(r2.json).id).not.toBe(okData<{ id: string }>(r1.json).id);

    // Each tenant sees only their own refund.
    const finance = demoSandbox().finance as import("@/server/db/memory-store").MemoryFinance;
    const t1Refunds = await finance.listRefunds(DEMO_TENANT);
    const t2Refunds = await finance.listRefunds(DEMO_TENANT_2);
    expect(t1Refunds.length).toBe(1);
    expect(t2Refunds.length).toBe(1);
    expect(t1Refunds[0].tenantId).toBe(DEMO_TENANT);
    expect(t2Refunds[0].tenantId).toBe(DEMO_TENANT_2);
  });

});

describe("OA16 — refund tenant scoping (adapter level)", () => {
  function seedDemoRefund(finance: import("@/server/db/memory-store").MemoryFinance, overrides: Partial<RefundRecord> = {}): string {
    const id: string = "ref_tenant_scope_test";
    const refund: RefundRecord = {
      id,
      tenantId: DEMO_TENANT,
      outletId: DEMO_OUTLET,
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      method: "cash",
      reason: "defective unit",
      status: "pending",
      requestedBy: "usr_pos",
      createdAt: "2026-01-01T10:00:00.000Z",
      ...overrides,
    };
    finance.refunds.set(id, refund);
    return id;
  }

  it("same-tenant getRefund returns the refund", async () => {
    const finance = demoSandbox().finance as import("@/server/db/memory-store").MemoryFinance;
    const id = seedDemoRefund(finance);
    const found = await finance.getRefund(id, DEMO_TENANT);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(id);
    expect(found!.tenantId).toBe(DEMO_TENANT);
  });

  it("cross-tenant getRefund returns null (no cross-tenant read)", async () => {
    const finance = demoSandbox().finance as import("@/server/db/memory-store").MemoryFinance;
    const id = seedDemoRefund(finance, { tenantId: DEMO_TENANT });
    const found = await finance.getRefund(id, DEMO_TENANT_2);
    expect(found).toBeNull();
  });

  it("getRefund for a nonexistent id returns null", async () => {
    const finance = demoSandbox().finance as import("@/server/db/memory-store").MemoryFinance;
    const found = await finance.getRefund("ref_nonexistent", DEMO_TENANT);
    expect(found).toBeNull();
  });

  it("same-tenant transitionRefund succeeds and mutates state", async () => {
    const finance = demoSandbox().finance as import("@/server/db/memory-store").MemoryFinance;
    const id = seedDemoRefund(finance, { status: "pending" });
    const updated = await finance.transitionRefund({
      id,
      organizationId: DEMO_TENANT,
      expectedStatus: "pending",
      patch: { status: "approved", decidedBy: "usr_owner", decidedAt: "2026-01-01T11:00:00.000Z" },
    });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("approved");
    expect(updated!.decidedBy).toBe("usr_owner");
    const stored = await finance.getRefund(id, DEMO_TENANT);
    expect(stored!.status).toBe("approved");
  });

  it("cross-tenant transitionRefund returns null (no cross-tenant transition, no mutation)", async () => {
    const finance = demoSandbox().finance as import("@/server/db/memory-store").MemoryFinance;
    const id = seedDemoRefund(finance, { tenantId: DEMO_TENANT, status: "pending" });
    const updated = await finance.transitionRefund({
      id,
      organizationId: DEMO_TENANT_2,
      expectedStatus: "pending",
      patch: { status: "approved", decidedBy: "usr_owner", decidedAt: "2026-01-01T11:00:00.000Z" },
    });
    expect(updated).toBeNull();
    const stored = await finance.getRefund(id, DEMO_TENANT);
    expect(stored!.status).toBe("pending");
  });

  it("transitionRefund with mismatched expectedStatus returns null (no mutation)", async () => {
    const finance = demoSandbox().finance as import("@/server/db/memory-store").MemoryFinance;
    const id = seedDemoRefund(finance, { status: "approved" });
    const updated = await finance.transitionRefund({
      id,
      organizationId: DEMO_TENANT,
      expectedStatus: "pending",
      patch: { status: "rejected", decidedBy: "usr_owner", decidedAt: "2026-01-01T11:00:00.000Z" },
    });
    expect(updated).toBeNull();
    const stored = await finance.getRefund(id, DEMO_TENANT);
    expect(stored!.status).toBe("approved");
  });

  it("transitionRefund with nonexistent id returns null", async () => {
    const finance = demoSandbox().finance as import("@/server/db/memory-store").MemoryFinance;
    const updated = await finance.transitionRefund({
      id: "ref_nonexistent",
      organizationId: DEMO_TENANT,
      expectedStatus: "pending",
      patch: { status: "approved" },
    });
    expect(updated).toBeNull();
  });
});

describe("OA16 — refund transition + audit atomicity (adapter level)", () => {
  it("transitionRefundWithAudit records the audit event on success", async () => {
    const finance = demoSandbox().finance as import("@/server/db/memory-store").MemoryFinance;
    finance.refunds.set("ref_audit_test", {
      id: "ref_audit_test",
      tenantId: DEMO_TENANT,
      outletId: DEMO_OUTLET,
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      method: "cash",
      reason: "defective unit",
      status: "pending",
      requestedBy: "usr_pos",
      createdAt: "2026-01-01T10:00:00.000Z",
    });

    const updated = await finance.transitionRefundWithAudit(
      {
        id: "ref_audit_test",
        organizationId: DEMO_TENANT,
        expectedStatus: "pending",
        patch: { status: "approved", decidedBy: "usr_owner", decidedAt: "2026-01-01T11:00:00.000Z" },
      },
      {
        id: "aud_1",
        action: "finance.refund_approved",
        actorId: "usr_owner",
        actorRole: "owner",
        entityType: "refund",
        entityId: "ref_audit_test",
        tenantId: DEMO_TENANT,
        outletId: DEMO_OUTLET,
        occurredAt: "2026-01-01T11:00:00.000Z",
        metadata: { amountIdr: 30_000 },
      },
    );
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("approved");

    const auditEvents = serverAudit.recent().filter((e) => e.entityId === "ref_audit_test");
    expect(auditEvents.length).toBeGreaterThan(0);
    expect(auditEvents[0]!.action).toBe("finance.refund_approved");
  });

  it("transitionRefundWithAudit records no audit event when the transition fails", async () => {
    const finance = demoSandbox().finance as import("@/server/db/memory-store").MemoryFinance;
    finance.refunds.set("ref_audit_fail_test", {
      id: "ref_audit_fail_test",
      tenantId: DEMO_TENANT,
      outletId: DEMO_OUTLET,
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      method: "cash",
      reason: "defective unit",
      status: "approved",
      requestedBy: "usr_pos",
      createdAt: "2026-01-01T10:00:00.000Z",
    });

    const auditBefore = serverAudit.recent().length;

    const updated = await finance.transitionRefundWithAudit(
      {
        id: "ref_audit_fail_test",
        organizationId: DEMO_TENANT,
        expectedStatus: "pending",
        patch: { status: "rejected", decidedBy: "usr_owner", decidedAt: "2026-01-01T11:00:00.000Z" },
      },
      {
        id: "aud_2",
        action: "finance.refund_rejected",
        actorId: "usr_owner",
        actorRole: "owner",
        entityType: "refund",
        entityId: "ref_audit_fail_test",
        tenantId: DEMO_TENANT,
        outletId: DEMO_OUTLET,
        occurredAt: "2026-01-01T11:00:00.000Z",
        metadata: { amountIdr: 30_000 },
      },
    );
    expect(updated).toBeNull();
    const auditAfter = serverAudit.recent().length;
    expect(auditAfter).toBe(auditBefore);
  });

  it("transitionRefundWithAudit records no audit event for cross-tenant", async () => {
    const finance = demoSandbox().finance as import("@/server/db/memory-store").MemoryFinance;
    finance.refunds.set("ref_audit_cross_test", {
      id: "ref_audit_cross_test",
      tenantId: DEMO_TENANT,
      outletId: DEMO_OUTLET,
      orderId: "ord_paid_1",
      amountIdr: 30_000,
      method: "cash",
      reason: "defective unit",
      status: "pending",
      requestedBy: "usr_pos",
      createdAt: "2026-01-01T10:00:00.000Z",
    });

    const auditBefore = serverAudit.recent().length;

    const updated = await finance.transitionRefundWithAudit(
      {
        id: "ref_audit_cross_test",
        organizationId: DEMO_TENANT_2,
        expectedStatus: "pending",
        patch: { status: "approved", decidedBy: "usr_owner", decidedAt: "2026-01-01T11:00:00.000Z" },
      },
      {
        id: "aud_3",
        action: "finance.refund_approved",
        actorId: "usr_owner",
        actorRole: "owner",
        entityType: "refund",
        entityId: "ref_audit_cross_test",
        tenantId: DEMO_TENANT_2,
        outletId: DEMO_OUTLET_2,
        occurredAt: "2026-01-01T11:00:00.000Z",
        metadata: { amountIdr: 30_000 },
      },
    );
    expect(updated).toBeNull();
    const auditAfter = serverAudit.recent().length;
    expect(auditAfter).toBe(auditBefore);
  });
});
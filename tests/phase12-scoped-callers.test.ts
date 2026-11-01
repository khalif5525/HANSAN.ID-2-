/**
 * Phase 12 — scoped-caller security tests.
 *
 * Every production caller of `orders.findById`, `payments.listByOrder`, and
 * `catalog.findById` must supply the REQUIRED tenant scope derived from an
 * authoritative actor/session (never request-body org/outlet ids). This suite
 * exercises, against the enforced in-memory store contract (memory-store):
 *
 *   1. Valid same-tenant reads succeed.
 *   2. Cross-tenant reads fail closed with the established non-leaking result
 *      (NOT_FOUND / null / []) — existence is never disclosed.
 *   3. Wrong-outlet scope fails closed (outlet restriction preserved).
 *   4. Missing/ambiguous organizationId fails closed (no unscoped fallback).
 *   5. Lifecycle, KDS, and finance mutations are denied cross-tenant with no
 *      side effects (no state flip, no Payment row, no Refund row).
 *   6. Tenant-wide reads (Owner/Finance) return only the caller's tenant rows.
 *   7. Demo/in-memory workflows continue to work through the same scoped
 *      contract as production.
 *
 * Compile-time guarantee (verified by `npm run typecheck`, not by this file):
 * the port signatures make `scope` a required argument, so an unscoped call
 * cannot compile. Route-level RBAC/outlet/404 behavior is covered by
 * `tests/pos-order.test.ts` (GET by id cross-tenant → 404) and
 * `tests/authz.test.ts`; refund separation of duties by
 * `tests/finance-service.test.ts` and `tests/refund-rules.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  cancelOrder,
  capturePayment,
  requestRefund,
  requireOrder,
  transitionOrder,
  type LifecycleDeps,
  type PaymentLifecycleDeps,
} from "@/domain/pos/lifecycle";
import { PosService } from "@/domain/pos/service";
import { KdsService } from "@/domain/kds/service";
import { FinanceService } from "@/domain/finance/service";
import { MemoryCatalog, MemoryOrders, MemoryPayments } from "@/server/db/memory-store";
import { MemoryAudit, MemoryFinance, actor } from "./helpers/memory";
import { cartSubtotalIdr } from "@/domain/pos/cart";
import { getTaxConfig } from "@/config/tax";
import { ERROR_CODES } from "@/domain/shared/errors";
import type { OrderRecord } from "@/domain/shared/ports";

const CLOCK = () => new Date("2026-01-01T00:00:00.000Z");
const TENANT_A = "ten_a";
const TENANT_B = "ten_b";
const OUTLET_1 = "out_1";
const OUTLET_2 = "out_2";

/** Verified actor scopes: A = owner of the fixture, B = foreign tenant. */
const SCOPE_A = { organizationId: TENANT_A };
const SCOPE_A_OUT_1 = { organizationId: TENANT_A, outletId: OUTLET_1 };
const SCOPE_B = { organizationId: TENANT_B };
const ISO = "2026-01-01T00:00:00.000Z";

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "ord_1",
    tenantId: TENANT_A,
    outletId: OUTLET_1,
    orderNumber: "ORD-00001",
    orderType: "take-away",
    tableId: null,
    customerId: null,
    lines: [
      {
        id: "l1",
        productId: "p1",
        productName: "Nasi Goreng",
        quantity: 1,
        unitPriceIdr: 10_000,
        modifierIds: [],
        station: "kitchen",
        state: "active",
        prepStatus: "pending",
      },
    ],
    subtotalIdr: 10_000,
    discountIdr: 0,
    taxIdr: 0,
    grandTotalIdr: 10_000,
    state: "placed",
    paymentState: "unpaid",
    createdBy: "usr_pos",
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

interface Harness {
  orders: MemoryOrders;
  payments: MemoryPayments;
  audit: MemoryAudit;
}

async function seed(overrides: Partial<OrderRecord> = {}): Promise<Harness> {
  const orders = new MemoryOrders();
  const payments = new MemoryPayments();
  const audit = new MemoryAudit();
  await orders.save(order(overrides));
  // A sibling order that belongs to a DIFFERENT tenant (attacker target).
  await orders.save(order({ id: "ord_foreign", tenantId: TENANT_B, outletId: OUTLET_1 }));
  return { orders, payments, audit };
}

function lifecycleDeps(h: Harness): LifecycleDeps {
  return { orders: h.orders, audit: h.audit, clock: CLOCK };
}

function paymentDeps(h: Harness): PaymentLifecycleDeps {
  return { ...lifecycleDeps(h), payments: h.payments };
}

describe("Phase 12 — requireOrder scope enforcement (fail closed, non-leaking)", () => {
  it("resolves a same-tenant order under the correct scope", async () => {
    const h = await seed();
    const found = await requireOrder(h.orders, "ord_1", SCOPE_A);
    expect(found.id).toBe("ord_1");
  });

  it("rejects a cross-tenant order as NOT_FOUND (no existence leak)", async () => {
    const h = await seed();
    // Even when the caller targets ANOTHER tenant's order id, the result is
    // indistinguishable from a missing order.
    await expect(requireOrder(h.orders, "ord_1", SCOPE_B)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
    // …and the foreign tenant's own order is invisible to A.
    await expect(requireOrder(h.orders, "ord_foreign", SCOPE_A)).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it("rejects a same-tenant order under the wrong outlet scope", async () => {
    const h = await seed();
    await expect(
      requireOrder(h.orders, "ord_1", { organizationId: TENANT_A, outletId: OUTLET_2 }),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    // The correct outlet still resolves.
    await expect(requireOrder(h.orders, "ord_1", SCOPE_A_OUT_1)).resolves.toMatchObject({
      id: "ord_1",
    });
  });

  it("rejects an empty/ambiguous organizationId (missing scope fails closed)", async () => {
    const h = await seed();
    await expect(requireOrder(h.orders, "ord_1", { organizationId: "" })).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
    // The underlying store also returns null — no unscoped read path exists.
    expect(await h.orders.findById("ord_1", { organizationId: "" })).toBeNull();
  });
});

describe("Phase 12 — lifecycle mutations are scope-checked before any side effect", () => {
  it("denies transition/pay/cancel/refund cross-tenant with NO side effects", async () => {
    const h = await seed();
    const life = lifecycleDeps(h);
    const pay = paymentDeps(h);

    await expect(transitionOrder(life, "ord_1", SCOPE_B, "accepted", "usr_kds")).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
    await expect(capturePayment(pay, "ord_1", SCOPE_B, "usr_pos", "cash")).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
    await expect(cancelOrder(life, "ord_1", SCOPE_B, "usr_pos")).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
    await expect(requestRefund(life, "ord_1", SCOPE_B, "usr_pos")).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });

    // The target row is untouched and no Payment ledger row was written.
    expect(h.orders.rows.get("ord_1")).toMatchObject({ state: "placed", paymentState: "unpaid" });
    expect(h.payments.rows.size).toBe(0);
    expect(h.audit.events).toHaveLength(0);
  });

  it("allows same-tenant scoped operations to proceed", async () => {
    const h = await seed();
    const paid = await capturePayment(paymentDeps(h), "ord_1", SCOPE_A, "usr_pos", "cash");
    expect(paid.paymentState).toBe("paid");
    expect(h.payments.rows.size).toBe(1);
    const advanced = await transitionOrder(lifecycleDeps(h), "ord_1", SCOPE_A_OUT_1, "accepted", "usr_kds");
    expect(advanced.state).toBe("accepted");
  });
});

describe("Phase 12 — PosService scoped callers", () => {
  function posHarness(catalog: MemoryCatalog, orders = new MemoryOrders()): PosService {
    return new PosService({
      orders,
      catalog,
      audit: new MemoryAudit(),
      payments: new MemoryPayments(),
      tax: getTaxConfig(),
      clock: CLOCK,
    });
  }

  function seededCatalog(): MemoryCatalog {
    const catalog = new MemoryCatalog();
    catalog.put({
      id: "p1",
      tenantId: TENANT_A,
      categoryId: "cat_1",
      name: "Nasi Goreng",
      priceIdr: 10_000,
      station: "kitchen",
      active: true,
      createdAt: ISO,
    });
    return catalog;
  }

  it("priceRequest prices a same-tenant product and hides a cross-tenant product id", async () => {
    const pos = posHarness(seededCatalog());
    const cart = await pos.priceRequest(
      { orderType: "take-away", lines: [{ productId: "p1", quantity: 2 }] },
      TENANT_A,
    );
    expect(cartSubtotalIdr(cart)).toBe(20_000);

    // Tenant B may not price (i.e., learn about) tenant A's product.
    await expect(
      pos.priceRequest({ orderType: "take-away", lines: [{ productId: "p1", quantity: 1 }] }, TENANT_B),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });

  it("getOrderById returns the record same-tenant and null cross-tenant", async () => {
    const orders = new MemoryOrders();
    await orders.save(order());
    const pos = posHarness(seededCatalog(), orders);
    expect((await pos.getOrderById("ord_1", SCOPE_A))?.id).toBe("ord_1");
    expect(await pos.getOrderById("ord_1", SCOPE_B)).toBeNull();
    expect(await pos.getOrderById("ord_1", { organizationId: "" })).toBeNull();
  });

  it("keeps the demo/in-memory createOrder workflow working through the scoped contract", async () => {
    const orders = new MemoryOrders();
    const pos = posHarness(seededCatalog(), orders);
    const created = await pos.createOrder({
      tenantId: TENANT_A,
      outletId: OUTLET_1,
      actor: actor({ tenantId: TENANT_A, outletIds: [OUTLET_1] }),
      req: { orderType: "take-away", lines: [{ productId: "p1", quantity: 2 }] },
    });
    expect(created.tenantId).toBe(TENANT_A);
    expect(created.grandTotalIdr).toBeGreaterThan(0);
    // The persisted demo order is readable under its own scope only.
    expect(await orders.findById(created.id, SCOPE_A)).not.toBeNull();
    expect(await orders.findById(created.id, SCOPE_B)).toBeNull();
  });
});

describe("Phase 12 — KdsService scoped callers", () => {
  it("fails closed cross-tenant with no state change, advances same-tenant tickets", async () => {
    const h = await seed();
    const kds = new KdsService({ orders: h.orders, audit: h.audit, clock: CLOCK });

    await expect(kds.performAction("ord_1", SCOPE_B, "accept", "usr_kds")).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
    expect(h.orders.rows.get("ord_1")!.state).toBe("placed");

    await expect(
      kds.setItemStatus("ord_1", SCOPE_B, "l1", "preparing", "usr_kds"),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    expect(h.orders.rows.get("ord_1")!.lines[0]!.prepStatus).toBe("pending");

    const advanced = await kds.performAction("ord_1", SCOPE_A, "accept", "usr_kds");
    expect(advanced.state).toBe("accepted");
    const item = await kds.setItemStatus("ord_1", SCOPE_A, "l1", "preparing", "usr_kds");
    expect(item.lines[0]!.prepStatus).toBe("preparing");
  });
});


describe("Phase 12 — FinanceService.requestRefund scoped read", () => {
  it("denies a cross-tenant refund without persisting a Refund row (no leak)", async () => {
    const h = await seed({ paymentState: "paid" });
    const finance = new MemoryFinance();
    const svc = new FinanceService({ finance, orders: h.orders, audit: h.audit, clock: CLOCK });

    await expect(
      svc.requestRefund({
        tenantId: TENANT_B, // claimed (attacker) tenant — must NOT resolve tenant A's order
        outletId: OUTLET_1,
        orderId: "ord_1",
        amountIdr: 1_000,
        reason: "cross",
        requester: actor({ id: "usr_evil", tenantId: TENANT_B }),
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    expect(finance.refunds.size).toBe(0);

    // Same-tenant request still flows through the existing guards.
    const refund = await svc.requestRefund({
      tenantId: TENANT_A,
      outletId: OUTLET_1,
      orderId: "ord_1",
      amountIdr: 5_000,
      reason: "wrong item",
      requester: actor({ tenantId: TENANT_A, outletIds: [OUTLET_1] }),
    });
    expect(refund.status).toBe("pending");
  });
});

describe("Phase 12 — payment ledger and tenant-wide reads stay scoped", () => {
  it("payments.listByOrder returns rows for the owner scope and [] for foreign/empty scopes", async () => {
    const payments = new MemoryPayments();
    await payments.save({
      id: "pay_1",
      tenantId: TENANT_A,
      outletId: OUTLET_1,
      orderId: "ord_1",
      amountIdr: 10_000,
      method: "cash",
      capturedBy: "usr_pos",
      capturedAt: ISO,
      externalRef: null,
    });
    expect(await payments.listByOrder("ord_1", SCOPE_A)).toHaveLength(1);
    expect(await payments.listByOrder("ord_1", SCOPE_B)).toEqual([]);
    expect(await payments.listByOrder("ord_1", { organizationId: "" })).toEqual([]);
  });

  it("tenant-wide reads (Owner/Finance) return ONLY the caller's tenant rows across outlets", async () => {
    const h = await seed();
    // A second outlet inside tenant A — tenant-wide readers may see both.
    await h.orders.save(order({ id: "ord_2", outletId: OUTLET_2 }));

    const tenantA = await h.orders.listByTenant(TENANT_A);
    expect(tenantA.map((o) => o.id).sort()).toEqual(["ord_1", "ord_2"]);

    const tenantB = await h.orders.listByTenant(TENANT_B);
    expect(tenantB.map((o) => o.id)).toEqual(["ord_foreign"]);
  });
});



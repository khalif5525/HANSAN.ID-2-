/**
 * Phase 5 — Business-workflow integrity tests.
 *
 * Payment lifecycle: an order is NEVER reported "paid" without a persisted
 * Payment row (the finance ledger is SUMs over Payment rows). Refund guards:
 * paid-only, amount capped at the order total, outlet + tenant scoping.
 * All persistence is in-memory fixtures; nothing touches a real DB.
 */
import { describe, expect, it } from "vitest";
import { capturePayment, type PaymentLifecycleDeps } from "@/domain/pos/lifecycle";
import { PosService } from "@/domain/pos/service";
import { FinanceService } from "@/domain/finance/service";
import { MemoryAudit, MemoryFinance, MemoryOrders, actor } from "./helpers/memory";
import { MemoryPayments } from "@/server/db/memory-store";
import { getTaxConfig } from "@/config/tax";
import { ERROR_CODES } from "@/domain/shared/errors";
import type { OrderRecord } from "@/domain/shared/ports";

const CLOCK = () => new Date("2026-01-01T00:00:00.000Z");
/** Verified tenant scope for the fixtures below (tenant "ten_test"). */
const SCOPE = { organizationId: "ten_test" };

function placedOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "ord_pay_1",
    tenantId: "ten_test",
    outletId: "out_1",
    orderNumber: "ORD-00001",
    orderType: "take-away",
    tableId: null,
    customerId: null,
    lines: [
      { id: "l1", productId: "p1", productName: "Mie Goreng", quantity: 2, unitPriceIdr: 25_000, modifierIds: [], station: "kitchen", state: "active", prepStatus: "pending" },
    ],
    subtotalIdr: 50_000,
    discountIdr: 0,
    taxIdr: 0,
    grandTotalIdr: 50_000,
    state: "placed",
    paymentState: "unpaid",
    createdBy: "usr_pos",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
  await orders.save(placedOrder(overrides));
  return { orders, payments, audit };
}

function deps(h: Harness): PaymentLifecycleDeps {
  return { orders: h.orders, payments: h.payments, audit: h.audit, clock: CLOCK };
}

describe("payment capture persists a Payment row (ledger integrity)", () => {
  it("marks the order paid AND writes a matching Payment record", async () => {
    const h = await seed();
    const paid = await capturePayment(deps(h), "ord_pay_1", SCOPE, "usr_pos", "cash");

    expect(paid.paymentState).toBe("paid");

    // The ledger row is the source of truth for finance totals.
    const rows = await h.payments.listByOrder("ord_pay_1", SCOPE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: "ten_test",
      outletId: "out_1",
      orderId: "ord_pay_1",
      amountIdr: 50_000,
      method: "cash",
      capturedBy: "usr_pos",
      externalRef: null,
    });
    expect(rows[0]!.id).toMatch(/^pay_/);
  });

  it("emits an order.payment_captured audit event carrying method + paymentId", async () => {
    const h = await seed();
    await capturePayment(deps(h), "ord_pay_1", SCOPE, "usr_pos", "cash");

    const event = h.audit.events.find((e) => e.action === "order.payment_captured");
    expect(event).toBeDefined();
    expect(event!.entityId).toBe("ord_pay_1");
    expect(event!.metadata).toMatchObject({ amountIdr: 50_000, method: "cash" });
    expect(String(event!.metadata!.paymentId)).toMatch(/^pay_/);
  });

  it("refuses a capture with no tender method (cannot settle an unknown method)", async () => {
    const h = await seed();
    await expect(
      capturePayment(deps(h), "ord_pay_1", SCOPE, "usr_pos", undefined as never),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    expect(h.payments.rows.size).toBe(0);
    expect((await h.orders.findById("ord_pay_1", SCOPE))!.paymentState).toBe("unpaid");
  });

  it("rejects a double capture and never writes a second Payment row", async () => {
    const h = await seed();
    await capturePayment(deps(h), "ord_pay_1", SCOPE, "usr_pos", "cash");
    await expect(
      capturePayment(deps(h), "ord_pay_1", SCOPE, "usr_pos", "cash"),
    ).rejects.toMatchObject({ code: ERROR_CODES.PAYMENT_STATE_INVALID });
    expect(h.payments.rows.size).toBe(1);
  });

  it("rejects capture on a cancelled order and on a missing order", async () => {
    const h = await seed({ state: "cancelled" });
    await expect(
      capturePayment(deps(h), "ord_pay_1", SCOPE, "usr_pos", "cash"),
    ).rejects.toMatchObject({ code: ERROR_CODES.INVALID_ORDER_STATE });
    await expect(
      capturePayment(deps(h), "ord_missing", SCOPE, "usr_pos", "cash"),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
    expect(h.payments.rows.size).toBe(0);
  });

  it("PosService.pay threads the method through to the Payment row", async () => {
    const h = await seed();
    const pos = new PosService({
      orders: h.orders,
      catalog: { findById: async () => null, listActive: async () => [] },
      audit: h.audit,
      payments: h.payments,
      tax: getTaxConfig(),
      clock: CLOCK,
    });
    const paid = await pos.pay("ord_pay_1", SCOPE, "usr_pos", "cash");
    expect(paid.paymentState).toBe("paid");
    expect((await h.payments.listByOrder("ord_pay_1", SCOPE))[0]!.method).toBe("cash");
  });
});

describe("refund request integrity guards", () => {
  function finance(orders: MemoryOrders) {
    return new FinanceService({ finance: new MemoryFinance(), orders, audit: new MemoryAudit(), clock: CLOCK });
  }
  const requester = () => actor({ id: "usr_pos", role: "pos" });

  it("rejects a refund on an unpaid order (money was never captured)", async () => {
    const h = await seed({ paymentState: "unpaid" });
    await expect(
      finance(h.orders).requestRefund({
        tenantId: "ten_test", outletId: "out_1", orderId: "ord_pay_1",
        amountIdr: 10_000, reason: "wrong", requester: requester(),
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.REFUND_NOT_ELIGIBLE });
  });

  it("rejects a refund amount above the order grand total", async () => {
    const h = await seed({ paymentState: "paid" });
    await expect(
      finance(h.orders).requestRefund({
        tenantId: "ten_test", outletId: "out_1", orderId: "ord_pay_1",
        amountIdr: 50_001, reason: "over", requester: requester(),
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it("rejects a refund filed against a different outlet of the order", async () => {
    const h = await seed({ paymentState: "paid" });
    await expect(
      finance(h.orders).requestRefund({
        tenantId: "ten_test", outletId: "out_OTHER", orderId: "ord_pay_1",
        amountIdr: 10_000, reason: "mismatch", requester: requester(),
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.OUTLET_MISMATCH });
  });

  it("rejects a cross-tenant refund as NOT_FOUND (no existence leak)", async () => {
    const h = await seed({ paymentState: "paid" });
    await expect(
      finance(h.orders).requestRefund({
        tenantId: "ten_ATTACKER", outletId: "out_1", orderId: "ord_pay_1",
        amountIdr: 10_000, reason: "cross", requester: requester(),
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });

  it("accepts a valid paid, in-outlet, capped refund and persists it", async () => {
    const h = await seed({ paymentState: "paid" });
    const refund = await finance(h.orders).requestRefund({
      tenantId: "ten_test", outletId: "out_1", orderId: "ord_pay_1",
      amountIdr: 50_000, reason: "full", requester: requester(),
    });
    expect(refund.status).toBe("pending");
    expect(refund.amountIdr).toBe(50_000);
  });
});



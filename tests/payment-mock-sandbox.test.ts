/**
 * Payment mock sandbox tests (Phase D Track B).
 */
import { describe, expect, it } from "vitest";
import { PaymentService } from "@/domain/payments/service";
import { MemoryOrders, MemoryAudit, fixedClock } from "./helpers/memory";
import { MemoryPayments } from "@/server/db/memory-store";
import { MockPaymentProvider } from "./helpers/mock-payment-provider";
import type { OrderRecord } from "@/domain/shared/ports";
import type { TenantScope } from "@/domain/shared/tenant-scope";

const CLOCK = fixedClock("2026-01-01T00:00:00.000Z");
const SCOPE: TenantScope = { organizationId: "ten_test" };

function placedOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "ord_pay_1",
    tenantId: "ten_test",
    outletId: "out_1",
    orderNumber: "ORD-00001",
    orderType: "take-away",
    tableId: null,
    customerId: null,
    lines: [],
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

async function seed() {
  const orders = new MemoryOrders();
  const payments = new MemoryPayments();
  const audit = new MemoryAudit();
  await orders.save(placedOrder());
  return { orders, payments, audit };
}
describe("PaymentService mock sandbox", () => {
  it("creates a payment intent using the persisted server-side order total", async () => {
    const { orders, payments, audit } = await seed();
    const provider = new MockPaymentProvider({ secret: "s", createStatus: "PENDING" });
    const service = new PaymentService({ orders, payments, audit, provider, clock: CLOCK });

    const result = await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "qris",
      idempotencyKey: "intent-1",
    });

    expect(result.intent.status).toBe("PENDING");
    expect(provider.intentRequests[0]?.amountIdr).toBe(50_000);
    const rows = await payments.listByOrder("ord_pay_1", SCOPE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountIdr).toBe(50_000);
    expect(rows[0]?.externalRef).toBe(result.intent.providerIntentId);
  });

  it("records provider success status on intent creation", async () => {
    const { orders, payments, audit } = await seed();
    const provider = new MockPaymentProvider({ secret: "s", createStatus: "PAID" });
    const service = new PaymentService({ orders, payments, audit, provider, clock: CLOCK });

    const result = await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "cash",
      idempotencyKey: "intent-success",
    });

    expect(result.intent.status).toBe("PAID");
  });

  it("records provider failure status on intent creation", async () => {
    const { orders, payments, audit } = await seed();
    const provider = new MockPaymentProvider({ secret: "s", failCreate: true });
    const service = new PaymentService({ orders, payments, audit, provider, clock: CLOCK });

    const result = await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "card",
      idempotencyKey: "intent-fail",
    });

    expect(result.intent.status).toBe("FAILED");
    expect(await payments.listByOrder("ord_pay_1", SCOPE)).toHaveLength(0);
  });
  it("rejects an invalid callback signature", async () => {
    const { orders, payments, audit } = await seed();
    const provider = new MockPaymentProvider({ secret: "s", createStatus: "PENDING" });
    const service = new PaymentService({ orders, payments, audit, provider, clock: CLOCK });
    const intent = await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "cash",
      idempotencyKey: "intent-sig",
    });

    const result = await service.verifyCallback({
      providerIntentId: intent.intent.providerIntentId,
      providerEventId: "evt-1",
      status: "PAID",
      signature: "wrong-signature",
      occurredAt: "2026-01-01T00:00:00.000Z",
      metadata: { tenantId: "ten_test" },
    });

    expect(result.accepted).toBe(false);
    const order = await orders.findById("ord_pay_1", SCOPE);
    expect(order?.paymentState).toBe("unpaid");
  });

  it("rejects a provider-rejected callback", async () => {
    const { orders, payments, audit } = await seed();
    const provider = new MockPaymentProvider({ secret: "s", createStatus: "PENDING", rejectCallback: true });
    const service = new PaymentService({ orders, payments, audit, provider, clock: CLOCK });
    const intent = await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "cash",
      idempotencyKey: "intent-rejected",
    });

    const result = await service.verifyCallback({
      providerIntentId: intent.intent.providerIntentId,
      providerEventId: "evt-rejected",
      status: "PAID",
      signature: provider.signatureFor(intent.intent.providerIntentId, "evt-rejected", "PAID", "2026-01-01T00:00:00.000Z", { tenantId: "ten_test" }),
      occurredAt: "2026-01-01T00:00:00.000Z",
      metadata: { tenantId: "ten_test" },
    });

    expect(result.accepted).toBe(false);
    expect(result.duplicate).toBe(false);
  });

  it("deduplicates replayed callback events", async () => {
    const { orders, payments, audit } = await seed();
    const provider = new MockPaymentProvider({ secret: "s", createStatus: "PENDING" });
    const service = new PaymentService({ orders, payments, audit, provider, clock: CLOCK });
    const intent = await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "cash",
      idempotencyKey: "intent-dup",
    });
    const signature = provider.signatureFor(intent.intent.providerIntentId, "evt-dup", "PAID", "2026-01-01T00:00:00.000Z", { tenantId: "ten_test" });

    const first = await service.verifyCallback({
      providerIntentId: intent.intent.providerIntentId,
      providerEventId: "evt-dup",
      status: "PAID",
      signature,
      occurredAt: "2026-01-01T00:00:00.000Z",
      metadata: { tenantId: "ten_test" },
    });
    const second = await service.verifyCallback({
      providerIntentId: intent.intent.providerIntentId,
      providerEventId: "evt-dup",
      status: "PAID",
      signature,
      occurredAt: "2026-01-01T00:00:00.000Z",
      metadata: { tenantId: "ten_test" },
    });

    expect(first.accepted).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(second.accepted).toBe(true);
    expect(second.duplicate).toBe(true);
    const order = await orders.findById("ord_pay_1", SCOPE);
    expect(order?.paymentState).toBe("paid");
  });
  it("does not correlate a callback to another tenant's payment", async () => {
    const { orders, payments, audit } = await seed();
    const provider = new MockPaymentProvider({ secret: "s", createStatus: "PENDING" });
    const service = new PaymentService({ orders, payments, audit, provider, clock: CLOCK });
    const intent = await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "cash",
      idempotencyKey: "intent-tenant",
    });
    const signature = provider.signatureFor(intent.intent.providerIntentId, "evt-tenant", "PAID", "2026-01-01T00:00:00.000Z", { tenantId: "ten_attacker" });

    const result = await service.verifyCallback({
      providerIntentId: intent.intent.providerIntentId,
      providerEventId: "evt-tenant",
      status: "PAID",
      signature,
      occurredAt: "2026-01-01T00:00:00.000Z",
      metadata: { tenantId: "ten_attacker" },
    });

    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(false);
    const order = await orders.findById("ord_pay_1", SCOPE);
    expect(order?.paymentState).toBe("unpaid");
  });

  it("rejects an amount mismatch when the callback carries an amount", async () => {
    const { orders, payments, audit } = await seed();
    const provider = new MockPaymentProvider({ secret: "s", createStatus: "PENDING" });
    const service = new PaymentService({ orders, payments, audit, provider, clock: CLOCK });
    const intent = await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "cash",
      idempotencyKey: "intent-amount",
    });
    const signature = provider.signatureFor(intent.intent.providerIntentId, "evt-amount", "PAID", "2026-01-01T00:00:00.000Z", { tenantId: "ten_test", amountIdr: 1 });

    const result = await service.verifyCallback({
      providerIntentId: intent.intent.providerIntentId,
      providerEventId: "evt-amount",
      status: "PAID",
      signature,
      occurredAt: "2026-01-01T00:00:00.000Z",
      metadata: { tenantId: "ten_test", amountIdr: 1 },
    });

    expect(result.accepted).toBe(false);
    const order = await orders.findById("ord_pay_1", SCOPE);
    expect(order?.paymentState).toBe("unpaid");
  });

  it("marks the order paid only on a valid PAID callback", async () => {
    const { orders, payments, audit } = await seed();
    const provider = new MockPaymentProvider({ secret: "s", createStatus: "PENDING" });
    const service = new PaymentService({ orders, payments, audit, provider, clock: CLOCK });
    const intent = await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "cash",
      idempotencyKey: "intent-paid",
    });
    const signature = provider.signatureFor(intent.intent.providerIntentId, "evt-paid", "PAID", "2026-01-01T00:00:00.000Z", { tenantId: "ten_test" });

    const result = await service.verifyCallback({
      providerIntentId: intent.intent.providerIntentId,
      providerEventId: "evt-paid",
      status: "PAID",
      signature,
      occurredAt: "2026-01-01T00:00:00.000Z",
      metadata: { tenantId: "ten_test" },
    });

    expect(result.accepted).toBe(true);
    expect(result.status).toBe("PAID");
    const order = await orders.findById("ord_pay_1", SCOPE);
    expect(order?.paymentState).toBe("paid");
  });

  it("does not mark the order paid for a non-PAID callback", async () => {
    const { orders, payments, audit } = await seed();
    const provider = new MockPaymentProvider({ secret: "s", createStatus: "PENDING" });
    const service = new PaymentService({ orders, payments, audit, provider, clock: CLOCK });
    const intent = await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "cash",
      idempotencyKey: "intent-failed-callback",
    });
    const signature = provider.signatureFor(intent.intent.providerIntentId, "evt-failed", "FAILED", "2026-01-01T00:00:00.000Z", { tenantId: "ten_test" });

    await service.verifyCallback({
      providerIntentId: intent.intent.providerIntentId,
      providerEventId: "evt-failed",
      status: "FAILED",
      signature,
      occurredAt: "2026-01-01T00:00:00.000Z",
      metadata: { tenantId: "ten_test" },
    });

    const order = await orders.findById("ord_pay_1", SCOPE);
    expect(order?.paymentState).toBe("unpaid");
  });

  it("handles concurrent duplicate events without double-processing", async () => {
    const { orders, payments, audit } = await seed();
    const provider = new MockPaymentProvider({ secret: "s", createStatus: "PENDING" });
    const service = new PaymentService({ orders, payments, audit, provider, clock: CLOCK });
    const intent = await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "cash",
      idempotencyKey: "intent-concurrent",
    });
    const signature = provider.signatureFor(intent.intent.providerIntentId, "evt-concurrent", "PAID", "2026-01-01T00:00:00.000Z", { tenantId: "ten_test" });
    const params = {
      providerIntentId: intent.intent.providerIntentId,
      providerEventId: "evt-concurrent",
      status: "PAID" as const,
      signature,
      occurredAt: "2026-01-01T00:00:00.000Z",
      metadata: { tenantId: "ten_test" },
    };

    const [a, b] = await Promise.all([
      service.verifyCallback(params),
      service.verifyCallback(params),
    ]);

    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    const order = await orders.findById("ord_pay_1", SCOPE);
    expect(order?.paymentState).toBe("paid");
  });

  it("reuses an existing payment row for the same provider intent on retry", async () => {
    const { orders, payments, audit } = await seed();
    const provider = new MockPaymentProvider({ secret: "s", createStatus: "PENDING" });
    const service = new PaymentService({ orders, payments, audit, provider, clock: CLOCK });

    const first = await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "cash",
      idempotencyKey: "intent-retry",
    });
    const second = await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "cash",
      idempotencyKey: "intent-retry",
    });

    expect(second.intent.providerIntentId).toBe(first.intent.providerIntentId);
    expect(second.paymentId).toBe(first.paymentId);
    const rows = await payments.listByOrder("ord_pay_1", SCOPE);
    expect(rows).toHaveLength(1);
  });

  it("rejects a callback whose signed metadata is tampered with", async () => {
    const { orders, payments, audit } = await seed();
    const provider = new MockPaymentProvider({ secret: "s", createStatus: "PENDING" });
    const service = new PaymentService({ orders, payments, audit, provider, clock: CLOCK });
    const intent = await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "cash",
      idempotencyKey: "intent-tamper-meta",
    });
    const signature = provider.signatureFor(
      intent.intent.providerIntentId,
      "evt-tamper-meta",
      "PAID",
      "2026-01-01T00:00:00.000Z",
      { tenantId: "ten_test" },
    );

    const result = await service.verifyCallback({
      providerIntentId: intent.intent.providerIntentId,
      providerEventId: "evt-tamper-meta",
      status: "PAID",
      signature,
      occurredAt: "2026-01-01T00:00:00.000Z",
      metadata: { tenantId: "ten_attacker" },
    });

    expect(result.accepted).toBe(false);
    const order = await orders.findById("ord_pay_1", SCOPE);
    expect(order?.paymentState).toBe("unpaid");
  });

  it("rejects a duplicate event id with an altered payload", async () => {
    const { orders, payments, audit } = await seed();
    const provider = new MockPaymentProvider({ secret: "s", createStatus: "PENDING" });
    const service = new PaymentService({ orders, payments, audit, provider, clock: CLOCK });
    const intent = await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "cash",
      idempotencyKey: "intent-altered-dup",
    });
    const signature = provider.signatureFor(
      intent.intent.providerIntentId,
      "evt-altered-dup",
      "PAID",
      "2026-01-01T00:00:00.000Z",
      { tenantId: "ten_test" },
    );

    const first = await service.verifyCallback({
      providerIntentId: intent.intent.providerIntentId,
      providerEventId: "evt-altered-dup",
      status: "PAID",
      signature,
      occurredAt: "2026-01-01T00:00:00.000Z",
      metadata: { tenantId: "ten_test" },
    });
    const second = await service.verifyCallback({
      providerIntentId: intent.intent.providerIntentId,
      providerEventId: "evt-altered-dup",
      status: "FAILED",
      signature,
      occurredAt: "2026-01-01T00:00:00.000Z",
      metadata: { tenantId: "ten_test" },
    });

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    const order = await orders.findById("ord_pay_1", SCOPE);
    expect(order?.paymentState).toBe("paid");
  });

  it("rejects idempotency-key reuse across different orders", async () => {
    const { orders, payments, audit } = await seed();
    const provider = new MockPaymentProvider({ secret: "s", createStatus: "PENDING" });
    const service = new PaymentService({ orders, payments, audit, provider, clock: CLOCK });
    await orders.save(placedOrder({ id: "ord_pay_2", orderNumber: "ORD-00002" }));

    await service.createPaymentIntent({
      orderId: "ord_pay_1",
      scope: SCOPE,
      actorId: "usr_pos",
      method: "cash",
      idempotencyKey: "shared-key",
    });

    await expect(
      service.createPaymentIntent({
        orderId: "ord_pay_2",
        scope: SCOPE,
        actorId: "usr_pos",
        method: "cash",
        idempotencyKey: "shared-key",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_STATE_INVALID" });
  });
});
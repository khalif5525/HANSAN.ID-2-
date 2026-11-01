/**
 * Order lifecycle operations (Phase A2) — state transitions, payment
 * capture, cancellation, refund requests. Pure orchestration over
 * ports; audit emitted for every security-relevant action.
 */
import { AppError, ERROR_CODES } from "@/domain/shared/errors";
import { createId } from "@/domain/shared/ids";
import { AUDIT_ACTIONS, type AuditEvent, type AuditLogPort } from "@/domain/audit/events";
import type { OrderPort, OrderRecord, OrderState, PaymentPort, PaymentRecord, PayMethod } from "@/domain/shared/ports";
import type { TenantScope } from "@/domain/shared/tenant-scope";
import { assertOrderTransition, assertPaymentTransition } from "@/domain/pos/order-state";
import {
  canCancelOrder,
  canCapturePayment,
  isRefundEligible,
  DEFAULT_REFUND_POLICY,
  type RefundPolicy,
} from "@/domain/pos/rules";

export interface LifecycleDeps {
  orders: OrderPort;
  audit: AuditLogPort;
  clock: () => Date;
}

/**
 * Payment capture additionally requires a PaymentPort. We keep it separate from
 * LifecycleDeps so non-payment operations (KDS transitions, cancellation) never
 * need a payment store — but ANY code path that marks an order "paid" MUST
 * persist a matching Payment row (see capturePayment).
 */
export interface PaymentLifecycleDeps extends LifecycleDeps {
  payments: PaymentPort;
}

/**
 * Phase 12 — `scope` is REQUIRED for every order read. It MUST be derived from
 * the authoritative, revalidated actor/session (never a request-body org/outlet
 * id). The adapter enforces it at the query boundary, so a cross-tenant or
 * wrong-outlet read resolves to null → NOT_FOUND (non-leaking). There is no
 * unscoped fallback: missing/ambiguous scope fails closed.
 */
export async function requireOrder(orders: OrderPort, orderId: string, scope: TenantScope): Promise<OrderRecord> {
  const order = await orders.findById(orderId, scope);
  if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, { message: "Order not found" });
  return order;
}

async function audit(
  auditPort: AuditLogPort,
  event: Omit<AuditEvent, "id">,
): Promise<void> {
  await auditPort.record({ ...event, id: createId("aud") });
}

export async function transitionOrder(
  deps: LifecycleDeps,
  orderId: string,
  scope: TenantScope,
  to: OrderState,
  actorId: string,
): Promise<OrderRecord> {
  const order = await requireOrder(deps.orders, orderId, scope);
  assertOrderTransition(order.state, to);
  const updated: OrderRecord = { ...order, state: to, updatedAt: deps.clock().toISOString() };
  await deps.orders.save(updated);
  if (to === "cancelled") {
    await audit(deps.audit, {
      action: AUDIT_ACTIONS.ORDER_CANCELLED,
      actorId,
      actorRole: "system",
      entityType: "order",
      entityId: order.id,
      tenantId: order.tenantId,
      outletId: order.outletId,
      occurredAt: updated.updatedAt,
      metadata: { previousState: order.state },
    });
  }
  return updated;
}

/**
 * Capture payment for an order.
 *
 * Integrity guarantee (Phase 5): an order is NEVER reported "paid" without a
 * matching persisted Payment row. Finance totals are defined as SUMs over
 * Payment rows (prisma/schema.prisma `model Payment`), so flipping
 * `paymentState` alone would desynchronize the ledger from the order. The
 * Payment row is written FIRST; if the subsequent order save fails we surface
 * the error (the caller retries under the same Idempotency-Key, and the guard
 * in `canCapturePayment`/the Prisma transactional adapter prevent a double
 * capture).
 *
 * `method` is mandatory — a capture with no tender type cannot be settled or
 * reconciled, so we refuse to record one.
 */
export async function capturePayment(
  deps: PaymentLifecycleDeps,
  orderId: string,
  scope: TenantScope,
  actorId: string,
  method: PayMethod,
): Promise<OrderRecord> {
  if (!method) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, { message: "Payment method is required" });
  }
  const order = await requireOrder(deps.orders, orderId, scope);
  const allowed = canCapturePayment(order);
  if (!allowed.ok) throw allowed.error;
  assertPaymentTransition(order.paymentState, "paid");
  const now = deps.clock().toISOString();

  // Persist the Payment row first — the ledger entry is the source of truth.
  const payment: PaymentRecord = {
    id: createId("pay"),
    tenantId: order.tenantId,
    outletId: order.outletId,
    orderId: order.id,
    ...(order.dataScope ? { dataScope: order.dataScope } : {}),
    amountIdr: order.grandTotalIdr,
    method,
    capturedBy: actorId,
    capturedAt: now,
    externalRef: null,
  };
  await deps.payments.save(payment);

  const updated: OrderRecord = { ...order, paymentState: "paid", updatedAt: now };
  await deps.orders.save(updated);
  await audit(deps.audit, {
    action: AUDIT_ACTIONS.PAYMENT_CAPTURED,
    actorId,
    actorRole: "system",
    entityType: "order",
    entityId: order.id,
    tenantId: order.tenantId,
    outletId: order.outletId,
    occurredAt: now,
    metadata: { amountIdr: order.grandTotalIdr, method, paymentId: payment.id },
  });
  return updated;
}

export async function cancelOrder(
  deps: LifecycleDeps,
  orderId: string,
  scope: TenantScope,
  actorId: string,
): Promise<OrderRecord> {
  const order = await requireOrder(deps.orders, orderId, scope);
  const allowed = canCancelOrder(order);
  if (!allowed.ok) throw allowed.error;
  assertOrderTransition(order.state, "cancelled");
  const now = deps.clock().toISOString();
  const updated: OrderRecord = { ...order, state: "cancelled", updatedAt: now };
  await deps.orders.save(updated);
  await audit(deps.audit, {
    action: AUDIT_ACTIONS.ORDER_CANCELLED,
    actorId,
    actorRole: "system",
    entityType: "order",
    entityId: order.id,
    tenantId: order.tenantId,
    outletId: order.outletId,
    occurredAt: now,
    metadata: { previousState: order.state },
  });
  return updated;
}

export async function requestRefund(
  deps: LifecycleDeps,
  orderId: string,
  scope: TenantScope,
  actorId: string,
  policy: RefundPolicy = DEFAULT_REFUND_POLICY,
): Promise<OrderRecord> {
  const order = await requireOrder(deps.orders, orderId, scope);
  const eligible = isRefundEligible(order, deps.clock(), policy);
  if (!eligible.ok) throw eligible.error;
  assertOrderTransition(order.state, "refund_requested");
  const now = deps.clock().toISOString();
  const updated: OrderRecord = { ...order, state: "refund_requested", paymentState: "refunding", updatedAt: now };
  await deps.orders.save(updated);
  await audit(deps.audit, {
    action: AUDIT_ACTIONS.REFUND_REQUESTED,
    actorId,
    actorRole: "system",
    entityType: "order",
    entityId: order.id,
    tenantId: order.tenantId,
    outletId: order.outletId,
    occurredAt: now,
    metadata: { amountIdr: order.grandTotalIdr },
  });
  return updated;
}

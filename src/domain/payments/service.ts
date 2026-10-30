/**
 * Payment service (Phase E1) — provider-agnostic payment orchestration.
 */
import { AppError, ERROR_CODES } from '@/domain/shared/errors';
import { createId } from '@/domain/shared/ids';
import { AUDIT_ACTIONS, type AuditLogPort } from '@/domain/audit/events';
import type { OrderPort, OrderRecord, PaymentRecord, PayMethod, PaymentPort } from '@/domain/shared/ports';
import type { TenantScope } from '@/domain/shared/tenant-scope';
import type { PaymentProviderAdapter, PaymentIntentResult } from './adapter';
import type { PaymentStatus } from './state-machine';

export interface PaymentServiceDeps {
  orders: OrderPort;
  payments: PaymentPort;
  audit: AuditLogPort;
  provider: PaymentProviderAdapter;
  clock: () => Date;
}

export function methodToProviderMethod(method: PayMethod): string {
  switch (method) {
    case 'cash': return 'cash';
    case 'qris': return 'qris';
    case 'card': return 'card';
    case 'transfer': return 'transfer';
    default: throw new AppError(ERROR_CODES.VALIDATION_FAILED, { message: 'Unknown payment method: ' + method });
  }
}

export { type PaymentStatus };

export class PaymentService {
  constructor(private readonly deps: PaymentServiceDeps) {}

  async createPaymentIntent(params: {
    orderId: string;
    scope: TenantScope;
    actorId: string;
    method: PayMethod;
    idempotencyKey: string;
  }): Promise<{ paymentId: string; intent: PaymentIntentResult }> {
    const { orderId, scope, actorId, method, idempotencyKey } = params;

    const order = await this.deps.orders.findById(orderId, scope);
    if (!order) {
      throw new AppError(ERROR_CODES.NOT_FOUND, { message: 'Order not found' });
    }
    if (order.paymentState !== 'unpaid') {
      throw new AppError(ERROR_CODES.PAYMENT_STATE_INVALID, {
        message: 'Order ' + orderId + ' is already ' + order.paymentState,
      });
    }

    const paymentId = createId('pay');

    const intent = await this.deps.provider.createIntent({
      idempotencyKey,
      amountIdr: order.grandTotalIdr,
      description: 'Order ' + order.orderNumber,
      orderId: order.id,
      customerReference: order.orderNumber,
      metadata: {
        tenantId: order.tenantId,
        outletId: order.outletId,
        paymentId,
      },
    });

    if (intent.status === "FAILED") {
      // No local payment row is written for a failed provider intent. A retry
      // under the same idempotency key re-runs this path; the provider is
      // expected to be idempotent on that key.
      return { paymentId, intent };
    }

    // Idempotent local persistence: if a prior attempt already stored a payment
    // row for this provider intent (for example after an audit failure or a
    // partial retry), reuse it instead of appending a duplicate ledger row.
    // This is a best-effort application-level guard; it is NOT a substitute for
    // a database unique constraint on (tenant, externalRef) or a transaction
    // wrapping provider+local writes.
    const existingPayment = (await this.deps.payments.listByTenant(order.tenantId))
      .find((p) => p.externalRef === intent.providerIntentId);
    if (existingPayment) {
      // Idempotency keys are caller-supplied. Reusing one for a different
      // order/tenant/amount must not alias an existing payment row to the new
      // request; reject instead of returning another order's payment id.
      if (
        existingPayment.orderId !== order.id ||
        existingPayment.tenantId !== order.tenantId ||
        existingPayment.amountIdr !== order.grandTotalIdr
      ) {
        throw new AppError(ERROR_CODES.PAYMENT_STATE_INVALID, {
          message:
            'Idempotency key ' + idempotencyKey +
            ' resolves to an existing payment for a different order/tenant/amount',
        });
      }
      return { paymentId: existingPayment.id, intent };
    }

    const payment: PaymentRecord = {
      id: paymentId,
      tenantId: order.tenantId,
      outletId: order.outletId,
      orderId: order.id,
      ...(order.dataScope ? { dataScope: order.dataScope } : {}),
      amountIdr: order.grandTotalIdr,
      method,
      capturedBy: actorId,
      capturedAt: this.deps.clock().toISOString(),
      externalRef: intent.providerIntentId,
    };
    await this.deps.payments.save(payment);

    await this.deps.audit.record({
      id: createId('aud'),
      action: AUDIT_ACTIONS.PAYMENT_CAPTURED,
      actorId,
      actorRole: 'system',
      entityType: 'payment',
      entityId: payment.id,
      tenantId: order.tenantId,
      outletId: order.outletId,
      occurredAt: payment.capturedAt,
      metadata: {
        amountIdr: order.grandTotalIdr,
        method,
        providerIntentId: intent.providerIntentId,
        status: intent.status,
      },
    });

    return { paymentId: payment.id, intent };
  }

  async verifyCallback(params: {
    providerIntentId: string;
    providerEventId: string;
    status: PaymentStatus;
    signature: string;
    occurredAt: string;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<{ accepted: boolean; duplicate: boolean; status: PaymentStatus }> {
    const result = await this.deps.provider.verifyCallback({
      providerIntentId: params.providerIntentId,
      providerEventId: params.providerEventId,
      status: params.status,
      signature: params.signature,
      occurredAt: params.occurredAt,
      metadata: params.metadata,
    });

    if (!result.accepted) {
      return { accepted: false, duplicate: result.duplicate, status: result.status };
    }

    const tenantHint =
      typeof params.metadata?.tenantId === "string" ? params.metadata.tenantId : null;
    const payments = tenantHint
      ? await this.deps.payments.listByTenant(tenantHint)
      : await this.deps.payments.listByTenant("__scan__");
    const matching = payments.find((p) => p.externalRef === params.providerIntentId);
    if (!matching) {
      await this.deps.audit.record({
        id: createId('aud'),
        action: AUDIT_ACTIONS.PAYMENT_CAPTURED,
        actorId: 'system',
        actorRole: 'system',
        entityType: 'payment',
        entityId: params.providerIntentId,
        tenantId: '__unknown__',
        outletId: '__unknown__',
        occurredAt: params.occurredAt,
        metadata: { providerEventId: params.providerEventId, status: result.status, unmatched: true },
      });
      return { accepted: true, duplicate: false, status: result.status };
    }

    const order = await this.deps.orders.findById(matching.orderId, {
      organizationId: matching.tenantId,
    });

    // Correlate a callback-declared amount against the trusted persisted payment
    // row and order total. The provider's signature is assumed to cover the
    // amount in production; this is a second line of defense and rejects
    // tampered/mismatched amounts without mutating order state.
    const callbackAmount =
      typeof params.metadata?.amountIdr === 'number' ? params.metadata.amountIdr : null;
    if (
      callbackAmount !== null &&
      (callbackAmount !== matching.amountIdr || (order && callbackAmount !== order.grandTotalIdr))
    ) {
      await this.deps.audit.record({
        id: createId('aud'),
        action: AUDIT_ACTIONS.PAYMENT_CAPTURED,
        actorId: 'system',
        actorRole: 'system',
        entityType: 'payment',
        entityId: matching.id,
        tenantId: matching.tenantId,
        outletId: matching.outletId,
        occurredAt: params.occurredAt,
        metadata: {
          providerEventId: params.providerEventId,
          providerIntentId: params.providerIntentId,
          status: result.status,
          amountMismatch: true,
          callbackAmountIdr: callbackAmount,
          persistedAmountIdr: matching.amountIdr,
        },
      });
      return { accepted: false, duplicate: false, status: result.status };
    }

    // Only an unpaid, payable order may be flipped to paid. A callback that
    // arrives for a cancelled/refunded/non-payable order is acknowledged but
    // does not mutate state. PAID is terminal for captures; a duplicate PAID
    // event for an already-paid order is not re-applied.
    const canMarkPaid =
      !!order &&
      !result.duplicate &&
      result.status === 'PAID' &&
      order.paymentState === 'unpaid' &&
      order.state !== 'cancelled' &&
      order.state !== 'refunded' &&
      order.state !== 'refund_requested' &&
      order.state !== 'draft';

    if (canMarkPaid && order) {
      const updated: OrderRecord = {
        ...order,
        paymentState: 'paid',
        updatedAt: this.deps.clock().toISOString(),
      };
      await this.deps.orders.save(updated);
      await this.deps.audit.record({
        id: createId('aud'),
        action: AUDIT_ACTIONS.PAYMENT_CAPTURED,
        actorId: 'system',
        actorRole: 'system',
        entityType: 'order',
        entityId: order.id,
        tenantId: order.tenantId,
        outletId: order.outletId,
        occurredAt: updated.updatedAt,
        metadata: {
          amountIdr: order.grandTotalIdr,
          method: matching.method,
          providerIntentId: params.providerIntentId,
          providerConfirmed: true,
        },
      });
    }

    return { accepted: true, duplicate: result.duplicate, status: result.status };
  }
}

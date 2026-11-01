/**
 * FinanceService (Phase A5) — expense recording, refund workflow
 * (request → approve/reject → complete, cash-only, separation of
 * duties), and summary reporting from real records.
 */
import { AppError, ERROR_CODES } from "@/domain/shared/errors";
import { createId } from "@/domain/shared/ids";
import { AUDIT_ACTIONS, type AuditLogPort } from "@/domain/audit/events";
import type { FinancePort, ExpenseRecord, RefundRecord } from "@/domain/finance/ports";
import type { OrderPort, UserRecord } from "@/domain/shared/ports";
import type { DevRole } from "@/types/roles";
import { canDecideRefund, canTransitionRefund, validateRefundMethod } from "@/domain/finance/rules";
import { summarizeFinancials, type FinancialSummary } from "@/domain/finance/reporting";

export interface FinanceServiceDeps {
  finance: FinancePort;
  orders: OrderPort;
  audit: AuditLogPort;
  clock: () => Date;
}

export class FinanceService {
  constructor(private readonly deps: FinanceServiceDeps) {}

  async recordExpense(params: {
    actor: UserRecord;
    tenantId: string;
    outletId: string;
    category: string;
    description: string;
    amountIdr: number;
    incurredAtIso: string;
  }): Promise<ExpenseRecord> {
    const { actor, tenantId, outletId, category, description, amountIdr, incurredAtIso } = params;
    if (!Number.isInteger(amountIdr) || amountIdr <= 0) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, { message: "Expense must be a positive integer amount" });
    }
    const expense: ExpenseRecord = {
      id: createId("exp"),
      tenantId,
      outletId,
      category: category.trim(),
      description: description.trim(),
      amountIdr,
      incurredAt: incurredAtIso,
      createdBy: actor.id,
    };
    await this.deps.finance.saveExpense(expense);
    return expense;
  }

  /**
   * POS-side refund request: validates order + cash method + persists.
   *
   * Integrity guards (Phase 5):
   *   * the order must exist AND belong to the caller's tenant (cross-tenant
   *     refund requests are rejected as NOT_FOUND, never leaking existence);
   *   * the order must belong to the claimed outlet (a refund cannot be filed
   *     against a different outlet's order);
   *   * the order must actually be PAID — refunding an unpaid/cancelled order
   *     would move money that was never captured;
   *   * the refund amount cannot exceed the order's grand total (a refund is a
   *     reversal of captured revenue, not a payout beyond it).
   */
  async requestRefund(params: {
    tenantId: string;
    outletId: string;
    orderId: string;
    amountIdr: number;
    reason: string;
    requester: UserRecord;
  }): Promise<RefundRecord> {
    const method = validateRefundMethod("cash");
    if (!method.ok) throw method.error;
    if (!Number.isInteger(params.amountIdr) || params.amountIdr <= 0) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, { message: "Refund amount must be a positive integer" });
    }
    // Phase 12 — scoped read: `params.tenantId` MUST be the verified actor's
    // tenant (never a request-body organization id). A cross-tenant orderId
    // resolves to null here → NOT_FOUND below, so existence never leaks; the
    // adapter enforces the scope at the query boundary (no unscoped fallback).
    const order = await this.deps.orders.findById(params.orderId, { organizationId: params.tenantId });
    if (!order || order.tenantId !== params.tenantId) {
      throw new AppError(ERROR_CODES.NOT_FOUND, { message: "Order not found" });
    }
    if (order.outletId !== params.outletId) {
      throw new AppError(ERROR_CODES.OUTLET_MISMATCH, {
        message: "Refund outlet does not match the order's outlet",
      });
    }
    if (order.paymentState !== "paid") {
      throw new AppError(ERROR_CODES.REFUND_NOT_ELIGIBLE, {
        message: "Only paid orders can be refunded",
      });
    }
    if (params.amountIdr > order.grandTotalIdr) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
        message: "Refund amount cannot exceed the order total",
      });
    }
    const refund: RefundRecord = {
      id: createId("ref"),
      tenantId: params.tenantId,
      outletId: params.outletId,
      orderId: params.orderId,
      amountIdr: params.amountIdr,
      method: "cash",
      reason: params.reason,
      status: "pending",
      requestedBy: params.requester.id,
      createdAt: this.deps.clock().toISOString(),
    };
    await this.deps.finance.saveRefund(refund);
    await this.deps.audit.record({
      id: createId("aud"),
      action: AUDIT_ACTIONS.REFUND_REQUESTED,
      actorId: params.requester.id,
      actorRole: "system",
      entityType: "refund",
      entityId: refund.id,
      tenantId: refund.tenantId,
      outletId: refund.outletId,
      occurredAt: refund.createdAt,
      metadata: { amountIdr: refund.amountIdr, orderId: refund.orderId },
    });
    return refund;
  }

  /** Approve/reject: Manager/Back-Office only + separation of duties. */
  async decideRefund(refundId: string, decision: "approved" | "rejected", actor: UserRecord): Promise<RefundRecord> {
    const refund = await this.deps.finance.getRefund(refundId, actor.tenantId);
    if (!refund) throw new AppError(ERROR_CODES.NOT_FOUND, { message: "Refund not found" });
    const allowed = canDecideRefund({ refund, actorId: actor.id, actorRole: actor.role });
    if (!allowed.ok) throw allowed.error;
    if (!canTransitionRefund(refund.status, decision)) {
      throw new AppError(ERROR_CODES.REFUND_ALREADY_DECIDED);
    }
    const decidedAt = this.deps.clock().toISOString();
    const updated = await this.deps.finance.transitionRefundWithAudit(
      {
        id: refundId,
        organizationId: actor.tenantId,
        expectedStatus: refund.status,
        patch: { status: decision, decidedBy: actor.id, decidedAt },
      },
      {
        id: createId("aud"),
        action: decision === "approved" ? AUDIT_ACTIONS.REFUND_APPROVED : AUDIT_ACTIONS.REFUND_REJECTED,
        actorId: actor.id,
        actorRole: actor.role as DevRole,
        entityType: "refund",
        entityId: refund.id,
        tenantId: refund.tenantId,
        outletId: refund.outletId,
        occurredAt: decidedAt,
        metadata: { amountIdr: refund.amountIdr },
      },
    );
    if (!updated) {
      // Another request transitioned this refund first — replay-safe conflict.
      throw new AppError(ERROR_CODES.CONFLICT, {
        message: "Refund was already decided by another request",
      });
    }
    return updated;
  }

  /** Complete an approved cash refund (executes the payout). */
  async completeRefund(refundId: string, actor: UserRecord): Promise<RefundRecord> {
    const refund = await this.deps.finance.getRefund(refundId, actor.tenantId);
    if (!refund) throw new AppError(ERROR_CODES.NOT_FOUND, { message: "Refund not found" });
    if (!canTransitionRefund(refund.status, "completed")) {
      throw new AppError(ERROR_CODES.REFUND_ALREADY_DECIDED, {
        message: `Cannot complete a ${refund.status} refund`,
      });
    }
    const method = validateRefundMethod(refund.method);
    if (!method.ok) throw method.error;
    const completedAt = this.deps.clock().toISOString();
    const updated = await this.deps.finance.transitionRefundWithAudit(
      {
        id: refundId,
        organizationId: actor.tenantId,
        expectedStatus: refund.status,
        patch: { status: "completed" },
      },
      {
        id: createId("aud"),
        action: AUDIT_ACTIONS.REFUND_COMPLETED,
        actorId: actor.id,
        actorRole: actor.role as DevRole,
        entityType: "refund",
        entityId: refund.id,
        tenantId: refund.tenantId,
        outletId: refund.outletId,
        occurredAt: completedAt,
        metadata: { amountIdr: refund.amountIdr },
      },
    );
    if (!updated) {
      throw new AppError(ERROR_CODES.CONFLICT, {
        message: "Refund was already completed by another request",
      });
    }
    return updated;
  }

  /** Summary from REAL records (empty database ⇒ zeros, §4). */
  async summary(tenantId: string, sinceIso?: string): Promise<FinancialSummary> {
    const orders = await this.deps.orders.listByTenant(tenantId, {
      limit: 200,
      ...(sinceIso ? { sinceIso } : {}),
    });
    const paid = orders.filter(
      (o) => o.paymentState === "paid" || o.paymentState === "refunding",
    );
    const expenses = await this.deps.finance.listExpenses(tenantId, sinceIso);
    const refunds = await this.deps.finance.listRefunds(tenantId);
    return summarizeFinancials({
      paidOrders: paid.map((o) => ({
        grandTotalIdr: o.grandTotalIdr,
        taxIdr: o.taxIdr,
        discountIdr: o.discountIdr,
      })),
      expenses: expenses.map((e) => ({ amountIdr: e.amountIdr, category: e.category })),
      completedRefunds: refunds.filter((r) => r.status === "completed").map((r) => ({ amountIdr: r.amountIdr })),
    });
  }
}
/** Finance repository ports (Phase A5). */

export interface ExpenseRecord {
  id: string;
  tenantId: string;
  outletId: string;
  category: string;
  description: string;
  amountIdr: number;
  incurredAt: string;
  createdBy: string;
}

export interface RefundRecord {
  id: string;
  tenantId: string;
  outletId: string;
  orderId: string;
  amountIdr: number;
  method: "cash";
  reason: string;
  status: "pending" | "approved" | "rejected" | "completed";
  requestedBy: string;
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
}

export interface FinancePort {
  saveExpense(e: ExpenseRecord): Promise<void>;
  listExpenses(tenantId: string, sinceIso?: string): Promise<ExpenseRecord[]>;
  /** Tenant-scoped read: organizationId is server-derived, never from the client. */
  getRefund(id: string, organizationId: string): Promise<RefundRecord | null>;
  saveRefund(r: RefundRecord): Promise<void>;
  listRefunds(tenantId: string): Promise<RefundRecord[]>;
  /** Atomic conditional transition: only succeeds if the refund is still in `expectedStatus` and belongs to `organizationId`. */
  transitionRefund(params: {
    id: string;
    organizationId: string;
    expectedStatus: RefundRecord["status"];
    patch: Partial<Pick<RefundRecord, "status" | "decidedBy" | "decidedAt">>;
  }): Promise<RefundRecord | null>;
  /**
   * Atomically applies a conditional refund state transition and records the
   * corresponding audit event in a single database transaction (production).
   * Demo implementation performs both sequentially (single-process, audit sink
   * never throws). Returns null if the conditional update does not match
   * (concurrent modification or already-decided refund) — in that case no audit
   * event is recorded.
   */
  transitionRefundWithAudit(params: {
    id: string;
    organizationId: string;
    expectedStatus: RefundRecord["status"];
    patch: Partial<Pick<RefundRecord, "status" | "decidedBy" | "decidedAt">>;
  }, auditEvent: { id: string; action: string; actorId: string; actorRole: string; entityType: string; entityId: string; tenantId: string; outletId: string; occurredAt: string; metadata?: Record<string, string | number | boolean> }): Promise<RefundRecord | null>;
}

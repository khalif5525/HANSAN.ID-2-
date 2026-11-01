/**
 * Prisma adapter for FinancePort (refunds).
 *
 * Used ONLY in PRODUCTION scope; the demo sandbox uses MemoryFinance so demo
 * refunds never reach Postgres.
 *
 * All mutations pin tenant GUCs first inside a transaction so writes satisfy
 * RLS WITH CHECK and reads are tenant-bound. `transitionRefund` uses a
 * conditional `update where { id, status: expectedStatus }` so two concurrent
 * approval/processing requests cannot both transition the same refund.
 */
import type { PrismaClient } from "@prisma/client";
import { AppError, ERROR_CODES } from "@/domain/shared/errors";
import type {
  ExpenseRecord,
  FinancePort,
  RefundRecord,
} from "@/domain/finance/ports";
import { pinTenantContext, persistencePinContext } from "@/server/db/tenant-context";

function asPinTx(tx: unknown): Parameters<typeof pinTenantContext>[0] {
  return tx as Parameters<typeof pinTenantContext>[0];
}

function toRefundRecord(row: {
  id: string;
  organizationId: string;
  outletId: string;
  orderId: string;
  amountIdr: bigint;
  reason: string;
  status: string;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}): RefundRecord {
  return {
    id: row.id,
    tenantId: row.organizationId,
    outletId: row.outletId,
    orderId: row.orderId,
    amountIdr: Number(row.amountIdr),
    method: "cash",
    reason: row.reason,
    status: row.status as RefundRecord["status"],
    requestedBy: row.requestedBy,
    decidedBy: row.decidedBy ?? undefined,
    decidedAt: row.decidedAt?.toISOString() ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PrismaFinance implements FinancePort {
  constructor(private readonly db: PrismaClient) {}

  async saveExpense(_e: ExpenseRecord): Promise<void> {
    void _e;
    throw new AppError(ERROR_CODES.PERSISTENCE_NOT_CONFIGURED, {
      message: "Expense persistence is not configured on this deployment",
    });
  }

  async listExpenses(_tenantId: string, _sinceIso?: string): Promise<ExpenseRecord[]> {
    void _tenantId;
    void _sinceIso;
    throw new AppError(ERROR_CODES.PERSISTENCE_NOT_CONFIGURED, {
      message: "Expense persistence is not configured on this deployment",
    });
  }

  async getRefund(id: string, organizationId: string): Promise<RefundRecord | null> {
    const row = await this.db.refund.findUnique({
      where: { id, organizationId },
    });
    if (!row) return null;
    return toRefundRecord(row);
  }

  async saveRefund(r: RefundRecord): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await pinTenantContext(
        asPinTx(tx),
        persistencePinContext(r.tenantId, r.outletId),
      );
      await tx.refund.upsert({
        where: { id: r.id },
        create: {
          id: r.id,
          organizationId: r.tenantId,
          outletId: r.outletId,
          orderId: r.orderId,
          dataScope: "PRODUCTION",
          amountIdr: BigInt(r.amountIdr),
          reason: r.reason,
          status: r.status,
          requestedBy: r.requestedBy,
          decidedBy: r.decidedBy ?? null,
          decidedAt: r.decidedAt ? new Date(r.decidedAt) : null,
          createdAt: new Date(r.createdAt),
        },
        update: {
          status: r.status,
          decidedBy: r.decidedBy ?? null,
          decidedAt: r.decidedAt ? new Date(r.decidedAt) : null,
        },
      });
    });
  }

  /**
   * Atomic conditional transition. Only succeeds if the refund is still in
   * `expectedStatus`; returns null otherwise (concurrent modification or
   * already-decided refund).
   */
  async transitionRefund(params: {
    id: string;
    organizationId: string;
    expectedStatus: RefundRecord["status"];
    patch: Partial<Pick<RefundRecord, "status" | "decidedBy" | "decidedAt">>;
  }): Promise<RefundRecord | null> {
    return this.db.$transaction(async (tx) => {
      await pinTenantContext(
        asPinTx(tx),
        persistencePinContext(params.organizationId, null),
      );
      try {
        const row = await tx.refund.update({
          where: { id: params.id, organizationId: params.organizationId, status: params.expectedStatus },
          data: {
            ...(params.patch.status !== undefined
              ? { status: params.patch.status }
              : {}),
            ...(params.patch.decidedBy !== undefined
              ? { decidedBy: params.patch.decidedBy }
              : {}),
            ...(params.patch.decidedAt !== undefined
              ? { decidedAt: new Date(params.patch.decidedAt) }
              : {}),
          },
        });
        return toRefundRecord(row);
      } catch {
        // Prisma P2025: record to update not found — status changed concurrently
        // or refund already decided, or cross-tenant (no row matches id+org+status).
        return null;
      }
    });
  }

  /**
   * Atomically applies a conditional refund state transition and records the
   * corresponding audit event in a single database transaction. Either both
   * commit together or neither does — there is no window where a refund is
   * decided without its audit trail.
   *
   * Returns null if the conditional update does not match (concurrent
   * modification, already-decided refund, or cross-tenant) — in that case no
   * audit event is recorded.
   */
  async transitionRefundWithAudit(params: {
    id: string;
    organizationId: string;
    expectedStatus: RefundRecord["status"];
    patch: Partial<Pick<RefundRecord, "status" | "decidedBy" | "decidedAt">>;
  }, auditEvent: {
    id: string;
    action: string;
    actorId: string;
    actorRole: string;
    entityType: string;
    entityId: string;
    tenantId: string;
    outletId: string;
    occurredAt: string;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<RefundRecord | null> {
    return this.db.$transaction(async (tx) => {
      await pinTenantContext(
        asPinTx(tx),
        persistencePinContext(params.organizationId, null),
      );
      try {
        const row = await tx.refund.update({
          where: {
            id: params.id,
            organizationId: params.organizationId,
            status: params.expectedStatus,
          },
          data: {
            ...(params.patch.status !== undefined
              ? { status: params.patch.status }
              : {}),
            ...(params.patch.decidedBy !== undefined
              ? { decidedBy: params.patch.decidedBy }
              : {}),
            ...(params.patch.decidedAt !== undefined
              ? { decidedAt: new Date(params.patch.decidedAt) }
              : {}),
          },
        });
        await tx.auditEvent.create({
          data: {
            id: auditEvent.id,
            action: auditEvent.action,
            actorId: auditEvent.actorId,
            actorRole: auditEvent.actorRole,
            entityType: auditEvent.entityType,
            entityId: auditEvent.entityId,
            organizationId: auditEvent.tenantId ?? null,
            outletId: auditEvent.outletId ?? null,
            occurredAt: new Date(auditEvent.occurredAt),
            ...(auditEvent.metadata ? { metadata: auditEvent.metadata as object } : {}),
          },
        });
        return toRefundRecord(row);
      } catch {
        // Prisma P2025: record to update not found — status changed concurrently
        // or refund already decided, or cross-tenant. The entire transaction
        // rolls back, so no audit event is persisted either.
        return null;
      }
    });
  }

  async listRefunds(tenantId: string): Promise<RefundRecord[]> {
    return this.db.$transaction(async (tx) => {
      await pinTenantContext(
        asPinTx(tx),
        persistencePinContext(tenantId, null),
      );
      const rows = await tx.refund.findMany({
        where: { organizationId: tenantId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toRefundRecord);
    });
  }
}
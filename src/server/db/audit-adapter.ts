/** Prisma adapter for AuditLogPort (Phase 4) — append-only AuditEvent rows. */
import type { PrismaClient } from "@prisma/client";
import type { AuditEvent, AuditLogPort } from "@/domain/audit/events";

export class PrismaAudit implements AuditLogPort {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Append an audit row. This adapter is used ONLY in PRODUCTION scope (the
   * demo sandbox uses the in-memory `serverAudit` sink), where the acting
   * principal is a real, provisioned `User` — so a failure here means the
   * audit trail genuinely cannot be written.
   *
   * Phase A: audit failures are NO LONGER swallowed. A failed insert is
   * surfaced to the caller so it can fail the whole operation closed. Order
   * creation writes its audit row inside the SAME database transaction as the
   * order (see PrismaOrders.createTransactional), so an audit failure rolls the
   * order back — an order can never exist without its audit trail. Callers on
   * best-effort paths (e.g. access-denied logging) wrap this in their own
   * try/catch and must not let it break the primary denial.
   */
  async record(event: AuditEvent): Promise<void> {
    await this.db.auditEvent.create({
      data: {
        id: event.id,
        action: event.action,
        actorId: event.actorId,
        actorRole: event.actorRole,
        entityType: event.entityType,
        entityId: event.entityId,
        organizationId: event.tenantId ?? null,
        outletId: event.outletId ?? null,
        occurredAt: new Date(event.occurredAt),
        ...(event.metadata ? { metadata: event.metadata as object } : {}),
      },
    });
  }
}

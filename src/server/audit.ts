/**
 * Server audit sink (Phase 3) — process-local AuditLogPort.
 *
 * HONEST LIMITATION: survives only for the lifetime of one server instance
 * (no DB yet). Structured single-line JSON to stdout for log collection,
 * plus a bounded ring buffer for in-process inspection. NEVER logs secrets,
 * cookies, or PII blobs (AuditEvent.metadata is scalar-only by contract).
 * Replaced by the Prisma AuditEvent adapter when DATABASE_URL lands.
 */
import type { AuditEvent, AuditLogPort } from "@/domain/audit/events";

const BUFFER_LIMIT = 500;

class ServerAuditLog implements AuditLogPort {
  private buffer: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.buffer.push(event);
    if (this.buffer.length > BUFFER_LIMIT) this.buffer.splice(0, this.buffer.length - BUFFER_LIMIT);
    // One structured line per event — safe for Vercel log drains.
    console.info(
      "[audit]",
      JSON.stringify({
        action: event.action,
        actorId: event.actorId,
        actorRole: event.actorRole,
        entityType: event.entityType,
        entityId: event.entityId,
        tenantId: event.tenantId ?? null,
        outletId: event.outletId ?? null,
        occurredAt: event.occurredAt,
        ...(event.metadata ? { metadata: event.metadata } : {}),
      }),
    );
  }

  /** Newest-first snapshot (bounded). For developer/audit surfaces + tests. */
  recent(limit = 50): AuditEvent[] {
    return this.buffer.slice(-limit).reverse();
  }
}

export const serverAudit = new ServerAuditLog();

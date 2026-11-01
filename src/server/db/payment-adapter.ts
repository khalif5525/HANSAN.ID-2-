/**
 * Prisma adapter for PaymentPort (Phase 5) — append-only Payment rows.
 *
 * A Payment row is the authoritative record of a capture (the schema comment on
 * `model Payment` states finance totals are SUMs over these rows, never typed
 * in). This adapter is used ONLY in PRODUCTION scope; the demo sandbox uses the
 * in-memory MemoryPayments so demo captures never reach Postgres.
 *
 * NOTE on atomicity: the domain `capturePayment` persists the Payment row then
 * the order flip through two ports. A future production payment-capture route
 * should wrap both writes in a single Prisma transaction (as
 * `PrismaOrders.createTransactional` does for order creation) so a crash
 * between them cannot leave a paid order without its ledger row. Until such a
 * route exists no production path marks an order paid, so the invariant holds.
 */
import type { PrismaClient } from "@prisma/client";
import type { PaymentPort, PaymentRecord, PayMethod } from "@/domain/shared/ports";
import { pinTenantContext, persistencePinContext } from "@/server/db/tenant-context";

/** Cast a Prisma interactive-transaction client to the shape pinTenantContext expects. */
function asPinTx(tx: unknown): Parameters<typeof pinTenantContext>[0] {
  return tx as Parameters<typeof pinTenantContext>[0];
}

export class PrismaPayments implements PaymentPort {
  constructor(private readonly db: PrismaClient) {}

  async save(payment: PaymentRecord): Promise<void> {
    // Phase 11 — pin tenant GUCs FIRST (from the record's own verified
    // tenant/outlet) so the append-only insert satisfies RLS WITH CHECK.
    await this.db.$transaction(async (tx) => {
      await pinTenantContext(asPinTx(tx), persistencePinContext(payment.tenantId, payment.outletId));
      await tx.payment.create({
        data: {
          id: payment.id,
          organizationId: payment.tenantId,
          outletId: payment.outletId,
          orderId: payment.orderId,
          dataScope: payment.dataScope ?? "PRODUCTION",
          amountIdr: BigInt(payment.amountIdr),
          // Prisma `PayMethod` enum values are lowercase (cash/qris/card/transfer),
          // matching the domain PayMethod literals exactly.
          method: payment.method as "cash" | "qris" | "card" | "transfer",
          capturedBy: payment.capturedBy,
          capturedAt: new Date(payment.capturedAt),
          externalRef: payment.externalRef ?? null,
        },
      });
    });
  }

  /**
   * Scoped path (Phase 8 + 11/12): `scope` is REQUIRED. The parent order's
   * tenant is verified before returning rows (a cross-tenant orderId yields []
   * instead of leaking captures), and the whole check + read runs inside a
   * pinned tenant transaction. No unscoped fallback exists by design.
   */
  async listByOrder(orderId: string, scope: { organizationId: string }): Promise<PaymentRecord[]> {
    return this.db.$transaction(async (tx) => {
      await pinTenantContext(asPinTx(tx), persistencePinContext(scope.organizationId, null));
      const parent = await tx.order.findFirst({ where: { id: orderId, organizationId: scope.organizationId }, select: { id: true } });
      if (!parent) return [];
      const rows = await tx.payment.findMany({
        where: { orderId },
        orderBy: { capturedAt: "desc" },
      });
      return rows.map(toPaymentRecord);
    });
  }

  async listByTenant(
    tenantId: string,
    options?: { sinceIso?: string; limit?: number },
  ): Promise<PaymentRecord[]> {
    // Phase 11 — tenant-wide read pins the organization GUC ( __none__ outlet ).
    return this.db.$transaction(async (tx) => {
      await pinTenantContext(asPinTx(tx), persistencePinContext(tenantId, null));
      const rows = await tx.payment.findMany({
        where: {
          organizationId: tenantId,
          ...(options?.sinceIso ? { capturedAt: { gte: new Date(options.sinceIso) } } : {}),
        },
        orderBy: { capturedAt: "desc" },
        ...(options?.limit ? { take: options.limit } : {}),
      });
      return rows.map(toPaymentRecord);
    });
  }
}

function toPaymentRecord(row: {
  id: string;
  organizationId: string;
  outletId: string;
  orderId: string;
  amountIdr: bigint;
  method: string;
  capturedBy: string;
  capturedAt: Date;
  externalRef: string | null;
}): PaymentRecord {
  return {
    id: row.id,
    tenantId: row.organizationId,
    outletId: row.outletId,
    orderId: row.orderId,
    amountIdr: Number(row.amountIdr),
    method: row.method.toLowerCase() as PayMethod,
    capturedBy: row.capturedBy,
    capturedAt: row.capturedAt.toISOString(),
    externalRef: row.externalRef,
  };
}
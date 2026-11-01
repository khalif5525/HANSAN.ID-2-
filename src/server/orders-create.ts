/**
 * Production order creation (Phase A) — the transactional persistence path.
 *
 * This is the ONLY way a PRODUCTION-scope order is persisted. It replaces the
 * legacy `PosService.createOrder -> PrismaOrders.save()` path, which omitted the
 * required `dataScope` and wrote the order, its items, the audit row, and the
 * idempotency completion in SEPARATE, non-atomic steps.
 *
 * Guarantees (all inside ONE database transaction — see
 * PrismaOrders.createTransactional):
 *   * explicit dataScope: "PRODUCTION" (never inferred, never DEMO);
 *   * tenant (organizationId) + outlet derived from the VERIFIED session, never
 *     from untrusted request-body fields;
 *   * server-authoritative catalog re-read: prices, stations, active flags and
 *     cross-tenant product ownership are validated inside the transaction;
 *   * order number allocation + parent order + items + audit row + idempotency
 *     completion commit together, or nothing does (no partial orders, no
 *     un-audited orders, no orphaned in_progress idempotency claims).
 *
 * Demo sessions NEVER reach this module: runtimeFor() routes them to the
 * in-memory sandbox before any of this runs.
 */
import { createId } from "@/domain/shared/ids";
import { getTaxConfig } from "@/config/tax";
import { AUDIT_ACTIONS } from "@/domain/audit/events";
import type { PrismaOrders } from "@/server/db/orders-adapter";
import type { CreateOrderRequest } from "@/domain/pos/contracts";
import type { OrderRecord } from "@/domain/shared/ports";

export interface ProductionOrderActor {
  /** Verified session subject (auth sub) — the audit actor + order.createdBy. */
  userId: string;
  /** Verified session role — recorded on the audit row. */
  role: string;
  /** Verified session tenant — becomes organizationId. Never from the body. */
  tenantId: string;
  /** Verified session outlet — becomes outletId. Never from the body. */
  outletId: string;
}

export interface ProductionOrderContext {
  orders: PrismaOrders;
  actor: ProductionOrderActor;
  request: CreateOrderRequest;
  idempotency: { organizationId: string; scope: string; key: string };
}

/**
 * Persist a production order transactionally. Prices/totals supplied by the
 * client are ignored; the adapter re-derives everything from the server catalog.
 */
export async function createProductionOrder(ctx: ProductionOrderContext): Promise<OrderRecord> {
  const { actor, request, idempotency } = ctx;
  return ctx.orders.createTransactional(
    {
      id: createId("ord"),
      organizationId: actor.tenantId,
      outletId: actor.outletId,
      dataScope: "PRODUCTION",
      orderType: request.orderType,
      tableId: request.tableId ?? null,
      customerId: request.customerId ?? null,
      discountIdr: Math.max(0, Math.trunc(request.discountIdr ?? 0)),
      taxPercent: getTaxConfig().percent,
      lines: request.lines.map((l) => ({
        id: createId("item"),
        productId: l.productId,
        quantity: l.quantity,
        modifierIds: l.modifierIds ?? [],
        ...(l.note ? { note: l.note } : {}),
      })),
      createdBy: actor.userId,
      createdAt: new Date().toISOString(),
    },
    {
      audit: {
        id: createId("aud"),
        action: AUDIT_ACTIONS.ORDER_CREATED,
        actorId: actor.userId,
        actorRole: actor.role,
      },
      idempotency,
    },
  );
}

/**
 * Prisma adapter for OrderPort (Phase 4).
 *
 * Transactional guarantees:
 *   * save() writes Order + OrderItems in ONE transaction (parent and items
 *     never diverge); item rows are replaced wholesale inside that tx.
 *   * nextOrderNumber() atomically increments SequenceCounter so numbers
 *     never collide per outlet.
 *
 * Money: BigInt columns <-> integer rupiah numbers (IDR UI amounts always
 * < 2^53; domain arithmetic is integer-only).
 */
import type { PrismaClient } from "@prisma/client";
import { AppError, ERROR_CODES } from "@/domain/shared/errors";
import { computeTotals } from "@/domain/pos/totals";
import { orderCreateResponse } from "@/server/order-response";
import type { OrderPort, OrderRecord } from "@/domain/shared/ports";
import { pinTenantContext, persistencePinContext, requireTenantContext } from "@/server/db/tenant-context";

/** Cast a Prisma interactive-transaction client to the shape pinTenantContext expects. */
function asPinTx(tx: unknown): Parameters<typeof pinTenantContext>[0] {
  return tx as Parameters<typeof pinTenantContext>[0];
}

function toOrderRecord(row: {
  id: string;
  organizationId: string;
  outletId: string;
  orderNumber: string;
  orderType: string;
  tableId: string | null;
  customerId: string | null;
  subtotalIdr: bigint;
  discountIdr: bigint;
  taxIdr: bigint;
  grandTotalIdr: bigint;
  state: string;
  paymentState: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  items: {
    id: string;
    productId: string;
    productName: string;
    quantity: number;
    unitPriceIdr: bigint;
    station: string;
    lineState: string;
    prepStatus: string;
    note: string | null;
    modifierIds: string[];
  }[];
}): OrderRecord {
  return {
    id: row.id,
    tenantId: row.organizationId,
    outletId: row.outletId,
    orderNumber: row.orderNumber,
    orderType: row.orderType.replace("_", "-") as OrderRecord["orderType"],
    tableId: row.tableId,
    customerId: row.customerId,
    lines: row.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      quantity: i.quantity,
      unitPriceIdr: Number(i.unitPriceIdr),
      modifierIds: i.modifierIds,
      station: i.station.toLowerCase() as "kitchen" | "bar",
      state: i.lineState as "active" | "cancelled",
      prepStatus: i.prepStatus as "pending" | "preparing" | "ready",
      ...(i.note ? { note: i.note } : {}),
    })),
    subtotalIdr: Number(row.subtotalIdr),
    discountIdr: Number(row.discountIdr),
    taxIdr: Number(row.taxIdr),
    grandTotalIdr: Number(row.grandTotalIdr),
    state: row.state as OrderRecord["state"],
    paymentState: row.paymentState as OrderRecord["paymentState"],
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const ITEM_SELECT = {
  id: true,
  productId: true,
  productName: true,
  quantity: true,
  unitPriceIdr: true,
  station: true,
  lineState: true,
  prepStatus: true,
  note: true,
  modifierIds: true,
} as const;

export class PrismaOrders implements OrderPort {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Phase 11/12 — scoped read. `scope` is REQUIRED: the tenant GUCs are pinned
   * inside ONE transaction so the query succeeds under RLS and is tenant-bound
   * there too, and organizationId/outletId are enforced at the query boundary.
   * There is NO unscoped fallback — a read without an authoritative
   * organizationId is a bug, not a legacy mode (see PHASE-12 report).
   */
  async findById(id: string, scope: { organizationId: string; outletId?: string }): Promise<OrderRecord | null> {
    return this.db.$transaction(async (tx) => {
      await pinTenantContext(asPinTx(tx), persistencePinContext(scope.organizationId, scope.outletId ?? null));
      const row = await tx.order.findUnique({
        where: { id, organizationId: scope.organizationId, ...(scope.outletId ? { outletId: scope.outletId } : {}) },
        include: { items: { select: ITEM_SELECT } },
      });
      return row ? toOrderRecord(row) : null;
    });
  }

  async save(order: OrderRecord): Promise<void> {
    await this.db.$transaction(async (tx) => {
      // Phase 11 (R1): pin tenant GUCs FIRST — from the record's own verified
      // tenant/outlet — so the tenant check + upsert are RLS-compatible.
      await pinTenantContext(asPinTx(tx), persistencePinContext(order.tenantId, order.outletId));
      // Phase 8 (R4): verify an existing row belongs to the writer's tenant
      // before upserting — a cross-tenant save fails closed (TENANT_MISMATCH)
      // instead of overwriting another tenant's order.
      const existing = await tx.order.findUnique({ where: { id: order.id }, select: { organizationId: true } });
      if (existing && existing.organizationId !== order.tenantId) {
        throw new AppError(ERROR_CODES.TENANT_MISMATCH, { message: "Cross-tenant order write denied" });
      }
      const data = {
        organizationId: order.tenantId,
        outletId: order.outletId,
        dataScope: order.dataScope ?? "PRODUCTION",
        orderNumber: order.orderNumber,
        orderType: order.orderType.replace("-", "_") as "dine_in" | "take_away" | "online",
        tableId: order.tableId,
        customerId: order.customerId,
        subtotalIdr: BigInt(order.subtotalIdr),
        discountIdr: BigInt(order.discountIdr),
        taxIdr: BigInt(order.taxIdr),
        grandTotalIdr: BigInt(order.grandTotalIdr),
        state: order.state,
        paymentState: order.paymentState,
        createdBy: order.createdBy,
        updatedAt: new Date(order.updatedAt),
      };
      await tx.order.upsert({
        where: { id: order.id },
        create: { id: order.id, createdAt: new Date(order.createdAt), ...data },
        update: data,
      });
      await tx.orderItem.deleteMany({ where: { orderId: order.id } });
      if (order.lines.length > 0) {
        await tx.orderItem.createMany({
          data: order.lines.map((l) => ({
            id: l.id,
            orderId: order.id,
            productId: l.productId,
            productName: l.productName,
            quantity: l.quantity,
            unitPriceIdr: BigInt(l.unitPriceIdr),
            station: l.station.toUpperCase() as "KITCHEN" | "BAR",
            lineState: l.state,
            prepStatus: l.prepStatus ?? "pending",
            note: l.note ?? null,
            modifierIds: l.modifierIds,
          })),
        });
      }
    });
  }

  /**
   * Phase 11 — resolve the owning tenant for an outlet-scoped call.
   *
   * `Outlet` is a bootstrap identity table (deliberately NO RLS — see the
   * rls-tenant-isolation.sql header), so this lookup succeeds WITHOUT a pinned
   * context and is authoritative (the row is server-owned, never client input).
   * A missing outlet fails closed — we never guess a tenant.
   */
  private async resolveOrganizationForOutlet(outletId: string): Promise<string> {
    const outlet = await this.db.outlet.findUnique({
      where: { id: outletId },
      select: { organizationId: true },
    });
    if (!outlet) {
      throw new AppError(ERROR_CODES.OUTLET_MISMATCH, { message: "Unknown outlet" });
    }
    return outlet.organizationId;
  }

  async listByOutlet(outletId: string, options?: { limit?: number; sinceIso?: string }): Promise<OrderRecord[]> {
    // Phase 11 — outlet-only callers carry no organizationId; resolve it from
    // the authoritative Outlet row, then pin tenant GUCs for the list query.
    const organizationId = await this.resolveOrganizationForOutlet(outletId);
    return this.db.$transaction(async (tx) => {
      await pinTenantContext(asPinTx(tx), persistencePinContext(organizationId, outletId));
      const rows = await tx.order.findMany({
        where: { outletId, ...(options?.sinceIso ? { createdAt: { gte: new Date(options.sinceIso) } } : {}) },
        include: { items: { select: ITEM_SELECT } },
        orderBy: { createdAt: "desc" },
        take: options?.limit ?? 100,
      });
      return rows.map(toOrderRecord);
    });
  }

  async listByTenant(tenantId: string, options?: { limit?: number; sinceIso?: string }): Promise<OrderRecord[]> {
    // Phase 11 — tenant-wide read pins the organization GUC with the __none__
    // outlet sentinel (never a cross-tenant leak; never empty string).
    return this.db.$transaction(async (tx) => {
      await pinTenantContext(asPinTx(tx), persistencePinContext(tenantId, null));
      const rows = await tx.order.findMany({
        where: { organizationId: tenantId, ...(options?.sinceIso ? { createdAt: { gte: new Date(options.sinceIso) } } : {}) },
        include: { items: { select: ITEM_SELECT } },
        orderBy: { createdAt: "desc" },
        take: options?.limit ?? 100,
      });
      return rows.map(toOrderRecord);
    });
  }

  async nextOrderNumber(outletId: string): Promise<string> {
    // Phase 11 — resolve the owning tenant for the counter's tenant context.
    const organizationId = await this.resolveOrganizationForOutlet(outletId);
    const value = await this.db.$transaction(async (tx) => {
      await pinTenantContext(asPinTx(tx), persistencePinContext(organizationId, outletId));
      const row = await tx.sequenceCounter.upsert({
        where: { outletId_kind: { outletId, kind: "order_number" } },
        create: { outletId, kind: "order_number", value: BigInt(1) },
        update: { value: { increment: BigInt(1) } },
      });
      return row.value;
    });
    return `ORD-${String(value).padStart(5, "0")}`;
  }

  /**
   * Transactional order creation (Phase 4) — the ONLY way a real order is
   * persisted. Inside ONE database transaction this method:
   *   1. re-reads every MenuItem (authoritative price + station + active flag);
   *   2. rejects unknown/inactive/cross-tenant products and bad quantities;
   *   3. re-derives totals from server prices (client amounts never trusted);
   *   4. atomically allocates the per-outlet order number (no collisions);
   *   5. inserts the parent Order and its OrderItems together — a failure
   *      anywhere rolls the whole thing back (no partial orders).
   * A UI-only cart is never mistaken for a real order.
   */
  async createTransactional(draft: {
    id: string;
    organizationId: string;
    outletId: string;
    dataScope: "DEMO" | "PRODUCTION";
    orderType: OrderRecord["orderType"];
    tableId: string | null;
    customerId: string | null;
    discountIdr: number;
    taxPercent: number;
    lines: { id: string; productId: string; quantity: number; modifierIds: string[]; note?: string }[];
    createdBy: string;
    createdAt: string;
  },
  extras?: {
    /** Audit row inserted in the SAME transaction — no un-audited order. */
    audit?: { id: string; action: string; actorId: string; actorRole: string; metadata?: Record<string, string | number | boolean> };
    /** Idempotency claim completed in the SAME transaction — no orphaned in_progress. */
    idempotency?: { organizationId: string; scope: string; key: string };
  },
  ): Promise<OrderRecord> {
    return this.db.$transaction(async (tx) => {
      // Phase 8 (R1): pin tenant GUCs FIRST in the SAME transaction, before
      // any protected read/write. Context derives from the verified draft
      // (organizationId/outletId already resolved from the revalidated actor
      // in createProductionOrder — never from request-body tenant fields).
      await pinTenantContext(tx as unknown as Parameters<typeof pinTenantContext>[0], requireTenantContext({
        organizationId: draft.organizationId,
        outletId: draft.outletId,
        role: "pos",
        dataScope: draft.dataScope,
      }));
      if (draft.lines.length === 0) {
        throw new AppError(ERROR_CODES.CART_EMPTY, { message: "Order has no items" });
      }

      const persistedLines: Array<{
        id: string;
        productId: string;
        productName: string;
        quantity: number;
        unitPriceIdr: number;
        station: "kitchen" | "bar";
        modifierIds: string[];
        note?: string;
      }> = [];
      let subtotalIdr = 0;

      for (const line of draft.lines) {
        if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 999) {
          throw new AppError(ERROR_CODES.INVALID_QUANTITY, { message: "Quantity must be 1–999" });
        }
        const product = await tx.menuItem.findUnique({ where: { id: line.productId } });
        if (!product || !product.active || product.organizationId !== draft.organizationId) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { message: `Unknown product: ${line.productId}` });
        }
        const unitPriceIdr = Number(product.priceIdr);
        const station = product.station.toLowerCase() as "kitchen" | "bar";
        subtotalIdr += unitPriceIdr * line.quantity;
        persistedLines.push({
          id: line.id,
          productId: product.id,
          productName: product.name,
          quantity: line.quantity,
          unitPriceIdr,
          station,
          modifierIds: line.modifierIds,
          ...(line.note ? { note: line.note } : {}),
        });
      }

      // 3) Re-derive totals from server prices (never trust client totals).
      //    Tax percent is server-config only (honest 0 default); rounding is
      //    half-up integer arithmetic — never float money.
      const totals = computeTotals({
        subtotalIdr,
        discountIdr: draft.discountIdr,
        tax: { percent: draft.taxPercent, label: "stored" },
      });
      const taxIdr = totals.taxIdr;
      const grandTotalIdr = totals.grandTotalIdr;

      const counter = await tx.sequenceCounter.upsert({
        where: { outletId_kind: { outletId: draft.outletId, kind: "order_number" } },
        create: { outletId: draft.outletId, kind: "order_number", value: BigInt(1) },
        update: { value: { increment: BigInt(1) } },
      });
      const orderNumber = `ORD-${String(counter.value).padStart(5, "0")}`;

      await tx.order.create({
        data: {
          id: draft.id,
          organizationId: draft.organizationId,
          outletId: draft.outletId,
          dataScope: draft.dataScope,
          orderNumber,
          orderType: draft.orderType.replace("-", "_") as "dine_in" | "take_away" | "online",
          tableId: draft.tableId,
          customerId: draft.customerId,
          subtotalIdr: BigInt(totals.subtotalIdr),
          discountIdr: BigInt(totals.discountIdr),
          taxIdr: BigInt(taxIdr),
          grandTotalIdr: BigInt(grandTotalIdr),
          state: "placed",
          paymentState: "unpaid",
          createdBy: draft.createdBy,
          createdAt: new Date(draft.createdAt),
          updatedAt: new Date(draft.createdAt),
          items: {
            create: persistedLines.map((l) => ({
              id: l.id,
              productId: l.productId,
              productName: l.productName,
              quantity: l.quantity,
              unitPriceIdr: BigInt(l.unitPriceIdr),
              station: l.station.toUpperCase() as "KITCHEN" | "BAR",
              lineState: "active",
              prepStatus: "pending",
              note: l.note ?? null,
              modifierIds: l.modifierIds,
            })),
          },
        },
      });

      const record: OrderRecord = {
        id: draft.id,
        tenantId: draft.organizationId,
        outletId: draft.outletId,
        orderNumber,
        orderType: draft.orderType,
        tableId: draft.tableId,
        customerId: draft.customerId,
        dataScope: draft.dataScope,
        lines: persistedLines.map((l) => ({
          id: l.id,
          productId: l.productId,
          productName: l.productName,
          quantity: l.quantity,
          unitPriceIdr: l.unitPriceIdr,
          modifierIds: l.modifierIds,
          station: l.station,
          state: "active" as const,
          prepStatus: "pending" as const,
          ...(l.note ? { note: l.note } : {}),
        })),
        subtotalIdr: totals.subtotalIdr,
        discountIdr: totals.discountIdr,
        taxIdr,
        grandTotalIdr,
        state: "placed" as const,
        paymentState: "unpaid" as const,
        createdBy: draft.createdBy,
        createdAt: draft.createdAt,
        updatedAt: draft.createdAt,
      };

      // Atomic audit + idempotency completion (Phase A): the AuditEvent row and
      // the Idempotency-Key -> "completed" transition ride the SAME database
      // transaction as the order + items + sequence counter. Either all commit
      // together or all roll back — there is no window where an order exists
      // without its audit trail, and no orphaned in_progress idempotency claim.
      if (extras?.audit) {
        await tx.auditEvent.create({
          data: {
            id: extras.audit.id,
            action: extras.audit.action,
            actorId: extras.audit.actorId,
            actorRole: extras.audit.actorRole,
            entityType: "order",
            entityId: record.id,
            organizationId: draft.organizationId,
            outletId: draft.outletId,
            occurredAt: new Date(draft.createdAt),
            ...(extras.audit.metadata ? { metadata: extras.audit.metadata as object } : {}),
          },
        });
      }

      if (extras?.idempotency) {
        await tx.idempotencyRecord.update({
          where: {
            organizationId_scope_key: {
              organizationId: extras.idempotency.organizationId,
              scope: extras.idempotency.scope,
              key: extras.idempotency.key,
            },
          },
          data: { status: "completed", responseJson: JSON.stringify(orderCreateResponse(record)) },
        });
      }

      return record;
    });
  }
}

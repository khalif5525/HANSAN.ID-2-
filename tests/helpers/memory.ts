/**
 * In-memory test doubles for repository ports.
 * TEST-ONLY: these never ship to production code paths and never
 * fabricate records — they start EMPTY like a real fresh database.
 */
import type { CatalogPort, OrderPort, OrderRecord, ProductRecord, UserRecord } from "@/domain/shared/ports";
import type { CustomerPort, CustomerRecord, ReservationPort, ReservationRecord } from "@/domain/customers/ports";
import type { AuditEvent, AuditLogPort } from "@/domain/audit/events";
import type {
  FinancePort,
  ExpenseRecord,
  RefundRecord
} from "@/domain/finance/ports";
import type {
  InventoryPort,
  StockMaterialRecord,
  StockMovementRecord
} from "@/domain/inventory/ports";
import { AppError, ERROR_CODES } from "@/domain/shared/errors";

export class MemoryAudit implements AuditLogPort {
  events: AuditEvent[] = [];
  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}

export class MemoryOrders implements OrderPort {
  rows = new Map<string, OrderRecord>();
  private counters = new Map<string, number>();

  async findById(id: string, scope: { organizationId: string; outletId?: string }): Promise<OrderRecord | null> {
    const row = this.rows.get(id) ?? null;
    if (!row) return null;
    if (row.tenantId !== scope.organizationId) return null;
    if (scope.outletId && row.outletId !== scope.outletId) return null;
    return row;
  }
  async save(order: OrderRecord): Promise<void> {
    this.rows.set(order.id, { ...order, lines: order.lines.map((l) => ({ ...l })) });
  }
  async listByOutlet(outletId: string, options?: { limit?: number; sinceIso?: string }): Promise<OrderRecord[]> {
    return this.filter((o) => o.outletId === outletId, options);
  }
  async listByTenant(tenantId: string, options?: { limit?: number; sinceIso?: string }): Promise<OrderRecord[]> {
    return this.filter((o) => o.tenantId === tenantId, options);
  }
  async nextOrderNumber(outletId: string): Promise<string> {
    const next = (this.counters.get(outletId) ?? 0) + 1;
    this.counters.set(outletId, next);
    return `ORD-${String(next).padStart(5, "0")}`
  }
  private filter(
    predicate: (o: OrderRecord) => boolean,
    options?: { limit?: number; sinceIso?: string }
  ): Promise<OrderRecord[]> {
    let rows = Array.from(this.rows.values())
      .filter(predicate)
      .filter((o) => !options?.sinceIso || o.createdAt >= options.sinceIso!)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (options?.limit) rows = rows.slice(0, options.limit);
    return Promise.resolve(rows.map((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l })) })));
  }
}

export class MemoryCatalog implements CatalogPort {
  rows = new Map<string, ProductRecord>();
  async findById(id: string, scope: { organizationId: string }): Promise<ProductRecord | null> {
    const row = this.rows.get(id) ?? null;
    if (!row) return null;
    if (row.tenantId !== scope.organizationId) return null;
    return row;
  }
  async listActive(tenantId: string): Promise<ProductRecord[]> {
    return Array.from(this.rows.values()).filter((p) => p.tenantId === tenantId && p.active);
  }
  async put(product: ProductRecord): Promise<void> {
    this.rows.set(product.id, product);
  }
}

export class MemoryFinance implements FinancePort {
  expenses: ExpenseRecord[] = [];
  events: AuditEvent[] = [];
  refunds = new Map<string, RefundRecord>();
  async saveExpense(e: ExpenseRecord): Promise<void> {
    this.expenses.push({ ...e });
  }
  async listExpenses(tenantId: string, sinceIso?: string): Promise<ExpenseRecord[]> {
    return this.expenses.filter((e) => e.tenantId === tenantId && (!sinceIso || e.incurredAt >= sinceIso));
  }
  async getRefund(id: string, organizationId: string): Promise<RefundRecord | null> {
    const current = this.refunds.get(id) ?? null;
    if (!current || current.tenantId !== organizationId) return null;
    return current;
  }
  async saveRefund(r: RefundRecord): Promise<void> {
    this.refunds.set(r.id, { ...r });
  }
  async transitionRefund(params: {
    id: string;
    organizationId: string;
    expectedStatus: RefundRecord["status"];
    patch: Partial<Pick<RefundRecord, "status" | "decidedBy" | "decidedAt">>;
  }): Promise<RefundRecord | null> {
    const current = this.refunds.get(params.id) ?? null;
    if (!current || current.tenantId !== params.organizationId || current.status !== params.expectedStatus) return null;
    const updated: RefundRecord = { ...current, ...params.patch };
    this.refunds.set(updated.id, updated);
    return updated;
  }
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
    const updated = await this.transitionRefund(params);
    if (!updated) return null;
    this.events.push(auditEvent as AuditEvent);
    return updated;
  }
  async listRefunds(tenantId: string): Promise<RefundRecord[]> {
    return Array.from(this.refunds.values()).filter((r) => r.tenantId === tenantId);
  }
}

export class MemoryInventory implements InventoryPort {
  materials = new Map<string, StockMaterialRecord>();
  movements: StockMovementRecord[] = [];

  async getMaterial(id: string): Promise<StockMaterialRecord | null> {
    return this.materials.get(id) ?? null;
  }
  async listMaterials(tenantId: string): Promise<StockMaterialRecord[]> {
    return Array.from(this.materials.values()).filter((m) => m.tenantId === tenantId);
  }
  async applyMovement(
    movement: Omit<StockMovementRecord, "quantityAfter">,
    expectedFinalQuantity: number
  ): Promise<StockMovementRecord> {
    const material = this.materials.get(movement.materialId);
    if (!material) throw new AppError(ERROR_CODES.NOT_FOUND, { message: "Material not found" });
    // race guard: recompute like the real transactional adapter would
    const actual = Math.round((material.quantity + movement.quantityDelta) * 1e6) / 1e6;
    if (actual !== expectedFinalQuantity) {
      throw new AppError(ERROR_CODES.CONFLICT, { message: "Concurrent stock modification detected" });
    }
    const updated: StockMaterialRecord = {
      ...material,
      quantity: expectedFinalQuantity,
      updatedAt: movement.occurredAt
    };
    this.materials.set(material.id, updated);
    const record: StockMovementRecord = { ...movement, quantityAfter: expectedFinalQuantity };
    this.movements.push(record);
    return record;
  }
  async listMovements(materialId: string): Promise<StockMovementRecord[]> {
    return this.movements.filter((m) => m.materialId === materialId);
  }
}

export function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}

export function actor(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "usr_test",
    email: "test@hansan.local",
    displayName: "Test User",
    role: "pos",
    tenantId: "ten_test",
    outletIds: ["out_1"],
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

export class MemoryCustomers implements CustomerPort {
  private rows = new Map<string, CustomerRecord>();

  async getCustomer(id: string): Promise<CustomerRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async saveCustomer(customer: CustomerRecord): Promise<void> {
    this.rows.set(customer.id, { ...customer });
  }

  async listCustomers(tenantId: string): Promise<CustomerRecord[]> {
    return Array.from(this.rows.values()).filter((c) => c.tenantId === tenantId);
  }
}

export class MemoryReservations implements ReservationPort {
  private rows = new Map<string, ReservationRecord>();

  async getReservation(id: string): Promise<ReservationRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async saveReservation(reservation: ReservationRecord): Promise<void> {
    this.rows.set(reservation.id, { ...reservation });
  }

  async listByDay(outletId: string, dayIso: string): Promise<ReservationRecord[]> {
    const day = dayIso;
    return Array.from(this.rows.values()).filter((r) => r.outletId === outletId && r.createdAt.startsWith(day));
  }
}


/**
 * Core repository ports: identity/tenancy, orders (POS), catalog.
 * CONVENTION: async, THROW AppError on failure; empty results are
 * valid; adapters must never invent business records.
 */

// ---------- identity / tenancy ----------
export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  role: string;
  tenantId: string;
  outletIds: string[];
  active: boolean;
  createdAt: string;
}

export interface OutletRecord {
  id: string;
  tenantId: string;
  name: string;
  active: boolean;
}

export interface UserPort {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  listByTenant(tenantId: string): Promise<UserRecord[]>;
  listOutlets(tenantId: string): Promise<OutletRecord[]>;
}

// ---------- orders (POS) ----------
export type OrderState =
  | "draft"
  | "placed"
  | "accepted"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled"
  | "refund_requested"
  | "refunded";

export type PaymentState = "unpaid" | "paid" | "refunding" | "refunded";

export type OrderType = "dine-in" | "take-away" | "online";

export interface OrderLine {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceIdr: number;
  modifierIds: string[];
  station: "kitchen" | "bar";
  state: "active" | "cancelled";
  /** KDS item-level preparation status (Phase A3). */
  prepStatus?: "pending" | "preparing" | "ready";
  note?: string;
}

export interface OrderRecord {
  id: string;
  tenantId: string;
  outletId: string;
  orderNumber: string;
  orderType: OrderType;
  /**
   * Demo/production separation at rest. Persistence pins this from the
   * acting session's scope so DEMO rows can never mix into production
   * ledgers (see prisma/rls-demo-isolation.sql). Optional so existing
   * in-memory fixtures stay unchanged; adapters default to PRODUCTION.
   */
  dataScope?: "DEMO" | "PRODUCTION";
  tableId: string | null;
  customerId: string | null;
  lines: OrderLine[];
  subtotalIdr: number;
  discountIdr: number;
  taxIdr: number;
  grandTotalIdr: number;
  state: OrderState;
  paymentState: PaymentState;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderPort {
  /**
   * Fetch one order. `scope` is REQUIRED (Phase 12): the adapter MUST enforce it
   * at the query boundary (defense in depth) AND pin the tenant GUCs inside the
   * same transaction, so the read is RLS-compatible and a record outside the
   * caller's tenant/outlet resolves to `null` even if a route-level check is
   * bypassed. There is deliberately NO unscoped fallback — a production read
   * without an authoritative organizationId is a bug, not a legacy mode.
   */
  findById(id: string, scope: { organizationId: string; outletId?: string }): Promise<OrderRecord | null>;
  save(order: OrderRecord): Promise<void>;
  listByOutlet(outletId: string, options?: { limit?: number; sinceIso?: string }): Promise<OrderRecord[]>;
  listByTenant(tenantId: string, options?: { limit?: number; sinceIso?: string }): Promise<OrderRecord[]>;
  nextOrderNumber(outletId: string): Promise<string>;
}

// ---------- payments ----------
/**
 * Payment methods a POS terminal may settle with. CASH is the only method the
 * initial release can settle end-to-end; the rest are modeled in the schema
 * (`PayMethod`) but not yet captured by a gateway (BLOCKER-005).
 */
export type PayMethod = "cash" | "qris" | "card" | "transfer";

/**
 * A single persisted capture against one order. The schema comment on
 * `model Payment` is authoritative: "Finance totals are SUMS over these rows —
 * never typed in." A payment exists ONLY as a persisted row; an order whose
 * `paymentState` is "paid" with no matching Payment row is a data-integrity
 * error, which is why capture must write both in ONE transaction.
 */
export interface PaymentRecord {
  id: string;
  tenantId: string;
  outletId: string;
  orderId: string;
  dataScope?: "DEMO" | "PRODUCTION";
  amountIdr: number;
  method: PayMethod;
  /** Acting cashier who captured the payment. */
  capturedBy: string;
  capturedAt: string;
  /** Provider reference once a gateway is wired; null for cash/manual capture. */
  externalRef?: string | null;
}

export interface PaymentPort {
  save(payment: PaymentRecord): Promise<void>;
  /**
   * List captures for one order. `scope` is REQUIRED (Phase 12): the adapter
   * verifies the parent order belongs to `scope.organizationId` and returns []
   * otherwise — a cross-tenant orderId can never leak rows — and pins the tenant
   * GUCs so the read is RLS-compatible. No unscoped fallback exists by design.
   */
  listByOrder(orderId: string, scope: { organizationId: string }): Promise<PaymentRecord[]>;
  listByTenant(tenantId: string, options?: { sinceIso?: string; limit?: number }): Promise<PaymentRecord[]>;
}

// ---------- catalog ----------
export interface ProductRecord {
  id: string;
  tenantId: string;
  categoryId: string;
  name: string;
  priceIdr: number;
  station: "kitchen" | "bar";
  active: boolean;
  createdAt: string;
}

export interface CatalogPort {
  /**
   * Lookup one product. `scope` is REQUIRED (Phase 12): cross-tenant ids resolve
   * to null without leaking existence, and the adapter pins the tenant GUCs so
   * the read is RLS-compatible. No unscoped fallback exists by design.
   */
  findById(id: string, scope: { organizationId: string }): Promise<ProductRecord | null>;
  listActive(tenantId: string): Promise<ProductRecord[]>;
}

/**
 * Runtime composition (Phase 4): choose persistence by session data scope.
 *
 *   * DEMO sessions  -> isolated process-local in-memory sandbox. Demo data
 *                      physically can never reach Postgres/production tables.
 *   * Live sessions  -> Prisma; returns null when persistence is not
 *                      configured so the route can fail CLOSED (503).
 *
 * This is the server-side guarantee behind "demo data cannot mutate
 * production records" and "keep the initial production database empty".
 */
import { getPrisma } from "@/server/db/client";
import { PrismaOrders } from "@/server/db/orders-adapter";
import { PrismaCatalog } from "@/server/db/catalog-adapter";
import { PrismaAudit } from "@/server/db/audit-adapter";
import { PrismaIdempotency } from "@/server/db/idempotency-adapter";
import { PrismaPayments } from "@/server/db/payment-adapter";
import { MemoryOrders, MemoryCatalog, MemoryPayments, MemoryFinance } from "@/server/db/memory-store";
import { MemoryReservations, PrismaReservations } from "@/server/db/reservation-adapter";
import { InMemoryIdempotency } from "@/server/idempotency";
import { serverAudit } from "@/server/audit";
import { PrismaFinance } from "@/server/db/finance-adapter";
import type { SessionPayload } from "@/server/session";
import type { CatalogPort, OrderPort, PaymentPort } from "@/domain/shared/ports";
import type { ReservationPort } from "@/domain/reservations/service";
import type { AuditLogPort } from "@/domain/audit/events";
import type { IdempotencyPort } from "@/server/idempotency";
import type { FinancePort } from "@/domain/finance/ports";

export interface Runtime {
  orders: OrderPort;
  catalog: CatalogPort;
  audit: AuditLogPort;
  idempotency: IdempotencyPort;
  payments: PaymentPort;
  finance: FinancePort;
  reservations: ReservationPort;
  scope: "DEMO" | "PRODUCTION";
}

const globalForDemo = globalThis as unknown as { __hansanDemoRuntime?: Runtime };

/** Demo sandbox runtime — process-local, starts EMPTY, never touches Postgres. */
export function demoSandbox(): Runtime {
  if (!globalForDemo.__hansanDemoRuntime) {
    globalForDemo.__hansanDemoRuntime = {
      orders: new MemoryOrders(),
      catalog: new MemoryCatalog(),
      audit: serverAudit,
      idempotency: new InMemoryIdempotency(),
      payments: new MemoryPayments(),
      finance: new MemoryFinance(),
      reservations: new MemoryReservations(),
      scope: "DEMO",
    };
  }
  return globalForDemo.__hansanDemoRuntime!;
}

export function runtimeFor(session: SessionPayload): Runtime | null {
  if (session.mode === "demo" || session.dataScope === "DEMO") return demoSandbox();
  const db = getPrisma();
  if (!db) return null;
  // Reservations now use durable Prisma persistence (Phase B/C). Demo sessions
  // keep MemoryReservations; UnavailableReservations remains only when no DB.
  return {
    orders: new PrismaOrders(db),
    catalog: new PrismaCatalog(db),
    audit: new PrismaAudit(db),
    idempotency: new PrismaIdempotency(db),
    payments: new PrismaPayments(db),
    finance: new PrismaFinance(db),
    reservations: new PrismaReservations(db),
    scope: "PRODUCTION",
  };
}

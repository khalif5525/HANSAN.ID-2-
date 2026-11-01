/**
 * Application-service composition (Phase 4) - the API boundary helpers.
 *
 * The true persistence boundary is `src/server/runtime.ts` (`runtimeFor` +
 * `demoSandbox`). This module deliberately does NOT duplicate the demo
 * sandbox: demo data must go through the single runtime chosen by session
 * scope, so demo records can physically never reach Postgres/production
 * tables.
 *
 * Surface used by route handlers and the in-memory integration tests:
 *   * `Runtime` / `runtimeFor`      - re-exported from `./runtime`.
 *   * `OrderView` / `orderView`     - one order -> JSON envelope.
 *   * `OrderHistoryView` / `historyView` - list envelope.
 *   * `toUserRecord` / `createPosContext` - actor projection (server-only).
 */
import type { SessionPayload } from "@/server/session";
import type { UserRecord } from "@/domain/shared/ports";

export type { Runtime } from "@/server/runtime";
export { runtimeFor } from "@/server/runtime";

export const ORDER_VIEW_FIELDS = [
  "id",
  "orderNumber",
  "orderType",
  "state",
  "paymentState",
  "subtotalIdr",
  "discountIdr",
  "taxIdr",
  "grandTotalIdr",
  "lineCount",
  "createdAt",
] as const;

export type OrderView = Record<(typeof ORDER_VIEW_FIELDS)[number], string | number | boolean> & {
  lines?: unknown[];
};

export function toUserRecord(session: SessionPayload): UserRecord {
  return {
    id: session.sub,
    email: session.email,
    displayName: session.email.split("@")[0]?.replace(/_/g, " ") ?? session.sub,
    role: session.role,
    tenantId: session.tenantId,
    outletIds: session.outletIds,
    active: true,
    createdAt: new Date(0).toISOString(),
  };
}

export function createPosContext(session: SessionPayload) {
  return { session, actor: toUserRecord(session), tenantId: session.tenantId, outletId: session.outletIds[0] };
}

export function orderView(order: unknown): OrderView {
  const o = order as Record<string, unknown>;
  const toNumber = (k: string): number => Number((o[k] ?? 0));
  return {
    id: String(o["id"] ?? ""),
    orderNumber: String(o["orderNumber"] ?? ""),
    orderType: String(o["orderType"] ?? ""),
    state: String(o["state"] ?? ""),
    paymentState: String(o["paymentState"] ?? ""),
    subtotalIdr: toNumber("subtotalIdr"),
    discountIdr: toNumber("discountIdr"),
    taxIdr: toNumber("taxIdr"),
    grandTotalIdr: toNumber("grandTotalIdr"),
    lineCount: Array.isArray(o["lines"]) ? (o["lines"] as unknown[]).length : 0,
    createdAt: String(o["createdAt"] ?? ""),
  };
}

export interface OrderHistoryView {
  orders: OrderView[];
  total: number;
  page: number;
}

export function historyView(orders: unknown[]): OrderHistoryView {
  return { orders: orders.map(orderView), total: orders.length, page: 1 };
}

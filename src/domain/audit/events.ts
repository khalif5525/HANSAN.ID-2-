/**
 * Audit-event contracts — security-sensitive actions emit these through
 * the AuditLogPort. Storage adapter is pluggable (Phase A1/A9).
 */
import type { DevRole } from "@/types/roles";

export const AUDIT_ACTIONS = {
  // auth / access
  SIGN_IN: "auth.sign_in",
  SIGN_OUT: "auth.sign_out",
  SIGN_IN_FAILED: "auth.sign_in_failed",
  ROLE_ASSIGNED: "auth.role_assigned",
  ACCESS_DENIED: "auth.access_denied",
  PROVISION_OWNER: "auth.provision_owner",
  STAFF_INVITED: "auth.staff_invited",
  PROVISION_DEVELOPER: "auth.provision_developer",
  // finance / refunds
  REFUND_REQUESTED: "finance.refund_requested",
  REFUND_APPROVED: "finance.refund_approved",
  REFUND_REJECTED: "finance.refund_rejected",
  REFUND_COMPLETED: "finance.refund_completed",
  // inventory
  STOCK_ADJUSTED: "inventory.stock_adjusted",
  STOCK_OPNAME: "inventory.stock_opname",
  STOCK_WASTE: "inventory.stock_waste",
  PURCHASE_RECEIVED: "inventory.purchase_received",
  // orders
  ORDER_CREATED: "order.created",
  ORDER_CANCELLED: "order.cancelled",
  ORDER_REFUNDED: "order.refunded",
  PAYMENT_CAPTURED: "order.payment_captured",
  // workforce
  ATTENDANCE_CLOCK_IN: "workforce.clock_in",
  ATTENDANCE_CLOCK_OUT: "workforce.clock_out",
  // configuration
  CONFIG_CHANGED: "config.changed",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEvent {
  readonly id: string;
  readonly action: AuditAction;
  /** Acting principal (user id) or "system". */
  readonly actorId: string;
  readonly actorRole: DevRole | "system";
  readonly entityType: string;
  readonly entityId: string;
  readonly tenantId?: string;
  readonly outletId?: string;
  /** ISO-8601 timestamp. */
  readonly occurredAt: string;
  /** Non-sensitive structured context only — never secrets/PII blobs. */
  readonly metadata?: Record<string, string | number | boolean>;
}

/** Outbound port for audit persistence (DB adapter later; test double in tests). */
export interface AuditLogPort {
  record(event: AuditEvent): Promise<void>;
}

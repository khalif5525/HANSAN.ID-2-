/**
 * RBAC core (Phase A9) — permission model + workspace/outlet/tenant
 * authorization. Server-side enforcement ONLY; UI hiding is cosmetic.
 * Developer/platform role is explicitly separated from business roles.
 */
import { AppError, ERROR_CODES } from "@/domain/shared/errors";
import type { DevRole } from "@/types/roles";

export const PERMISSIONS = [
  // catalog / HQ back office
  "hq:view", "hq:manage_catalog", "hq:manage_inventory", "hq:manage_purchasing",
  "hq:manage_customers", "hq:manage_marketing", "hq:manage_workforce",
  "hq:view_finance", "hq:manage_settings",
  // POS
  "pos:order_create", "pos:order_cancel", "pos:payment_capture", "pos:view_history",
  // KDS
  "kds:view_queue", "kds:advance_ticket", "kds:set_item_status",
  // finance
  "finance:view", "finance:expense_manage", "finance:refund_request",
  "finance:refund_approve", "finance:refund_complete", "finance:reports",
  // workforce
  "workforce:clock_self", "workforce:monitor",
  // platform
  "dev:system", "dev:config",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Role → permissions. Business roles only: owner (back office),
 * pos, kds, finance. `developer` gets ONLY dev:* — platform
 * administration is never business authority (separation enforced).
 */
export const ROLE_PERMISSIONS: Readonly<Record<DevRole, readonly Permission[]>> = {
  owner: [
    "hq:view", "hq:manage_catalog", "hq:manage_inventory", "hq:manage_purchasing",
    "hq:manage_customers", "hq:manage_marketing", "hq:manage_workforce",
    "hq:view_finance", "hq:manage_settings",
    "pos:order_create", "pos:order_cancel", "pos:payment_capture", "pos:view_history",
    "kds:view_queue", "kds:advance_ticket", "kds:set_item_status",
    "finance:view", "finance:expense_manage", "finance:refund_request",
    "finance:refund_approve", "finance:refund_complete", "finance:reports",
    "workforce:monitor",
  ],
  pos: [
    "pos:order_create", "pos:order_cancel", "pos:payment_capture", "pos:view_history",
    "finance:refund_request", // may REQUEST, never approve
    "workforce:clock_self",
    "kds:view_queue",
  ],
  kds: ["kds:view_queue", "kds:advance_ticket", "kds:set_item_status", "workforce:clock_self"],
  finance: [
    "finance:view", "finance:expense_manage", "finance:refund_approve",
    "finance:refund_complete", "finance:reports",
    "hq:view", "hq:view_finance", "workforce:monitor",
  ],
  developer: ["dev:system", "dev:config"], // platform only — no business permissions
};

export function can(role: DevRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function requirePermission(role: DevRole, permission: Permission): void {
  if (!can(role, permission)) {
    throw new AppError(ERROR_CODES.ROLE_NOT_PERMITTED, {
      message: `Role "${role}" lacks permission "${permission}"`,
    });
  }
}

/** Workspace route gate (server-side mirror of route registry roles). */
const WORKSPACE_ACCESS: Readonly<Record<string, readonly DevRole[]>> = {
  "/hq": ["owner"],
  "/pos": ["pos", "owner"],
  "/kds": ["kds", "owner"],
  "/finance": ["finance", "owner"],
  "/developer": ["developer"],
};

export function workspaceAllowed(role: DevRole, workspacePath: string): boolean {
  const allowed = WORKSPACE_ACCESS[workspacePath];
  return Boolean(allowed && allowed.includes(role));
}

export function requireWorkspace(role: DevRole, workspacePath: string): void {
  if (!workspaceAllowed(role, workspacePath)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, { message: `Workspace ${workspacePath} denied for role ${role}` });
  }
}

/**
 * Tenant + outlet scoping (prevents horizontal/vertical access):
 * every record fetch must verify ownership for the acting principal.
 */
export interface Actor {
  userId: string;
  role: DevRole;
  tenantId: string;
  outletIds: string[];
}

export function assertTenant(actor: Actor, recordTenantId: string): void {
  if (actor.tenantId !== recordTenantId) {
    throw new AppError(ERROR_CODES.TENANT_MISMATCH, { message: "Cross-tenant access denied" });
  }
}

/**
 * Outlet access: owner/finance may access any outlet in the tenant; everyone
 * else (including `developer`) is limited to their granted outlets. The
 * `developer` platform role is NOT exempt — it holds no business authority and
 * must never bypass outlet scoping (separation of duties, Phase A4).
 */
export function assertOutlet(actor: Actor, outletId: string): void {
  if (actor.role === "owner" || actor.role === "finance") return;
  if (!actor.outletIds.includes(outletId)) {
    throw new AppError(ERROR_CODES.OUTLET_MISMATCH, { message: "Outlet access denied" });
  }
}

/** Guard for object-level access (IDOR prevention) on any record. */
export function assertAccessible(actor: Actor, record: { tenantId: string; outletId?: string }): void {
  assertTenant(actor, record.tenantId);
  if (record.outletId) assertOutlet(actor, record.outletId);
}

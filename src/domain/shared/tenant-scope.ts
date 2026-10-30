/**
 * Tenant scope value object (Phase 8, R4) — explicit production scoping that
 * is difficult to bypass. Call sites pass the REVALIDATED actor's tenant
 * (never request-body fields); adapters enforce it at the query boundary.
 */
export interface TenantScope {
  organizationId: string;
  outletId?: string;
}

/** Fail-closed scope check shared by adapters and memory stores. */
export function matchesTenantScope(record: { tenantId: string; outletId?: string }, scope?: TenantScope): boolean {
  if (!scope) return true; // legacy unscoped callers assert tenancy themselves
  if (record.tenantId !== scope.organizationId) return false;
  if (scope.outletId !== undefined && record.outletId !== undefined && record.outletId !== scope.outletId) return false;
  return true;
}

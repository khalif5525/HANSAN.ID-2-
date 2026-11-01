/**
 * Tenant authorization context (Phase 8) — transaction-local, fail-closed.
 * Threat model: GUCs are a convenience channel, not a boundary alone.
 * Layers: (1) app checks first (revalidated actor + adapter WHERE);
 * (2) SET LOCAL first in SAME tx (dies with tx, no pool leak);
 * (3) RLS fail-closed predicates. RLS catches app bugs, not arbitrary SQL
 * as app role (that attacker can SET GUCs). Jobs/admin use same path.
 */
import { AppError, ERROR_CODES } from "@/domain/shared/errors";
export type TenantRole = "owner" | "pos" | "kds" | "finance" | "developer";
export interface TenantContext { organizationId: string; outletId: string | null; role: TenantRole; dataScope: "PRODUCTION"; }
export interface TenantTx { $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<unknown>; }
const ROLES = new Set(["owner", "pos", "kds", "finance", "developer"]);
export function requireTenantContext(raw: { organizationId: unknown; outletId?: unknown; role: unknown; dataScope?: unknown }): TenantContext {
  const org = typeof raw.organizationId === "string" ? raw.organizationId.trim() : "";
  if (!org) throw new AppError(ERROR_CODES.TENANT_MISMATCH, { message: "Tenant context missing organization" });
  const oRaw = raw.outletId ?? null;
  const outlet = oRaw === null || oRaw === undefined ? null : String(oRaw).trim();
  if (outlet !== null && outlet.length === 0) throw new AppError(ERROR_CODES.OUTLET_MISMATCH, { message: "Tenant context empty outlet" });
  const role = typeof raw.role === "string" ? raw.role : "";
  if (!ROLES.has(role)) throw new AppError(ERROR_CODES.FORBIDDEN, { message: "Tenant context unknown role" });
  if (raw.dataScope !== undefined && raw.dataScope !== "PRODUCTION") throw new AppError(ERROR_CODES.FORBIDDEN, { message: "Demo scope cannot open production transaction" });
  return { organizationId: org, outletId: outlet, role: role as TenantRole, dataScope: "PRODUCTION" };
}
export function tenantContextForActor(actor: { tenantId: string; outletIds: string[]; role: string }, outletId: string | null): TenantContext {
  if (outletId !== null && !actor.outletIds.includes(outletId) && actor.role !== "owner" && actor.role !== "finance") throw new AppError(ERROR_CODES.OUTLET_MISMATCH, { message: "Outlet not granted" });
  return requireTenantContext({ organizationId: actor.tenantId, outletId, role: actor.role, dataScope: "PRODUCTION" });
}
export function tenantContextSetLocalSql(): string[] {
  return ["SELECT set_config('app.organization_id', $1, true)", "SELECT set_config('app.outlet_id', $1, true)", "SELECT set_config('app.role', $1, true)", "SELECT set_config('app.data_scope', $1, true)"];
}
export async function pinTenantContext(tx: TenantTx, ctx: TenantContext): Promise<void> {
  const v = requireTenantContext(ctx);
  const s = tenantContextSetLocalSql();
  await tx.$executeRawUnsafe(s[0]!, v.organizationId);
  await tx.$executeRawUnsafe(s[1]!, v.outletId ?? "__none__");
  await tx.$executeRawUnsafe(s[2]!, v.role);
  await tx.$executeRawUnsafe(s[3]!, v.dataScope);
}
export interface TenantCapableDb { $transaction<T>(fn: (tx: TenantTx & Record<string, unknown>) => Promise<T>): Promise<T>; }
export async function withTenantTransaction<T>(db: TenantCapableDb, ctx: TenantContext, fn: (tx: TenantTx & Record<string, unknown>) => Promise<T>): Promise<T> {
  const v = requireTenantContext(ctx);
  return db.$transaction(async (tx) => { await pinTenantContext(tx, v); return fn(tx); });
}
/**
 * Persistence-layer pin (Phase 11) — build a TenantContext from an AUTHORITATIVE
 * organizationId that the adapter already holds (a persisted record's tenantId,
 * an explicit tenant argument, a verified scope, or an Outlet->organizationId
 * lookup). Never feed a client-provided tenant identifier into this helper.
 *
 * The `role` is fixed to "pos" only to satisfy `requireTenantContext`'s
 * whitelist: NO RLS predicate reads `app.role` (only `app.organization_id` and
 * `app.outlet_id` are enforced in prisma/rls-tenant-isolation.sql), and real
 * RBAC is enforced at the route/authz layer before any adapter is reached. The
 * dataScope is always PRODUCTION — demo sessions never reach the Prisma
 * adapters (runtimeFor routes them to the in-memory sandbox).
 */
export function persistencePinContext(organizationId: string, outletId: string | null): TenantContext {
  return requireTenantContext({ organizationId, outletId, role: "pos", dataScope: "PRODUCTION" });
}

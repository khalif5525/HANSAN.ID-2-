/**
 * Server-side authorization (Phase 3) — the ONLY place API handlers may
 * obtain an identity. Fail-closed by design:
 *
 *   * No/invalid/expired cookie            -> UNAUTHENTICATED (401)
 *   * Missing SESSION_SECRET in production -> AUTH_NOT_CONFIGURED (503)
 *   * Role lacks permission                -> FORBIDDEN (403)
 *   * Cross-tenant / cross-outlet access   -> TENANT_MISMATCH / OUTLET_MISMATCH (403)
 *   * Demo session touching production     -> FORBIDDEN (403)
 *
 * Sidebar/visibility checks are cosmetic; this module is authoritative.
 */
import { AppError, ERROR_CODES } from "@/domain/shared/errors";
import {
  can,
  requirePermission,
  requireWorkspace,
  assertTenant,
  assertOutlet,
  type Actor,
  type Permission,
} from "@/domain/authz/rbac";
import { AUDIT_ACTIONS, type AuditEvent, type AuditLogPort } from "@/domain/audit/events";
import { createId } from "@/domain/shared/ids";
import type { DevRole } from "@/types/roles";
import {
  getSessionSecret,
  verifySession,
  SESSION_COOKIE,
  type SessionPayload,
} from "@/server/session";

export interface AuthContext {
  session: SessionPayload;
  actor: Actor;
}

/** Read the demo session cookie from a Request; null when absent/invalid. */
export async function readSessionFromRequest(req: Request): Promise<SessionPayload | null> {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  const token = match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : null;
  const { secret } = getSessionSecret();
  return verifySession(token, secret);
}

/**
 * Resolve an authenticated context or throw. `scope: "api"` fails closed
 * with 503 when the production secret is unconfigured (no cookie can even
 * exist then), 401 when a cookie exists but is invalid/absent.
 */
export async function requireAuth(req: Request): Promise<AuthContext> {
  const { secret, source } = getSessionSecret();
  if (!secret && source === "unconfigured") {
    throw new AppError(ERROR_CODES.AUTH_NOT_CONFIGURED, {
      message: "Authentication is not configured on this deployment (SESSION_SECRET missing)",
    });
  }
  const session = await readSessionFromRequest(req);
  if (!session) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, { message: "Sign-in required" });
  }
  return { session, actor: toActor(session) };
}

export function toActor(session: SessionPayload): Actor {
  return {
    userId: session.sub,
    role: session.role as DevRole,
    tenantId: session.tenantId,
    outletIds: session.outletIds,
  };
}

/** Permission gate + audit trail for denied attempts. */
export function authorize(
  ctx: AuthContext,
  permission: Permission,
  audit?: AuditLogPort,
  meta?: Record<string, string | number | boolean>,
): void {
  try {
    requirePermission(ctx.actor.role, permission);
  } catch (error) {
    void recordAccessDenied(audit, ctx, permission, meta);
    throw error;
  }
}

/** Workspace gate (mirrors rbac.ts WORKSPACE_ACCESS) for page-level checks. */
export function authorizeWorkspace(ctx: AuthContext, workspacePath: string): void {
  requireWorkspace(ctx.actor.role, workspacePath);
}

/** Tenant + outlet gate for a concrete record. */
export function authorizeRecord(
  ctx: AuthContext,
  record: { tenantId: string; outletId?: string },
  audit?: AuditLogPort,
): void {
  try {
    assertTenant(ctx.actor, record.tenantId);
    if (record.outletId) assertOutlet(ctx.actor, record.outletId);
  } catch (error) {
    void recordAccessDenied(audit, ctx, "record.access", { entityType: "record" });
    throw error;
  }
}

/**
 * Demo isolation: a demo session may only ever address demo-scope data.
 * This is the server-side guarantee that demo access can never obtain
 * production privileges or touch production ledgers.
 */
export function assertDemoScope(ctx: AuthContext, requestedScope: "DEMO" | "PRODUCTION"): void {
  if (ctx.session.mode === "demo" && requestedScope === "PRODUCTION") {
    throw new AppError(ERROR_CODES.FORBIDDEN, {
      message: "Demo sessions cannot access production data",
    });
  }
  if (ctx.session.dataScope === "PRODUCTION" && requestedScope === "DEMO") {
    // live sessions may browse demo sandbox, but never write into it implicitly
    return;
  }
}

/** Convenience: does this role hold a permission? (read-only UI hints). */
export function roleCan(role: DevRole, permission: Permission): boolean {
  return can(role, permission);
}

/**
 * CSRF posture for cookie-authenticated mutations (Phase 3): SameSite=Lax
 * already blocks cross-site POST cookies; this Origin check is the second
 * layer. Absent Origin (curl/same-origin GET-like clients) passes — the
 * cookie itself never leaks cross-site under Lax.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return;
  let requestOrigin: string;
  try {
    requestOrigin = new URL(req.url).origin;
  } catch {
    throw new AppError(ERROR_CODES.FORBIDDEN, { message: "Invalid request URL" });
  }
  if (origin !== requestOrigin) {
    throw new AppError(ERROR_CODES.FORBIDDEN, { message: "Cross-origin request rejected" });
  }
}

async function recordAccessDenied(
  audit: AuditLogPort | undefined,
  ctx: AuthContext,
  permission: string,
  meta?: Record<string, string | number | boolean>,
): Promise<void> {
  if (!audit) return;
  const event: AuditEvent = {
    id: createId("aud"),
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    actorId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    entityType: "permission",
    entityId: permission,
    tenantId: ctx.actor.tenantId,
    occurredAt: new Date().toISOString(),
    ...(meta ? { metadata: meta } : {}),
  };
  try {
    await audit.record(event);
  } catch {
    /* audit must never break the deny path */
  }
}

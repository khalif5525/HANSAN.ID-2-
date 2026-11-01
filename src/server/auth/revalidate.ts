/**
 * Live session revalidation (Phase B3).
 *
 * A signed HANSAN cookie proves a session was ISSUED — not that it is still
 * CURRENTLY authorized. Before any sensitive LIVE operation we revalidate the
 * actor against trusted server-side data:
 *   1. the Supabase identity is still valid (auth.getUser);
 *   2. the HANSAN User (resolved by authSubject) is active and matches the
 *      session subject;
 *   3. the Organization / Membership / Outlet are active and consistent with
 *      the session's tenant (resolveLiveActor re-derives role + outlets from
 *      the CURRENT database state — never the cookie claims).
 *
 * tenantId must still match the session; role + outlets are taken from current
 * DB truth. Demo sessions never reach this module (they use the in-memory
 * sandbox). This module is server-only and is loaded by routes via dynamic
 * import so the demo-only test graph never pulls in the server-only Supabase
 * client.
 */
import "server-only";
import { AppError, ERROR_CODES } from "@/domain/shared/errors";
import type { Actor } from "@/domain/authz/rbac";
import type { SessionPayload } from "@/server/session";
import { getPrisma } from "@/server/db/client";
import { createClient } from "@/server/supabase/server";
import {
  resolveLiveActor,
  type LiveSessionDb,
  type VerifiedIdentity,
} from "@/server/auth/live-session";

export interface RevalidatedLiveContext {
  session: SessionPayload;
  actor: Actor;
}

/**
 * Revalidate a LIVE session and return the CURRENT authoritative actor.
 * Fails closed (generic, non-sensitive errors) on any unmet check.
 * Dependencies are injected so this core is unit-testable without Supabase.
 */
export async function revalidateLiveSession(
  session: SessionPayload,
  deps: { db: LiveSessionDb; getUser: () => Promise<VerifiedIdentity | null> },
): Promise<Actor> {
  if (session.mode !== "live") {
    // Demo sessions are never revalidated here.
    throw new AppError(ERROR_CODES.INTERNAL, {
      message: "revalidateLiveSession called for a non-live session",
    });
  }

  // 1) Supabase identity must still be valid (missing/invalid/refreshed-out).
  const identity = await deps.getUser();
  if (!identity) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, { message: "Authentication required" });
  }

  // 2) Re-derive the actor from CURRENT DB state. Throws on inactive User /
  //    Membership / Organization / Outlet, or ambiguous multi-org/role state.
  const resolved = await resolveLiveActor(deps.db, identity.id);

  // 3) The authenticated identity must map to the SAME HANSAN user as the session.
  if (resolved.userId !== session.sub) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
      message: "Session no longer matches the authenticated identity",
    });
  }

  // 4) The session's tenant must still be the user's active organization.
  if (resolved.tenantId !== session.tenantId) {
    throw new AppError(ERROR_CODES.TENANT_MISMATCH, {
      message: "Session tenant is no longer valid",
    });
  }

  // Role + outlets are CURRENT database truth — never the cookie claims.
  return {
    userId: resolved.userId,
    role: resolved.role,
    tenantId: resolved.tenantId,
    outletIds: resolved.outletIds,
  };
}

/**
 * Route-facing convenience: build the trusted deps (Prisma + Supabase server
 * client) and revalidate. Loaded via dynamic import by routes so the demo-only
 * test graph never pulls in the server-only Supabase client at module load.
 */
export async function requireRevalidatedLiveContext(
  session: SessionPayload,
): Promise<RevalidatedLiveContext> {
  const db = getPrisma();
  if (!db) {
    throw new AppError(ERROR_CODES.PERSISTENCE_NOT_CONFIGURED, {
      message: "Live session verification requires persistence to be configured",
    });
  }
  const supabase = createClient();
  const actor = await revalidateLiveSession(session, {
    db: db as unknown as LiveSessionDb,
    getUser: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user) return null;
      return { id: data.user.id, email: data.user.email ?? null };
    },
  });
  return { session, actor };
}

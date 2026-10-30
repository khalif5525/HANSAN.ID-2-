/**
 * Refund decision/complete API (OA14) — Manager/Back-Office approval and
 * completion of a pending/approved refund.
 *
 * Request lifecycle:
 *   1. assertSameOrigin   — CSRF second layer.
 *   2. requireAuth        — fail-closed identity (401/503).
 *   3. authorize          — RBAC: `finance:refund_approve` for approve/reject,
 *      `finance:refund_complete` for complete (403 + audit).
 *   4. Tenant/outlet scope — refund's tenantId/outletId must match the actor's
 *      authoritative session scope (cross-tenant → 404, non-leaking).
 *   5. FinanceService.decideRefund / completeRefund — atomic conditional
 *      transition via `transitionRefund`; concurrent modification → 409 CONFLICT.
 *   6. Persist decided/completed Refund + audit event.
 *
 * Client-supplied roles and tenant IDs are never trusted: authorization is
 * server-side from the session, and the refund record's own tenantId is the
 * source of truth for scope enforcement.
 */
import { jsonError, jsonFail, jsonOk } from "@/server/http";
import { requireAuth, authorize, assertSameOrigin, type AuthContext } from "@/server/authz";
import type { Actor } from "@/domain/authz/rbac";
import { runtimeFor } from "@/server/runtime";
import { FinanceService } from "@/domain/finance/service";
import { ERROR_CODES } from "@/domain/shared/errors";
import type { UserRecord } from "@/domain/shared/ports";

function actorToUser(ctx: AuthContext): UserRecord {
  return {
    id: ctx.actor.userId,
    email: ctx.session.email,
    displayName: ctx.session.email,
    role: ctx.actor.role,
    tenantId: ctx.actor.tenantId,
    outletIds: ctx.actor.outletIds,
    active: true,
    createdAt: new Date(ctx.session.iat * 1000).toISOString(),
  };
}

function serviceFor(runtime: NonNullable<Awaited<ReturnType<typeof runtimeFor>>>): FinanceService {
  return new FinanceService({
    finance: runtime.finance,
    orders: runtime.orders,
    audit: runtime.audit,
    clock: () => new Date(),
  });
}

interface RefundDecisionBody {
  action: "approve" | "reject" | "complete";
}

function getRefundId(req: Request): string | null {
  const match = req.url.match(/^.*\/api\/refunds\/([^\/]+)\/?/);
  return match ? match[1] : null;
}

export async function PATCH(req: Request): Promise<Response> {
  try {
    assertSameOrigin(req);
    const ctx = await requireAuth(req);

    const runtime = runtimeFor(ctx.session);
    if (!runtime) {
      return jsonFail(
        ERROR_CODES.PERSISTENCE_NOT_CONFIGURED,
        "Refund decisions are not configured on this deployment",
        503,
      );
    }

    let liveActor: Actor | null = null;
    if (runtime.scope === "PRODUCTION") {
      const { requireRevalidatedLiveContext } = await import("@/server/auth/revalidate");
      liveActor = (await requireRevalidatedLiveContext(ctx.session)).actor;
    }
    const authCtx: AuthContext = liveActor ? { session: ctx.session, actor: liveActor } : ctx;

    const refundId = getRefundId(req);
    if (!refundId) {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, "Refund ID is required", 400);
    }

    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, "Invalid refund decision", 400);
    }
    const { action } = body as RefundDecisionBody;
    if (action !== "approve" && action !== "reject" && action !== "complete") {
      return jsonFail(
        ERROR_CODES.VALIDATION_FAILED,
        "action must be 'approve', 'reject', or 'complete'",
        400,
      );
    }

    const actor = actorToUser(authCtx);
    const finance = serviceFor(runtime);

    // Load the refund to verify tenant scope before authorizing.
    const refund = await runtime.finance.getRefund(refundId, authCtx.actor.tenantId);
    if (!refund) {
      return jsonFail(ERROR_CODES.NOT_FOUND, "Refund not found", 404);
    }
    // Cross-tenant access is denied as NOT_FOUND (no existence leak).
    if (refund.tenantId !== authCtx.actor.tenantId) {
      return jsonFail(ERROR_CODES.NOT_FOUND, "Refund not found", 404);
    }
    // Outlet scope: owner/finance may access any outlet; others limited to granted outlets.
    if (authCtx.actor.role !== "owner" && authCtx.actor.role !== "finance") {
      if (!authCtx.actor.outletIds.includes(refund.outletId)) {
        return jsonFail(ERROR_CODES.OUTLET_MISMATCH, "Outlet access denied", 403);
      }
    }

    let result: Awaited<ReturnType<typeof finance.decideRefund>>;

    if (action === "approve" || action === "reject") {
      authorize(authCtx, "finance:refund_approve", runtime.audit);
      const decision = action === "approve" ? "approved" : "rejected";
      result = await finance.decideRefund(refundId, decision, actor);
    } else {
      // action === "complete"
      authorize(authCtx, "finance:refund_complete", runtime.audit);
      result = await finance.completeRefund(refundId, actor);
    }

    return jsonOk({
      id: result.id,
      status: result.status,
      amountIdr: result.amountIdr,
      orderId: result.orderId,
      tenantId: result.tenantId,
      outletId: result.outletId,
      decidedBy: result.decidedBy,
      decidedAt: result.decidedAt,
      createdAt: result.createdAt,
    });
  } catch (error) {
    return jsonError(error);
  }
}
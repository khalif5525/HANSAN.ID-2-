/**
 * Refund request API (OA14) — POS-side refund request entry point.
 *
 * Request lifecycle (every step is server-enforced; none rely on the client):
 *   1. assertSameOrigin   — CSRF second layer.
 *   2. requireAuth        — fail-closed identity (401/503; no cookie → denied).
 *   3. authorize          — RBAC permission `finance:refund_request` (403 + audit).
 *   4. runtimeFor(session) — DEMO → isolated in-memory sandbox; live → Prisma.
 *   5. FinanceService.requestRefund — server-authoritative validation:
 *      order exists + belongs to caller's tenant/outlet, order is PAID,
 *      amount is a positive integer ≤ order grand total, cash-only method.
 *   6. Persist pending Refund + audit event.
 *
 * Client-supplied roles, tenant IDs, and amounts are never trusted:
 * the tenant/outlet scope comes from the authenticated session, and the
 * amount is validated against the authoritative order record.
 */
import { jsonError, jsonFail, jsonOk } from "@/server/http";
import { requireAuth, authorize, assertSameOrigin, type AuthContext } from "@/server/authz";
import type { Actor } from "@/domain/authz/rbac";
import { runtimeFor } from "@/server/runtime";
import { FinanceService } from "@/domain/finance/service";
import { ERROR_CODES } from "@/domain/shared/errors";
import type { UserRecord } from "@/domain/shared/ports";
import { createId } from "@/domain/shared/ids";
import { AUDIT_ACTIONS } from "@/domain/audit/events";
import { assertStarted, requestHash } from "@/server/idempotency";

/** Map the authenticated actor onto the UserRecord the service expects. */
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

interface RefundRequestBody {
  orderId: string;
  amountIdr: number;
  reason: string;
}

export async function POST(req: Request): Promise<Response> {
  // Declared outside try so the catch block can release an in_progress claim.
  let idempotencyKey: string | null = null;
  let idempotencyReleased = false;
  let runtime: NonNullable<Awaited<ReturnType<typeof runtimeFor>>> | null = null;
  let failTenantId: string | null = null;

  try {
    assertSameOrigin(req);
    const ctx = await requireAuth(req);

    runtime = runtimeFor(ctx.session);
    if (!runtime) {
      return jsonFail(
        ERROR_CODES.PERSISTENCE_NOT_CONFIGURED,
        "Refund requests are not configured on this deployment",
        503,
      );
    }

    let liveActor: Actor | null = null;
    if (runtime.scope === "PRODUCTION") {
      const { requireRevalidatedLiveContext } = await import("@/server/auth/revalidate");
      liveActor = (await requireRevalidatedLiveContext(ctx.session)).actor;
    }
    const authCtx: AuthContext = liveActor ? { session: ctx.session, actor: liveActor } : ctx;

    authorize(authCtx, "finance:refund_request", runtime.audit);

    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, "Invalid refund request", 400);
    }
    const { orderId, amountIdr, reason } = body as RefundRequestBody;
    if (typeof orderId !== "string" || !orderId) {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, "orderId is required", 400);
    }
    if (!Number.isInteger(amountIdr) || amountIdr <= 0) {
      return jsonFail(
        ERROR_CODES.VALIDATION_FAILED,
        "Refund amount must be a positive integer",
        400,
      );
    }
    if (typeof reason !== "string" || !reason.trim()) {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, "reason is required", 400);
    }

    // --- Idempotency (optional Idempotency-Key header) -----------------------
    // When present, a replay of the same key returns the original response
    // verbatim (no duplicate refund, no duplicate audit event). A conflicting
    // payload under the same key is rejected with 409 CONFLICT. When absent,
    // the request proceeds without idempotency (pre-OA15 behavior).
    failTenantId = authCtx.actor.tenantId;
    idempotencyKey = req.headers.get("idempotency-key");
    if (idempotencyKey) {
      let hash: string;
      try {
        hash = await requestHash(body);
      } catch (hashError) {
        if (hashError instanceof Error && hashError.message.startsWith('requestHash:')) {
          return jsonFail(ERROR_CODES.VALIDATION_FAILED, 'Invalid refund request', 400);
        }
        throw hashError;
      }
      const begin = await runtime.idempotency.begin({
        organizationId: authCtx.actor.tenantId,
        scope: "refund.request",
        key: idempotencyKey,
        requestHash: hash,
      });
      if (begin.status === "replay") {
        return jsonOk(begin.response as Record<string, unknown>, 201);
      }
      assertStarted(begin); // "conflict" → CONFLICT (409)
    }

    const actor = actorToUser(authCtx);
    const refund = await serviceFor(runtime as NonNullable<typeof runtime>).requestRefund({
      tenantId: authCtx.actor.tenantId,
      outletId: authCtx.actor.outletIds[0],
      orderId,
      amountIdr,
      reason: reason.trim(),
      requester: actor,
    });

    await runtime.audit.record({
      id: createId("aud"),
      action: AUDIT_ACTIONS.REFUND_REQUESTED,
      actorId: authCtx.actor.userId,
      actorRole: authCtx.actor.role,
      entityType: "refund",
      entityId: refund.id,
      tenantId: refund.tenantId,
      outletId: refund.outletId,
      occurredAt: refund.createdAt,
      metadata: { amountIdr: refund.amountIdr, orderId: refund.orderId },
    });

    const responseBody = {
      id: refund.id,
      status: refund.status,
      amountIdr: refund.amountIdr,
      orderId: refund.orderId,
      tenantId: refund.tenantId,
      outletId: refund.outletId,
      createdAt: refund.createdAt,
    };

    if (idempotencyKey) {
      idempotencyReleased = true;
      await runtime.idempotency.complete({
        organizationId: authCtx.actor.tenantId,
        scope: "refund.request",
        key: idempotencyKey,
        response: responseBody,
      });
    }

    return jsonOk(responseBody, 201);
  } catch (error) {
    // Release an in_progress idempotency claim so a retry can re-execute.
    // A completed claim is never released (replay must win).
    if (idempotencyKey && !idempotencyReleased && failTenantId && runtime) {
      await runtime.idempotency
        .fail({
          organizationId: failTenantId,
          scope: "refund.request",
          key: idempotencyKey,
        })
        .catch(() => {});
    }
    return jsonError(error);
  }
}
/**
 * POS order creation (Phase 4) — the real order lifecycle entry point.
 *
 * Request lifecycle (every step is server-enforced; none rely on the client):
 *   1. assertSameOrigin   — CSRF second layer (cookie is SameSite=Lax).
 *   2. requireAuth        — fail-closed identity (401/503; no cookie → denied).
 *   3. authorize          — RBAC permission "pos:order_create" (403 + audit).
 *   4. rateLimit          — abuse protection per identity.
 *   5. Idempotency-Key    — a retry replays the original order (no duplicates).
 *   6. runtimeFor(session)— DEMO → isolated in-memory sandbox; live → Prisma.
 *                           Missing persistence for a live session → fail closed.
 *   7. PosService.createOrder — server-authoritative pricing (client prices
 *      are ignored), explicit station routing, integer-rupiah totals, and a
 *      transactionally persisted parent order + items (adapter guarantees).
 *
 * The order is NEVER a UI-only draft: createOrder persists it through the
 * OrderPort. Payment capture is a separate future operation (gateway
 * credentials + rules are BLOCKER-005) — this route only PLACES the order.
 */
import { jsonError, jsonFail, jsonOk } from "@/server/http";
import { requireAuth, authorize, assertSameOrigin, type AuthContext } from "@/server/authz";
import type { Actor } from "@/domain/authz/rbac";
import { NextResponse } from "next/server";
import { runtimeFor, type Runtime } from "@/server/runtime";
import { rateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { assertStarted, requestHash } from "@/server/idempotency";
import { PosService } from "@/domain/pos/service";
import { parseCreateOrder, type CreateOrderRequest } from "@/domain/pos/contracts";
import type { ApiResponse } from "@/domain/shared/api-contract";
import { getTaxConfig } from "@/config/tax";
import { ERROR_CODES } from "@/domain/shared/errors";
import type { UserRecord } from "@/domain/shared/ports";
import { createId } from "@/domain/shared/ids";
import { AUDIT_ACTIONS } from "@/domain/audit/events";
import { historyView, type OrderHistoryView } from "@/server/compose";
import { createProductionOrder } from "@/server/orders-create";
import { orderCreateResponse } from "@/server/order-response";
import type { PrismaOrders } from "@/server/db/orders-adapter";

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "local";
}

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

function serviceFor(runtime: Runtime): PosService {
  return new PosService({
    orders: runtime.orders,
    catalog: runtime.catalog,
    audit: runtime.audit,
    payments: runtime.payments,
    tax: getTaxConfig(),
    clock: () => new Date(),
  });
}

export async function POST(req: Request): Promise<Response> {
  try {
    assertSameOrigin(req);
    const ctx = await requireAuth(req);

    const runtime = runtimeFor(ctx.session);
    if (!runtime) {
      // A live/production session with no DATABASE_URL must fail closed —
      // we never fabricate or silently persist an order anywhere else.
      return jsonFail(
        ERROR_CODES.PERSISTENCE_NOT_CONFIGURED,
        "Order persistence is not configured on this deployment",
        503,
      );
    }

    // B3: revalidate LIVE sessions against current trusted server-side data
    // (Supabase identity + DB membership/org/outlet) BEFORE the authorization
    // decision, so the permission gate uses the CURRENT role/tenant/outlet —
    // never the cookie claims (a role downgraded after issuance cannot act on a
    // stale cookie). Demo sessions skip this path (in-memory sandbox) and keep
    // using the verified session claims. Loaded lazily so the demo-only test
    // graph never pulls in the server-only Supabase client.
    let liveActor: Actor | null = null;
    if (runtime.scope === "PRODUCTION") {
      const { requireRevalidatedLiveContext } = await import("@/server/auth/revalidate");
      liveActor = (await requireRevalidatedLiveContext(ctx.session)).actor;
    }
    const authCtx: AuthContext = liveActor ? { session: ctx.session, actor: liveActor } : ctx;

    authorize(authCtx, "pos:order_create", runtime.audit);

    const rl = rateLimit({ key: `orders:${authCtx.actor.userId}:${clientIp(req)}`, ...RATE_LIMITS.order_create });
    if (!rl.allowed) {
      return jsonFail(ERROR_CODES.RATE_LIMITED, "Too many requests", 429);
    }

    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = parseCreateOrder(body);
    if (!parsed.ok) {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, "Invalid order request", 400, parsed.issues);
    }
    const request: CreateOrderRequest = parsed.value;

    // The outlet the actor is acting in. For LIVE sessions it comes from the
    // REVALIDATED actor (current DB truth); for demo it is the verified session
    // outlet. A client-supplied outletId is always ignored.
    const outletId = authCtx.actor.outletIds[0];
    if (!outletId) {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, "No outlet assigned to this session", 400);
    }

    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, "Idempotency-Key header is required", 400);
    }

    const scope = "orders.create";
    const hash = await requestHash({ outletId, ...request });
    const begin = await runtime.idempotency.begin({
      organizationId: authCtx.actor.tenantId,
      scope,
      key: idempotencyKey,
      requestHash: hash,
    });
    if (begin.status === "replay") {
      return jsonOk(begin.response, 200);
    }
    assertStarted(begin); // "conflict" → CONFLICT (409)

    try {
      const isProduction = runtime.scope === "PRODUCTION";

      // PRODUCTION: ONE atomic transaction writes order + items + sequence
      // counter + audit row + idempotency completion together, with an explicit
      // dataScope of PRODUCTION and tenant/outlet taken from the VERIFIED
      // session (never from the request body). DEMO: the process-local in-memory
      // sandbox path records audit + idempotency as separate best-effort steps
      // (serverAudit never throws; nothing here touches Postgres).
      const order = isProduction
        ? await createProductionOrder({
            orders: runtime.orders as PrismaOrders,
            actor: {
              userId: authCtx.actor.userId,
              role: authCtx.actor.role,
              tenantId: authCtx.actor.tenantId,
              outletId,
            },
            request,
            idempotency: { organizationId: authCtx.actor.tenantId, scope, key: idempotencyKey },
          })
        : await serviceFor(runtime).createOrder({
            tenantId: authCtx.actor.tenantId,
            outletId,
            actor: actorToUser(authCtx),
            req: request,
          });

      if (!isProduction) {
        // Order placement is a security-relevant business action: record it on
        // the demo sandbox audit sink exactly once, on the fresh-create path
        // only (Idempotency-Key replays return early above). The production
        // audit row is already committed atomically inside createProductionOrder.
        await runtime.audit.record({
          id: createId("aud"),
          action: AUDIT_ACTIONS.ORDER_CREATED,
          actorId: authCtx.actor.userId,
          actorRole: authCtx.actor.role,
          entityType: "order",
          entityId: order.id,
          tenantId: authCtx.actor.tenantId,
          outletId: order.outletId,
          occurredAt: order.createdAt,
          metadata: {
            orderNumber: order.orderNumber,
            itemCount: order.lines.length,
            grandTotalIdr: order.grandTotalIdr,
            stations: Array.from(new Set(order.lines.map((l) => l.station))).join(","),
          },
        });
      }

      const response = orderCreateResponse(order);
      if (!isProduction) {
        await runtime.idempotency.complete({ organizationId: authCtx.actor.tenantId, scope, key: idempotencyKey, response });
      }
      return jsonOk(response, 201);
    } catch (error) {
      if (idempotencyKey) {
        await runtime.idempotency
          .fail({ organizationId: authCtx.actor.tenantId, scope, key: idempotencyKey })
          .catch(() => {});
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(req: Request): Promise<NextResponse<ApiResponse<OrderHistoryView>>> {
  try {
    const ctx = await requireAuth(req);
    assertSameOrigin(req);

    const runtime = runtimeFor(ctx.session);
    if (!runtime) {
      return jsonFail(
        ERROR_CODES.PERSISTENCE_NOT_CONFIGURED,
        "Order history is not configured on this deployment",
        503,
      );
    }

    // B3: revalidate LIVE sessions before reading production history, so the
    // permission gate + outlet scope use CURRENT role/outlet — never the cookie
    // claims. Demo sessions skip this (in-memory sandbox).
    let liveActor: Actor | null = null;
    if (runtime.scope === "PRODUCTION") {
      const { requireRevalidatedLiveContext } = await import("@/server/auth/revalidate");
      liveActor = (await requireRevalidatedLiveContext(ctx.session)).actor;
    }
    const authCtx: AuthContext = liveActor ? { session: ctx.session, actor: liveActor } : ctx;

    authorize(authCtx, "pos:view_history", runtime.audit);

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "50"), 1), 200);
    // Validation: a non-empty sinceIso MUST be a valid ISO 8601 timestamp.
    // The persistence adapter passes it straight to the `createdAt gte`
    // filter, so a malformed value would reach Postgres as an Invalid Date
    // and either error or silently return wrong rows. Missing/empty is
    // intentionally treated as "no filter" (undefined).
    const sinceIso: string | undefined = searchParams.get("sinceIso") ?? undefined;
    if (sinceIso !== undefined && sinceIso !== "") {
      const parsed = new Date(sinceIso);
      if (Number.isNaN(parsed.getTime())) {
        return jsonFail(ERROR_CODES.VALIDATION_FAILED, "sinceIso must be a valid ISO 8601 timestamp", 400);
      }
    }

    const outletId = authCtx.actor.outletIds[0];
    if (!outletId) {
      return jsonFail(ERROR_CODES.OUTLET_MISMATCH, "No outlet assigned to this session", 403);
    }

    const history = await serviceFor(runtime).history({ outletId, limit, sinceIso });
    return jsonOk(historyView(history), 200);
  } catch (error) {
    return jsonError(error);
  }
}

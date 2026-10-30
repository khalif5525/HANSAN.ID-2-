/**
 * Customer order creation (Phase C1) � customer-facing order entry point.
 * All steps server-enforced; server-authoritative pricing; idempotent.
 */
import { jsonError, jsonFail, jsonOk } from '@/server/http';
import { requireAuth, authorize, assertSameOrigin, type AuthContext } from '@/server/authz';
import type { Actor } from '@/domain/authz/rbac';
import { NextResponse } from 'next/server';
import { runtimeFor, type Runtime } from '@/server/runtime';
import { rateLimit, RATE_LIMITS } from '@/server/rate-limit';
import { assertStarted, requestHash } from '@/server/idempotency';
import { PosService } from '@/domain/pos/service';
import { parseCreateOrder } from '@/domain/pos/contracts';
import type { ApiResponse } from '@/domain/shared/api-contract';
import { getTaxConfig } from '@/config/tax';
import { ERROR_CODES } from '@/domain/shared/errors';
import type { UserRecord } from '@/domain/shared/ports';
import { createId } from '@/domain/shared/ids';
import { AUDIT_ACTIONS } from '@/domain/audit/events';
import { orderCreateResponse } from '@/server/order-response';
import { OrderHistoryView, historyView } from '@/server/compose';
import { createProductionOrder } from '@/server/orders-create';
import type { PrismaOrders } from '@/server/db/orders-adapter';

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

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'local';
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
  let idempotencyKey: string | null = null;
  let runtime: Runtime | null = null;

  try {
    assertSameOrigin(req);
    const ctx = await requireAuth(req);

    runtime = runtimeFor(ctx.session);
    if (!runtime) {
      return jsonFail(
        ERROR_CODES.PERSISTENCE_NOT_CONFIGURED,
        'Order persistence is not configured on this deployment',
        503,
      );
    }

    let liveActor: Actor | null = null;
    if (runtime.scope === 'PRODUCTION') {
      const { requireRevalidatedLiveContext } = await import('@/server/auth/revalidate');
      liveActor = (await requireRevalidatedLiveContext(ctx.session)).actor;
    }
    const authCtx: AuthContext = liveActor ? { session: ctx.session, actor: liveActor } : ctx;

    authorize(authCtx, 'pos:order_create', runtime.audit);

    const rl = rateLimit({ key: `orders:${authCtx.actor.userId}:${clientIp(req)}`, ...RATE_LIMITS.order_create });
    if (!rl.allowed) {
      return jsonFail(ERROR_CODES.RATE_LIMITED, 'Too many requests', 429);
    }

    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = parseCreateOrder(body);
    if (!parsed.ok) {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, 'Invalid order request', 400, parsed.issues);
    }
    const request = parsed.value;

    const outletId = authCtx.actor.outletIds[0];
    if (!outletId) {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, 'No outlet assigned to this session', 400);
    }

    idempotencyKey = req.headers.get('idempotency-key');
    if (!idempotencyKey) {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, 'Idempotency-Key header is required', 400);
    }

    const scope = 'customer.orders.create';

    const hash = await requestHash({ outletId, ...request });
    const begin = await runtime.idempotency.begin({
      organizationId: authCtx.actor.tenantId,
      scope,
      key: idempotencyKey,
      requestHash: hash,
    });
    if (begin.status === 'replay') {
      return jsonOk(begin.response, 200);
    }
    assertStarted(begin);

    try {
      const isProduction = runtime.scope === 'PRODUCTION';

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
        await runtime.audit.record({
          id: createId('aud'),
          action: AUDIT_ACTIONS.ORDER_CREATED,
          actorId: authCtx.actor.userId,
          actorRole: authCtx.actor.role,
          entityType: 'order',
          entityId: order.id,
          tenantId: authCtx.actor.tenantId,
          outletId: order.outletId,
          occurredAt: order.createdAt,
          metadata: {
            orderNumber: order.orderNumber,
            itemCount: order.lines.length,
            grandTotalIdr: order.grandTotalIdr,
            stations: Array.from(new Set(order.lines.map((l) => l.station))).join(','),
            channel: 'customer',
          },
        });
      }

      const response = orderCreateResponse(order);
      if (!isProduction) {
        await runtime.idempotency.complete({
          organizationId: authCtx.actor.tenantId,
          scope,
          key: idempotencyKey,
          response,
        });
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
        'Order history is not configured on this deployment',
        503,
      );
    }

    let liveActor: Actor | null = null;
    if (runtime.scope === 'PRODUCTION') {
      const { requireRevalidatedLiveContext } = await import('@/server/auth/revalidate');
      liveActor = (await requireRevalidatedLiveContext(ctx.session)).actor;
    }
    const authCtx: AuthContext = liveActor ? { session: ctx.session, actor: liveActor } : ctx;

    authorize(authCtx, 'pos:view_history', runtime.audit);

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? '50'), 1), 200);
    const sinceIso: string | undefined = searchParams.get('sinceIso') ?? undefined;
    if (sinceIso !== undefined && sinceIso !== '') {
      const parsed = new Date(sinceIso);
      if (Number.isNaN(parsed.getTime())) {
        return jsonFail(ERROR_CODES.VALIDATION_FAILED, 'sinceIso must be a valid ISO 8601 timestamp', 400);
      }
    }

    const outletId = authCtx.actor.outletIds[0];
    if (!outletId) {
      return jsonFail(ERROR_CODES.OUTLET_MISMATCH, 'No outlet assigned to this session', 403);
    }

    const history = await serviceFor(runtime).history({ outletId, limit, sinceIso });
    return jsonOk(historyView(history), 200);
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Customer reservation creation (Phase C2) — customer-facing reservation entry.
 * All validation server-side; client-provided availability never trusted.
 */
import { jsonError, jsonFail, jsonOk } from "@/server/http";
import { requireAuth, authorize, assertSameOrigin, type AuthContext } from "@/server/authz";
import type { Actor } from "@/domain/authz/rbac";
import { runtimeFor, type Runtime } from "@/server/runtime";
import { rateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { assertStarted, requestHash } from "@/server/idempotency";
import { ReservationService } from "@/domain/reservations/service";
import type { ReservationPort } from "@/domain/reservations/service";
import { ERROR_CODES } from "@/domain/shared/errors";

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "local";
}

const createReservationSchema = {
  customerName: (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null),
  customerEmail: (v: unknown): string | null => (typeof v === "string" && v.includes("@") ? v.trim().toLowerCase() : null),
  customerPhone: (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null),
  partySize: (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 20 ? v : null),
  reservationAt: (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) || d.getTime() <= Date.now() ? null : d.toISOString();
  },
  durationMinutes: (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 15 && v <= 240 ? v : 60),
  tableId: (v: unknown): string | undefined => (typeof v === "string" ? v : undefined),
  area: (v: unknown): string | undefined => (typeof v === "string" ? v : undefined),
  notes: (v: unknown): string | undefined => (typeof v === "string" ? v.trim() : undefined),
};

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
        "Reservation persistence is not configured on this deployment",
        503,
      );
    }

    let liveActor: Actor | null = null;
    if (runtime.scope === "PRODUCTION") {
      const { requireRevalidatedLiveContext } = await import("@/server/auth/revalidate");
      liveActor = (await requireRevalidatedLiveContext(ctx.session)).actor;
    }
    const authCtx: AuthContext = liveActor ? { session: ctx.session, actor: liveActor } : ctx;

    authorize(authCtx, "pos:order_create", runtime.audit);

    const rl = rateLimit({ key: `reservations:${authCtx.actor.userId}:${clientIp(req)}`, ...RATE_LIMITS.mutation });
    if (!rl.allowed) {
      return jsonFail(ERROR_CODES.RATE_LIMITED, "Too many requests", 429);
    }

    const body = (await req.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, "Invalid request body", 400);
    }

    const bodyRecord = body as Record<string, unknown>;
    const customerName = createReservationSchema.customerName(bodyRecord["customerName"]);
    const customerEmail = createReservationSchema.customerEmail(bodyRecord["customerEmail"]);
    const customerPhone = createReservationSchema.customerPhone(bodyRecord["customerPhone"]);
    const partySize = createReservationSchema.partySize(bodyRecord["partySize"]);
    const reservationAt = createReservationSchema.reservationAt(bodyRecord["reservationAt"]);

    if (!customerName || !customerEmail || !customerPhone || partySize === null || !reservationAt) {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, "Missing or invalid required fields", 400);
    }

    const outletId = authCtx.actor.outletIds[0];
    if (!outletId) {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, "No outlet assigned to this session", 400);
    }

    idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, "Idempotency-Key header is required", 400);
    }

    const scope = "customer.reservations.create";

    const payload = {
      outletId,
      customerName,
      customerEmail,
      customerPhone,
      partySize,
      reservationAt,
      durationMinutes: createReservationSchema.durationMinutes(bodyRecord["durationMinutes"]),
      tableId: createReservationSchema.tableId(bodyRecord["tableId"]),
      area: createReservationSchema.area(bodyRecord["area"]),
      notes: createReservationSchema.notes(bodyRecord["notes"]),
    };

    const hash = await requestHash(payload);
    const begin = await runtime.idempotency.begin({
      organizationId: authCtx.actor.tenantId,
      scope,
      key: idempotencyKey,
      requestHash: hash,
    });
    if (begin.status === "replay") {
      return jsonOk(begin.response, 200);
    }
    assertStarted(begin);

    try {
      const service = new ReservationService({
        reservations: runtime.reservations as ReservationPort,
        audit: runtime.audit,
        clock: () => new Date(),
      });

      const reservation = await service.createReservation({
        tenantId: authCtx.actor.tenantId,
        outletId,
        actorId: authCtx.actor.userId,
        customerName,
        customerEmail,
        customerPhone,
        partySize,
        reservationAt,
        durationMinutes: payload.durationMinutes,
        tableId: payload.tableId,
        area: payload.area,
        notes: payload.notes,
        idempotencyKey,
      });

      const response = {
        id: reservation.id,
        status: reservation.status,
        reservationAt: reservation.reservationAt,
        partySize: reservation.partySize,
        tableId: reservation.tableId,
        customerName: reservation.customerName,
      };

      await runtime.idempotency.complete({
        organizationId: authCtx.actor.tenantId,
        scope,
        key: idempotencyKey,
        response,
      });

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
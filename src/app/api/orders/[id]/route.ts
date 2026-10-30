/**
 * Read one order by id (GET /api/orders/[id]).
 *
 * Ownership is enforced server-side: `authorizeRecord` requires the actor's
 * tenant to match `order.tenantId` and the actor's outlet to include `order.outletId`.
 * A demo actor can only read demo orders; a live actor only production ones. The
 * adapter resolves the record, so tenant scoping is authoritative.
 */
import { jsonError, jsonFail, jsonOk } from "@/server/http";
import { requireAuth, authorizeRecord, assertSameOrigin, type AuthContext } from "@/server/authz";
import { runtimeFor } from "@/server/runtime";
import { ERROR_CODES } from "@/domain/shared/errors";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireAuth(req);
    assertSameOrigin(req);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, "Missing order id", 400);
    }

    const runtime = runtimeFor(ctx.session);
    if (!runtime) {
      return jsonFail(
        ERROR_CODES.PERSISTENCE_NOT_CONFIGURED,
        "Order read is not configured on this deployment",
        503,
      );
    }

    // B3: revalidate LIVE sessions against current trusted data before serving
    // a production record; the revalidated actor drives tenant/outlet checks.
    // Demo sessions keep using the verified session actor (in-memory sandbox).
    let authCtx: AuthContext = ctx;
    if (runtime.scope === "PRODUCTION") {
      const { requireRevalidatedLiveContext } = await import("@/server/auth/revalidate");
      const { actor } = await requireRevalidatedLiveContext(ctx.session);
      authCtx = { session: ctx.session, actor };
    }


    const order = await runtime.orders.findById(id, { organizationId: authCtx.actor.tenantId });
    if (!order) {
      return jsonFail(ERROR_CODES.NOT_FOUND, "Order not found", 404);
    }

    authorizeRecord(authCtx, { tenantId: order.tenantId, outletId: order.outletId }, runtime.audit);

    return jsonOk(order, 200);
  } catch (error) {
    return jsonError(error);
  }
}

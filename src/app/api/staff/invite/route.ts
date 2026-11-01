/**
 * Staff invitation (Phase 4) — requires a REVALIDATED live OWNER session.
 *
 * A demo/localStorage session can never invite staff (rejected before any
 * Supabase/Prisma call). The acting owner is revalidated against current
 * trusted data; the invited role + outlets are scoped to the owner's own
 * organization. Developer cannot be invited here (platform role is separate).
 *
 * NOT executed against any real Supabase project or database here.
 */
import { jsonOk, jsonFail, jsonError } from "@/server/http";
import type { NextResponse } from "next/server";
import { requireAuth, assertSameOrigin } from "@/server/authz";
import { rateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { getPrisma } from "@/server/db/client";
import { createAdminClient } from "@/server/supabase/admin";
import { requireRevalidatedLiveContext } from "@/server/auth/revalidate";
import { inviteStaff, type ProvisioningAdmin, type ProvisioningDb } from "@/server/auth/provisioning";
import { serverAudit } from "@/server/audit";
import { AUDIT_ACTIONS } from "@/domain/audit/events";
import { createId } from "@/domain/shared/ids";
import { ERROR_CODES } from "@/domain/shared/errors";

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "local";
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(req);
    const rl = rateLimit({ key: `staff-invite:${clientIp(req)}`, ...RATE_LIMITS.mutation });
    if (!rl.allowed) return jsonFail(ERROR_CODES.RATE_LIMITED, "Too many requests", 429);

    const ctx = await requireAuth(req);
    // Staff administration is a LIVE, privileged operation — never demo.
    if (ctx.session.mode !== "live") {
      return jsonFail(ERROR_CODES.FORBIDDEN, "Staff administration requires an authenticated session", 403);
    }

    const db = getPrisma();
    if (!db) return jsonFail(ERROR_CODES.PERSISTENCE_NOT_CONFIGURED, "Persistence is not configured", 503);

    // Revalidate the acting owner against current trusted data.
    const { actor } = await requireRevalidatedLiveContext(ctx.session);
    if (actor.role !== "owner") {
      return jsonFail(ERROR_CODES.FORBIDDEN, "Only an owner can invite staff", 403);
    }
    const admin = createAdminClient();

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return jsonFail(ERROR_CODES.VALIDATION_FAILED, "Request body is required", 400);

    const result = await inviteStaff({
      db: db as unknown as ProvisioningDb,
      admin: admin as unknown as ProvisioningAdmin,
      actor: { userId: actor.userId, organizationId: actor.tenantId },
      input: {
        email: String(body.email ?? ""),
        role: String(body.role ?? "") as "OWNER" | "POS" | "KDS" | "FINANCE",
        outletIds: Array.isArray(body.outletIds) ? (body.outletIds.filter((x): x is string => typeof x === "string")) : [],
        ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
      },
    });

    await serverAudit.record({
      id: createId("aud"),
      action: AUDIT_ACTIONS.STAFF_INVITED,
      actorId: actor.userId,
      actorRole: actor.role,
      entityType: "user",
      entityId: result.userId,
      tenantId: result.organizationId,
      occurredAt: new Date().toISOString(),
      metadata: { invitedRole: result.role, created: result.created },
    });

    return jsonOk(
      { userId: result.userId, role: result.role, outletIds: result.outletIds, created: result.created },
      result.created ? 201 : 200,
    );
  } catch (error) {
    return jsonError(error);
  }
}

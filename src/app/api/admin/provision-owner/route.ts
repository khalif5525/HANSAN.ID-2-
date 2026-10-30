/**
 * First-Owner bootstrap (Phase 4) — server-only, Bearer-gated.
 *
 * Reachable WITHOUT a session (there is no owner yet); it self-authenticates
 * with `HANSAN_PROVISION_SECRET` (constant-time, fail-closed) and is origin-
 * checked + rate-limited. Creates the Supabase identity + Organization + first
 * Outlet + User + OWNER membership. No public path can self-assign Owner.
 *
 * NOT executed against any real Supabase project or database here — the admin
 * client + Prisma are injected/mocked in tests. Real execution is a gated
 * manual step (release blocker).
 */
import { jsonOk, jsonFail, jsonError } from "@/server/http";
import type { NextResponse } from "next/server";
import { assertSameOrigin } from "@/server/authz";
import { rateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { getPrisma } from "@/server/db/client";
import { createAdminClient } from "@/server/supabase/admin";
import { getProvisioningSecrets } from "@/server/config/secrets";
import { assertProvisionSecret } from "@/server/auth/admin-guard";
import { provisionOwner, type ProvisioningAdmin, type ProvisioningDb } from "@/server/auth/provisioning";
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
    const rl = rateLimit({ key: `provision-owner:${clientIp(req)}`, ...RATE_LIMITS.login });
    if (!rl.allowed) return jsonFail(ERROR_CODES.RATE_LIMITED, "Too many attempts", 429);

    const { ownerBootstrap } = getProvisioningSecrets();
    assertProvisionSecret(req, ownerBootstrap);

    const db = getPrisma();
    if (!db) return jsonFail(ERROR_CODES.PERSISTENCE_NOT_CONFIGURED, "Persistence is not configured", 503);
    const admin = createAdminClient();

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return jsonFail(ERROR_CODES.VALIDATION_FAILED, "Request body is required", 400);

    const result = await provisionOwner({
      db: db as unknown as ProvisioningDb,
      admin: admin as unknown as ProvisioningAdmin,
      input: {
        email: String(body.email ?? ""),
        password: String(body.password ?? ""),
        organizationName: String(body.organizationName ?? ""),
        organizationSlug: String(body.organizationSlug ?? ""),
        outletName: String(body.outletName ?? ""),
        ...(typeof body.ownerDisplayName === "string" ? { ownerDisplayName: body.ownerDisplayName } : {}),
      },
    });

    await serverAudit.record({
      id: createId("aud"),
      action: AUDIT_ACTIONS.PROVISION_OWNER,
      actorId: "system",
      actorRole: "system",
      entityType: "user",
      entityId: result.userId,
      tenantId: result.organizationId || undefined,
      occurredAt: new Date().toISOString(),
      metadata: { created: result.created },
    });

    // Generic, non-sensitive success. Never echo secrets or tokens.
    return jsonOk(
      { userId: result.userId, organizationId: result.organizationId, role: result.role, created: result.created },
      result.created ? 201 : 200,
    );
  } catch (error) {
    return jsonError(error);
  }
}

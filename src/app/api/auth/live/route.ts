/**
 * Live sign-in (Phase B2) — exchanges a VERIFIED Supabase Auth identity for a
 * HANSAN `mode:"live"` session, but ONLY when that identity maps to an active
 * HANSAN user with a valid active membership.
 *
 * The endpoint NEVER trusts the request body: tenantId / role / outletIds are
 * derived server-side from the database (src/server/auth/live-session.ts). The
 * identity is validated with the trusted Supabase server client (`getUser()`),
 * which reads the Supabase auth cookies set by the browser client — this
 * endpoint cannot be used to mint a session for an arbitrary user id.
 *
 * Demo sign-in (/api/auth/sign-in) is untouched and stays isolated; this is a
 * separate, membership-gated live path. No provisioning, no default privileges.
 */
import { jsonOk, jsonFail, jsonError } from "@/server/http";
import type { NextResponse } from "next/server";
import { assertSameOrigin } from "@/server/authz";
import { rateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { getPrisma } from "@/server/db/client";
import {
  getSessionSecret,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/server/session";
import { establishLiveSession, type LiveSessionDb } from "@/server/auth/live-session";
import { createClient } from "@/server/supabase/server";
import { getConfig } from "@/config/environment";
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
    // CSRF second layer (Supabase auth cookie is SameSite=Lax).
    assertSameOrigin(req);

    const rl = rateLimit({ key: `live-login:${clientIp(req)}`, ...RATE_LIMITS.login });
    if (!rl.allowed) {
      return jsonFail(ERROR_CODES.RATE_LIMITED, "Too many sign-in attempts", 429);
    }

    const db = getPrisma();
    if (!db) {
      return jsonFail(
        ERROR_CODES.PERSISTENCE_NOT_CONFIGURED,
        "Live sign-in is not configured on this deployment",
        503,
      );
    }

    const { secret } = getSessionSecret();
    if (!secret) {
      return jsonFail(
        ERROR_CODES.AUTH_NOT_CONFIGURED,
        "Authentication is not configured on this deployment",
        503,
      );
    }

    const supabase = createClient();

    const { payload, token } = await establishLiveSession({
      db: db as unknown as LiveSessionDb,
      getUser: async () => {
        const { data, error } = await supabase.auth.getUser();
        if (error || !data?.user) return null;
        return { id: data.user.id, email: data.user.email ?? null };
      },
      secret,
    });

    await serverAudit.record({
      id: createId("aud"),
      action: AUDIT_ACTIONS.SIGN_IN,
      actorId: payload.sub,
      actorRole: payload.role,
      entityType: "session",
      entityId: payload.sub,
      tenantId: payload.tenantId,
      occurredAt: new Date().toISOString(),
      metadata: { mode: "live", provider: "supabase" },
    });

    const res = jsonOk({
      role: payload.role,
      mode: payload.mode,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    });
    // Reuse the exact secure cookie settings + expiry as the demo path.
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: getConfig().nodeEnv === "production",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch (error) {
    // Generic, non-sensitive errors only (jsonError never leaks internals).
    return jsonError(error);
  }
}

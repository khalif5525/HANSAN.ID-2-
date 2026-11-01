/**
 * Demo sign-in (Phase 3) — issues an INTERIM signed sandbox session cookie.
 *
 * This is NOT production authentication (BLOCKER-001 / Supabase Auth still
 * open). Guarantees:
 *   * Sessions are mode:"demo", dataScope:"DEMO", tenant pinned to the demo
 *     sandbox — they can never satisfy a production-scope check.
 *   * Credentials are the published development identities (src/lib/
 *     dev-session.ts); rate-limited + origin-checked + audited.
 *   * In production without SESSION_SECRET this endpoint fails closed
 *     (503 AUTH_NOT_CONFIGURED) — never a silent bypass.
 *   * Owner demo access remains available (explicit product requirement).
 */
import { verifyDevCredentials } from "@/lib/dev-session";
import { DEV_ACCOUNTS } from "@/types/roles";
import { jsonFail, jsonOk, jsonError } from "@/server/http";
import { rateLimit, RATE_LIMITS } from "@/server/rate-limit";
import { assertSameOrigin } from "@/server/authz";
import { serverAudit } from "@/server/audit";
import { AUDIT_ACTIONS, type AuditEvent } from "@/domain/audit/events";
import { createId } from "@/domain/shared/ids";
import { ERROR_CODES } from "@/domain/shared/errors";
import { getConfig } from "@/config/environment";
import {
  createDemoSession,
  getSessionSecret,
  signSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/server/session";

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "local";
}

async function audit(
  action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
  actorId: string,
  actorRole: AuditEvent["actorRole"],
  entityId: string,
  metadata?: Record<string, string | number | boolean>,
): Promise<void> {
  await serverAudit.record({
    id: createId("aud"),
    action,
    actorId,
    actorRole,
    entityType: "session",
    entityId,
    occurredAt: new Date().toISOString(),
    ...(metadata ? { metadata } : {}),
  });
}

export async function POST(req: Request): Promise<Response> {
  try {
    assertSameOrigin(req);

    const { secret, source } = getSessionSecret();
    if (!secret) {
      return jsonFail(
        ERROR_CODES.AUTH_NOT_CONFIGURED,
        "Authentication is not configured on this deployment (SESSION_SECRET missing)",
        503,
      );
    }

    const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
    if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
      return jsonFail(ERROR_CODES.VALIDATION_FAILED, "email and password are required", 400);
    }

    const ip = clientIp(req);
    const rl = rateLimit({
      key: `login:${ip}:${body.email.trim().toLowerCase()}`,
      ...RATE_LIMITS.login,
    });
    if (!rl.allowed) {
      return jsonFail(ERROR_CODES.RATE_LIMITED, "Too many sign-in attempts", 429);
    }

    const role = verifyDevCredentials(body.email, body.password);
    if (!role) {
      await audit(AUDIT_ACTIONS.SIGN_IN_FAILED, "anonymous", "system", body.email.trim().toLowerCase(), {
        ip,
      });
      return jsonFail(ERROR_CODES.UNAUTHENTICATED, "Unknown development account", 401);
    }

    const session = createDemoSession({
      userId: `usr_demo_${role}`,
      role,
      email: DEV_ACCOUNTS[role].email,
    });
    const token = await signSession(session, secret);
    if (!token) {
      return jsonFail(ERROR_CODES.AUTH_NOT_CONFIGURED, "Session signing unavailable", 503);
    }

    await audit(AUDIT_ACTIONS.SIGN_IN, session.sub, session.role, session.sub, {
      mode: "demo",
      secretSource: source,
    });

    const res = jsonOk({ role: session.role, mode: session.mode, expiresAt: new Date(session.exp * 1000).toISOString() });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: getConfig().nodeEnv === "production",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch (error) {
    return jsonError(error);
  }
}

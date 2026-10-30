/**
 * Sign-out (Phase 3) — clears the demo session cookie and audits the event.
 * The browser localStorage mirror is cleared by the client on success.
 */
import { jsonOk, jsonError } from "@/server/http";
import type { NextResponse } from "next/server";
import { serverAudit } from "@/server/audit";
import { AUDIT_ACTIONS } from "@/domain/audit/events";
import { createId } from "@/domain/shared/ids";
import { getConfig } from "@/config/environment";
import { readSessionFromRequest, assertSameOrigin } from "@/server/authz";
import { SESSION_COOKIE } from "@/server/session";

export async function POST(req: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(req);
    const session = await readSessionFromRequest(req);
    if (session) {
      await serverAudit.record({
        id: createId("aud"),
        action: AUDIT_ACTIONS.SIGN_OUT,
        actorId: session.sub,
        actorRole: session.role,
        entityType: "session",
        entityId: session.sub,
        occurredAt: new Date().toISOString(),
        metadata: { mode: session.mode },
      });
    }
    const res = jsonOk({ signedOut: true });
    res.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: getConfig().nodeEnv === "production",
      path: "/",
      maxAge: 0,
    });

    // B3: also revoke the Supabase session so a live HANSAN cookie cannot
    // outlive logout — subsequent auth.getUser() calls fail, and live API
    // revalidation rejects the stale cookie. Loaded lazily; a demo (no Supabase)
    // session is a harmless no-op. The HANSAN cookie is cleared regardless, so
    // sign-out always succeeds even if Supabase is unreachable.
    try {
      const { createClient } = await import("@/server/supabase/server");
      await createClient().auth.signOut();
    } catch {
      /* no Supabase session (demo) or already signed out */
    }
    return res;
  } catch (error) {
    return jsonError(error);
  }
}

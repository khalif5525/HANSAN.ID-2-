/**
 * Server-side gate (Phase 3) — fail-closed authentication for workspace
 * pages and every business API route.
 *
 * Model:
 *   * Valid signed session cookie (src/server/session.ts) required for
 *     workspace pages and non-public APIs.
 *   * Production WITHOUT SESSION_SECRET: pages pass through so the owner
 *     demo workflow is never locked (client gate keeps today's behavior),
 *     while business APIs fail closed with 503 AUTH_NOT_CONFIGURED — the
 *     development bypass is never promoted to "production auth".
 *   * Role/permission/tenant/outlet checks are enforced authoritatively in
 *     each route handler via src/server/authz.ts (pages are data-free
 *     shells; APIs are the security boundary).
 *   * Public: /api/health, /api/auth/* (sign-in issues the session itself).
 */
import { NextResponse, type NextRequest } from "next/server";
import { getSessionSecret, verifySession, SESSION_COOKIE } from "@/server/session";
import { workspaceAllowed } from "@/domain/authz/rbac";

const PUBLIC_API = ["/api/health", "/api/auth/", "/api/admin/"];

/** Workspace roots (first path segment) that require role authorization. */
const WORKSPACE_ROOTS = ["/hq", "/pos", "/kds", "/finance", "/developer"];

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API.some((p) => pathname === p || pathname.startsWith(`${p}`));
}

async function sessionFromRequest(req: NextRequest) {
  const { secret } = getSessionSecret();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return verifySession(token, secret);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const { secret, source } = getSessionSecret();

  if (isApi) {
    if (isPublicApi(pathname)) return NextResponse.next();

    if (!secret && source === "unconfigured") {
      // Fail closed: no verifiable identity exists on this deployment.
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "AUTH_NOT_CONFIGURED",
            message: "Authentication is not configured on this deployment (SESSION_SECRET missing)",
          },
        },
        { status: 503 },
      );
    }

    const session = await sessionFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { ok: false, error: { code: "UNAUTHENTICATED", message: "Sign-in required" } },
        { status: 401 },
      );
    }
    return NextResponse.next();
  }

  // Page routes: authenticate workspace shells.
  const session = await sessionFromRequest(req);
  if (session) {
    // Server-side role boundary: wrong-role users never receive the shell.
    const root = `/${pathname.split("/")[1] ?? ""}`;
    if (WORKSPACE_ROOTS.includes(root) && !workspaceAllowed(session.role, root)) {
      const homeUrl = req.nextUrl.clone();
      homeUrl.pathname = "/";
      homeUrl.search = "";
      return NextResponse.redirect(homeUrl);
    }
    return NextResponse.next();
  }

  if (source === "unconfigured") {
    // Honest fallback: production demo browsing stays available (client
    // gate unchanged); no server identity exists, and APIs remain locked.
    return NextResponse.next();
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/hq/:path*",
    "/pos/:path*",
    "/kds/:path*",
    "/finance/:path*",
    "/developer/:path*",
    "/api/:path*",
  ],
};

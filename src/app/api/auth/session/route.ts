/**
 * Session probe (Phase 3) — returns the verified server session (or null).
 * Used by clients to check whether the server recognizes their identity;
 * never echoes the token itself.
 */
import { jsonOk, jsonError } from "@/server/http";
import { readSessionFromRequest } from "@/server/authz";
import { getSessionSecret } from "@/server/session";

export async function GET(req: Request): Promise<Response> {
  try {
    const { source } = getSessionSecret();
    const session = await readSessionFromRequest(req);
    return jsonOk({
      authenticated: session !== null,
      mode: session?.mode ?? null,
      role: session?.role ?? null,
      tenantId: session?.tenantId ?? null,
      dataScope: session?.dataScope ?? null,
      secretSource: source,
    });
  } catch (error) {
    return jsonError(error);
  }
}

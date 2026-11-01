/**
 * Provisioning guard (Phase 4) — server-only.
 *
 * Fails closed unless a request carries the exact provisioning secret as a
 * Bearer token. Constant-time comparison; a missing/unconfigured secret means
 * the path is disabled (503), never a silent bypass.
 */
import "server-only";
import { AppError, ERROR_CODES } from "@/domain/shared/errors";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readBearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/** Throws unless the request authenticates with the exact expected secret. */
export function assertProvisionSecret(req: Request, expected: string | null): void {
  if (!expected) {
    throw new AppError(ERROR_CODES.AUTH_NOT_CONFIGURED, {
      message: "Provisioning is not configured on this deployment",
    });
  }
  const token = readBearer(req);
  if (!token || !constantTimeEqual(token, expected)) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, { message: "Invalid provisioning credentials" });
  }
}

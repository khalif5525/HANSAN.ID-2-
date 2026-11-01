/**
 * Signed session tokens (Phase 3 — Production Readiness Autopilot).
 *
 * INTERIM demo/sandbox sessions — NOT production authentication:
 *   * HMAC-SHA256 over a base64url payload via Web Crypto (runs in both the
 *     Node route handlers and the Edge middleware runtime).
 *   * Cookie: httpOnly + sameSite=lax + secure(in production) + path=/.
 *   * Every session is explicitly marked mode:"demo", dataScope:"DEMO" and
 *     pinned to the demo sandbox tenant — a demo session can NEVER satisfy a
 *     production-scope check (see assertProductionAccess in src/server/authz.ts).
 *   * Real provider sessions (Supabase Auth, BLOCKER-001) will issue
 *     mode:"live" tokens through the same verification path later.
 *
 * Secret policy (never invent credentials):
 *   * SESSION_SECRET env (>= 32 chars) is used when present.
 *   * Development/test may fall back to a published non-secret dev key.
 *   * Production WITHOUT a valid SESSION_SECRET -> secret = null and every
 *     business API fails closed (503 AUTH_NOT_CONFIGURED). Page browsing
 *     keeps its current client-gated behavior so demo access is never locked.
 */
import { getConfig } from "@/config/environment";
import type { DevRole } from "@/types/roles";

export const SESSION_COOKIE = "hansan_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h — demo sessions expire

/** Published, NON-secret development fallback key (never valid in production). */
const DEV_FALLBACK_SECRET = "hansan-dev-only-session-key-not-for-production-use";

/** Demo sandbox tenancy — demo records live ONLY under this scope. */
export const DEMO_TENANT_ID = "ten_demo_sandbox";
export const DEMO_OUTLET_ID = "out_demo_sandbox";

export interface SessionPayload {
  v: 1;
  /** "demo" = sandbox (this implementation); "live" = provider auth (future). */
  mode: "demo" | "live";
  sub: string; // user id
  role: DevRole;
  email: string;
  tenantId: string;
  outletIds: string[];
  dataScope: "DEMO" | "PRODUCTION";
  iat: number; // issued at, epoch seconds
  exp: number; // expires at, epoch seconds
}

export interface SessionSecret {
  secret: string | null;
  source: "env" | "development-fallback" | "unconfigured";
}

/** Resolve the signing secret. Never logs or returns the secret value. */
export function getSessionSecret(): SessionSecret {
  const cfg = getConfig();
  const env = cfg.sessionSecret;
  if (env && env.length >= 32) return { secret: env, source: "env" };
  if (cfg.nodeEnv !== "production") return { secret: DEV_FALLBACK_SECRET, source: "development-fallback" };
  return { secret: null, source: "unconfigured" };
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signData(secret: string, data: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Build a demo session payload (the only kind issuable by this build). */
export function createDemoSession(params: {
  userId: string;
  role: DevRole;
  email: string;
  now?: Date;
}): SessionPayload {
  const now = params.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  return {
    v: 1,
    mode: "demo",
    sub: params.userId,
    role: params.role,
    email: params.email,
    tenantId: DEMO_TENANT_ID,
    outletIds: [DEMO_OUTLET_ID],
    dataScope: "DEMO",
    iat,
    exp: iat + SESSION_TTL_SECONDS,
  };
}

/**
 * Build a LIVE (production) session payload from VERIFIED database facts.
 *
 * Unlike createDemoSession, nothing here is pinned or invented: tenantId, role
 * and outletIds MUST be resolved server-side from the authenticated identity's
 * active HANSAN memberships (see src/server/auth/live-session.ts). A live
 * session carries dataScope "PRODUCTION" and is signed by the same HMAC path —
 * it can never be produced by the demo sign-in path.
 */
export function createLiveSession(params: {
  userId: string;
  role: DevRole;
  email: string;
  tenantId: string;
  outletIds: string[];
  now?: Date;
}): SessionPayload {
  const now = params.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  return {
    v: 1,
    mode: "live",
    sub: params.userId,
    role: params.role,
    email: params.email,
    tenantId: params.tenantId,
    outletIds: params.outletIds,
    dataScope: "PRODUCTION",
    iat,
    exp: iat + SESSION_TTL_SECONDS,
  };
}

/** Sign a payload into `v1.<payload>.<sig>`. Returns null when unconfigured. */
export async function signSession(payload: SessionPayload, secret: string | null): Promise<string | null> {
  if (!secret) return null;
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await signData(secret, `v1.${body}`);
  return `v1.${body}.${sig}`;
}

/**
 * Verify a token. Returns the payload ONLY when signature matches, version
 * matches, and exp is in the future — everything else fails closed (null).
 */
export async function verifySession(token: string | undefined | null, secret: string | null): Promise<SessionPayload | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const expected = await signData(secret, `${parts[0]}.${parts[1]}`);
  if (!constantTimeEqual(expected, parts[2])) return null;
  try {
    const json = new TextDecoder().decode(b64urlDecode(parts[1]));
    const payload = JSON.parse(json) as SessionPayload;
    if (payload.v !== 1) return null;
    if (payload.mode !== "demo" && payload.mode !== "live") return null;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (!payload.sub || !payload.role || !payload.tenantId) return null;
    if (payload.dataScope !== "DEMO" && payload.dataScope !== "PRODUCTION") return null;
    return payload;
  } catch {
    return null;
  }
}

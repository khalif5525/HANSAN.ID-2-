/**
 * Development-only role session (§5, Phase 7).
 * LOCAL-ONLY role simulation: localStorage in the browser, no backend,
 * no API, no database, no real authentication. These credentials are
 * presentation identities that will be replaced by real auth after
 * UI/UX freeze without changing frontend contracts.
 *
 * SECURITY: the passwords below are intentionally non-secret dev
 * strings shipped in client code. NEVER reuse this pattern post-freeze.
 */
import { DEV_ACCOUNTS, DEV_ROLES, type DevRole } from "@/types/roles";

/** Dev-only password map — development environment ONLY (never production). */
const DEV_PASSWORDS: Record<DevRole, string> = {
  developer: "dev-hansan",
  owner: "owner-hansan",
  pos: "pos-hansan",
  kds: "kds-hansan",
  finance: "finance-hansan",
};

/** Demo shortcut credentials (already shipped in this client bundle by design). */
export function devCredentialsFor(role: DevRole): { email: string; password: string } {
  return { email: DEV_ACCOUNTS[role].email, password: DEV_PASSWORDS[role] };
}

const SESSION_KEY = "hansan.dev.session.v1";

export interface DevSession {
  role: DevRole;
  email: string;
  /** ISO timestamp of development sign-in (display only). */
  signedInAt: string;
}

/** Validate dev credentials. Returns matched role or null. */
export function verifyDevCredentials(email: string, password: string): DevRole | null {
  const normalized = email.trim().toLowerCase();
  for (const role of DEV_ROLES) {
    const account = DEV_ACCOUNTS[role];
    if (account.email === normalized && DEV_PASSWORDS[role] === password) {
      return role;
    }
  }
  return null;
}

/** Read the current dev session (browser only; null during SSR). */
export function readDevSession(): DevSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DevSession;
    if (!parsed || !DEV_ROLES.includes(parsed.role)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist dev session locally (browser only). */
export function writeDevSession(role: DevRole): DevSession {
  const session: DevSession = {
    role,
    email: DEV_ACCOUNTS[role].email,
    signedInAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      /* storage unavailable — session stays in-memory for this tab */
    }
  }
  return session;
}

/** Clear the dev session (sign out). */
export function clearDevSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

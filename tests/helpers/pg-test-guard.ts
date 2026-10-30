/**
 * OA21 — Opt-in PostgreSQL test guard (fail-closed, connection-free).
 *
 * Safety model:
 *   * A live PG test may run ONLY when BOTH `HANSAN_PG_TEST_URL` and
 *     `HANSAN_PG_TEST_ALLOW` are explicitly set in the operator's shell.
 *   * The guard NEVER falls back to `DATABASE_URL`, `DIRECT_URL`, or any
 *     other application database variable — those are production/staging
 *     credentials and must never feed a destructive integration test.
 *   * The guard NEVER connects, migrates, seeds, resets, truncates, or
 *     drops anything. It only validates intent + target identity from the
 *     URL's non-secret shape (scheme/host/port/db name) and returns a
 *     decision. The URL value itself is NEVER printed, logged, or copied.
 *   * Target allowlist is deliberately narrow: loopback hosts only
 *     (`localhost`, `127.0.0.1`, `::1`), default PG port or 5432, plus the
 *     approved disposable sandbox host port 5433 (loopback only) and the
 *     approved PgBouncer pooler sandbox host port 5434 (loopback only), and
 *     a database name that starts with `hansan_test_` (disposable naming
 *     convention). Anything else fails closed. Ports 5433 and 5434 are
 *     accepted ONLY after the loopback check passes, so they can never widen
 *     remote targets.
 *   * Hostname checks alone are NOT proof of safety — the operator must
 *     still affirm disposability via `HANSAN_PG_TEST_ALLOW=DISPOSABLE-LOCAL-PG`.
 *     The exact sentinel value prevents "any truthy string enables it".
 *
 * This module imports nothing database-related so that merely importing it
 * in an ordinary `vitest run` cannot open a connection.
 */

export const PG_TEST_URL_VAR = "HANSAN_PG_TEST_URL";
export const PG_TEST_ALLOW_VAR = "HANSAN_PG_TEST_ALLOW";

/** Exact opt-in sentinel — no other value enables live PG tests. */
export const PG_TEST_ALLOW_SENTINEL = "DISPOSABLE-LOCAL-PG";

/** Forbidden host fragments: obvious remote/production/staging targets. */
const FORBIDDEN_HOST_FRAGMENTS = [
  "supabase.co",
  "pooler.supabase",
  "amazonaws.com",
  "neon.tech",
  "railway.app",
  "render.com",
  "planetscale",
  "prod",
  "staging",
  "live",
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Allowed loopback ports: default (empty = 5432), explicit 5432, the
 * approved disposable sandbox host port 5433, and the approved PgBouncer
 * pooler sandbox host port 5434 (OA41). Checked ONLY after the
 * loopback-host gate above, so remote hosts can never use 5433/5434 to pass.
 */
const ALLOWED_LOOPBACK_PORTS = new Set(["", "5432", "5433", "5434", "5435", "5436"]);

export type PgGuardDecision =
  | { ok: true; reason: string }
  | { ok: false; reason: string };

function fail(reason: string): PgGuardDecision {
  return { ok: false, reason };
}

/**
 * Validate opt-in intent + target identity WITHOUT connecting.
 * Reads env through the provided getter so tests can inject values.
 * NEVER includes the URL or any secret in the returned reason strings.
 */
export function checkPgTestGuard(
  readEnv: (name: string) => string | undefined,
): PgGuardDecision {
  const allow = readEnv(PG_TEST_ALLOW_VAR);
  if (allow === undefined || allow.trim() === "") {
    return fail(
      `fail-closed: ${PG_TEST_ALLOW_VAR} is not set — live PG tests are disabled. ` +
        `Set it to the documented sentinel only for a disposable local database.`,
    );
  }
  if (allow !== PG_TEST_ALLOW_SENTINEL) {
    return fail(
      `fail-closed: ${PG_TEST_ALLOW_VAR} has an unexpected value — live PG tests are disabled.`,
    );
  }

  const url = readEnv(PG_TEST_URL_VAR);
  if (url === undefined || url.trim() === "") {
    return fail(
      `fail-closed: ${PG_TEST_URL_VAR} is not set — live PG tests are disabled.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return fail("fail-closed: test URL is not a valid connection URI.");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return fail("fail-closed: test URL must use the postgresql:// scheme.");
  }
  const rawHost = parsed.hostname.toLowerCase();
  // WHATWG URL keeps IPv6 brackets in hostname ("[::1]"); strip one pair so
  // the loopback allowlist below matches the canonical "::1" form.
  const host =
    rawHost.startsWith("[") && rawHost.endsWith("]") && rawHost.length > 2
      ? rawHost.slice(1, -1)
      : rawHost;
  for (const frag of FORBIDDEN_HOST_FRAGMENTS) {
    if (host.includes(frag)) {
      return fail(
        "fail-closed: test target looks remote or production-like — refused.",
      );
    }
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    return fail(
      "fail-closed: test target must be a loopback host (localhost/127.0.0.1/::1).",
    );
  }
  if (!ALLOWED_LOOPBACK_PORTS.has(parsed.port)) {
    return fail("fail-closed: unexpected test port - expected 5432, sandbox 5433, pooler sandbox 5434, disposable Phase H PG 5435, or disposable Phase H pooler 5436 on loopback.");
  }
  const dbName = parsed.pathname.replace(/^\//, "").split("/")[0] ?? "";
  if (!dbName.startsWith("hansan_test_")) {
    return fail(
      "fail-closed: test database name must start with hansan_test_ (disposable convention).",
    );
  }
  return {
    ok: true,
    reason:
      "opt-in valid: loopback disposable test target affirmed by operator sentinel.",
  };
}

/**
 * Assert the guard passes, throwing a plain Error (no URL content) otherwise.
 * Call this at the top of any live-PG test file before any DB import is used.
 */
export function requirePgTestGuard(
  readEnv: (name: string) => string | undefined = (n) =>
    (process.env as Record<string, string | undefined>)[n],
): void {
  const decision = checkPgTestGuard(readEnv);
  if (!decision.ok) {
    throw new Error(`[pg-guard] ${decision.reason}`);
  }
}

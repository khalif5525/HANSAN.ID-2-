/**
 * OA41 — PG-5 pooled-path probe: Prisma-through-PgBouncer behavior
 * (PB-T1 connectivity, PB-T2 interactive tx / prepared statements,
 * PB-T3 alternating tenant GUCs across pooled reuse, PB-T4 bounded
 * concurrency).
 *
 * CODE-ONLY + CONNECTION-FREE in OA41-A1: AUTHORED and statically validated
 * here, but MUST NOT be executed until separate approvals (A2 Docker
 * resources, A3 live run) supply the disposable PgBouncer endpoint and
 * `HANSAN_PG_TEST_URL` + `HANSAN_PG_TEST_ALLOW=DISPOSABLE-LOCAL-PG`. Do NOT
 * claim pooled-path compatibility or PgBouncer proof from this file's
 * existence. Complements (never rewrites) `tests/pg-live-pg4-guc.test.ts`
 * (direct, OA35) and `tests/pg-live-pg4-pool-direct.test.ts` (direct 50-tx
 * baseline, OA38-R6).
 *
 * Safety model:
 * - `requirePgTestGuard()` runs at module scope BEFORE any `new PrismaClient`
 *   can execute, so importing this file without the exact sentinel throws
 *   `[pg-guard] ...` and never opens a connection.
 * - Uses ONLY `HANSAN_PG_TEST_URL`. Never reads `DATABASE_URL`, `DIRECT_URL`,
 *   `.env`, `.env.local`, or any application database configuration. The URL
 *   is expected to target the approved pooler sandbox port 5434 (loopback) —
 *   the guard enforces host/port/db-name shape.
 * - Bare GUC probes only: no application tables, migrations, seeds, roles,
 *   grants, or RLS. GUC key is the production key from
 *   `src/server/db/tenant-context.ts` (`tenantContextSetLocalSql()`):
 *   `app.organization_id`. Synthetic values only — never persisted rows.
 *   Zero RLS-enforcement weight (superuser role — invariant 21).
 * - Backend PID reuse is DIAGNOSTIC ONLY: recorded and reported, never
 *   asserted. A PID change (or no reuse) cannot fail this test.
 * - Error classification: connection/configuration failures (recognizable
 *   Prisma/socket tokens) are reported as `CLASS=CONFIG` with strict
 *   allowlist-scalar diagnostics only; assertion failures are rethrown
 *   verbatim (content is synthetic values/numbers, never secrets). NO
 *   automatic retry and NO `?pgbouncer=true` variant — flag compatibility
 *   with Prisma 5.22.x is an unresolved decision (OA41 §1.5) requiring
 *   separate owner approval if ever executed.
 * - PB-T0 (pooler version / pool_mode verification) is NOT a client test:
 *   it is performed via `SHOW` commands through the pooler before this
 *   suite is authorized to run.
 * - Disconnects Prisma in `afterAll`. No pooling changes, no external
 *   services, no new dependencies, no schema writes.
 */
import { describe, expect, it, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  PG_TEST_URL_VAR,
  requirePgTestGuard,
} from "./helpers/pg-test-guard";

// GUARD FIRST: throws unless the operator affirmed the disposable sandbox.
// Executes before `buildTestClient()` is ever called, so no connection can
// be attempted without the exact sentinel.
requirePgTestGuard();

/** Production tenant GUC key — see `tenantContextSetLocalSql()`. */
const TENANT_GUC = "app.organization_id";

/** Bounded sequential transaction count (OA41 PB-T3). */
const TX_COUNT = 50;

/** PB-T2: sequential interactive txs exercising prepared-statement reuse. */
const PB_T2_TX_COUNT = 20;

/** PB-T4: light, bounded concurrency (never exceeds modest pooler capacity). */
const PB_T4_CONCURRENCY = 3;

/** Synthetic disposable org ids — GUC values only, never persisted rows. */
const TENANT_A = "oa41_pg5_pooled_tenant_a";
const TENANT_B = "oa41_pg5_pooled_tenant_b";
const T2_PROBE = "oa41_pg5_t2_probe";

/**
 * Build a Prisma client bound ONLY to the guard-approved test URL.
 * Reads `HANSAN_PG_TEST_URL` exclusively — no fallback to `DATABASE_URL`,
 * `DIRECT_URL`, `.env`, or app config. Called lazily inside tests, after the
 * module-scope guard above has already passed.
 */
function buildTestClient(): PrismaClient {
  const url = process.env[PG_TEST_URL_VAR];
  if (!url || url.trim() === "") {
    throw new Error(
      "[pg-live-pg5] test URL is not set — refusing to connect without it.",
    );
  }
  return new PrismaClient({ datasources: { db: { url: url.trim() } } });
}

let client: PrismaClient | null = null;
function db(): PrismaClient {
  if (!client) client = buildTestClient();
  return client;
}

afterAll(async () => {
  if (client) {
    await client.$disconnect();
    client = null;
  }
});

type SettingRow = { value: string | null };
type PidRow = { pid: number };
type IdentityRow = {
  db: string | null;
  userName: string | null;
  serverVersion: string | null;
};

/** STRICT character allowlist: only short ASCII token shapes may be printed
 * (e.g. "PrismaClientInitializationError", "P1001", "ECONNREFUSED").
 * Anything containing URL/path separators, whitespace, quotes, or non-ASCII
 * renders as "n/a" — so no connection detail or message fragment can ever
 * leak into output. */
const safe = (v: unknown): string =>
  typeof v === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(v) ? v : "n/a";

/** Recognizable connection/configuration failure tokens (allowlist-shaped). */
const CONFIG_ERROR_TOKENS = new Set([
  "PrismaClientInitializationError",
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "P1001",
  "P1002",
  "P1008",
  "P1012",
  "P1013",
  "P1017",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "TIMEOUT",
  "SOCKET_CLOSED",
]);

type ErrorShape = {
  name?: unknown;
  code?: unknown;
  errorCode?: unknown;
  cause?: { code?: unknown; name?: unknown };
};

/**
 * Classify and re-report a failure from a phase:
 * - CONFIG class (recognizable Prisma/socket tokens): sanitized
 *   allowlist-scalar diagnostics ONLY, then a sanitized replacement error
 *   (original message never propagated — it may embed connection details).
 * - Anything else (AssertionError, synthetic-value mismatches): rethrown
 *   VERBATIM — its content is test values/numbers only, never secrets.
 * No retries. No URL/host/credential content in any path.
 */
function classifyAndRethrow(
  phase: string,
  iter: number | null,
  error: unknown,
): never {
  const err = (error ?? {}) as ErrorShape;
  const name = safe(err?.name);
  const code = safe(err?.code);
  const errorCode = safe(err?.errorCode);
  const causeCode = safe(err?.cause?.code);
  const causeName = safe(err?.cause?.name);
  const tokens = [name, code, errorCode, causeCode, causeName];
  const isConfig = tokens.some((t) => CONFIG_ERROR_TOKENS.has(t));
  process.stdout.write(
    `[pg-live-pg5] ${phase} ${isConfig ? "CLASS=CONFIG" : "CLASS=ASSERTION_OR_OTHER"} ` +
      `iter=${iter === null ? "n/a" : iter} at=${new Date().toISOString()} ` +
      `name=${name} code=${code} errorCode=${errorCode} ` +
      `cause_code=${causeCode} cause_name=${causeName}\n`,
  );
  if (!isConfig) {
    throw error;
  }
  throw new Error(
    `[pg-live-pg5] ${phase} CLASS=CONFIG name=${name} code=${code} ` +
      `errorCode=${errorCode} cause_code=${causeCode} cause_name=${causeName} ` +
      `(sanitized: no connection details embedded; no retry performed)`,
  );
}

/** Read the GUC outside any transaction; `missing_ok=true` so absent → null. */
async function readGucOutsideTx(): Promise<string | null> {
  const rows = await db().$queryRaw<SettingRow[]>`
    SELECT current_setting(${TENANT_GUC}, true) AS value
  `;
  return rows[0]?.value ?? null;
}

describe("PG-5 pooled probe through PgBouncer (live, guard-gated, NOT to be run in OA41-A1)", () => {
  it("PB-T1: connects through the pooler endpoint and proves disposable server identity", async () => {
    try {
      const rows = await db().$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
      expect(rows[0]?.ok).toBe(1);
      const idRows = await db().$queryRaw<IdentityRow[]>`
        SELECT current_database() AS db,
               current_user AS "userName",
               current_setting('server_version') AS "serverVersion"
      `;
      const id = idRows[0] ?? {};
      const dbName = id.db ?? "";
      process.stdout.write(
        `[pg-live-pg5] pb-t1 db=${safe(dbName)} user=${safe(id.userName)} ` +
          `server_version=${safe(id.serverVersion)}\n`,
      );
      // Server identity: MUST be the disposable hansan_test_* database.
      // This closes the "guard passed on URL shape but pointed at the wrong
      // server" risk (OA41 §2.5). The front-end proxy's identity cannot be
      // proven from inside a client session — PB-T0 (SHOW VERSION /
      // SHOW POOL_MODE through the pooler) covers that before any run.
      expect(dbName.startsWith("hansan_test_")).toBe(true);
      expect(id.serverVersion ?? "").toMatch(/^\d+\.\d+/);
    } catch (error) {
      classifyAndRethrow("pb-t1", null, error);
    }
  }, 60_000);

  it("PB-T2: interactive transactions and prepared-statement reuse behave through the pooler", async () => {
    try {
      for (let i = 0; i < PB_T2_TX_COUNT; i++) {
        // 4 statements per interactive tx (incl. an identical repeated
        // query text) — exercises prepared-statement (re)preparation across
        // pooler server-switches under transaction pooling.
        await db().$transaction(async (tx) => {
          const a = await tx.$queryRaw<{ v: number }[]>`SELECT 1 AS v`;
          expect(a[0]?.v).toBe(1);
          const b = await tx.$queryRaw<{ v: number }[]>`SELECT 2 AS v`;
          expect(b[0]?.v).toBe(2);
          await tx.$executeRaw`SELECT set_config('app.organization_id', ${T2_PROBE}, true)`;
          const c = await tx.$queryRaw<SettingRow[]>`
            SELECT current_setting(${TENANT_GUC}, true) AS value
          `;
          expect(c[0]?.value).toBe(T2_PROBE);
        });
        // The tx is over — its synthetic transaction-local value must not
        // survive outside it (no session-state carryover through the pooler).
        const outside = await readGucOutsideTx();
        expect(outside).not.toBe(T2_PROBE);
      }
    } catch (error) {
      classifyAndRethrow("pb-t2", null, error);
    }
  }, 60_000);

  it("PB-T3: 50 alternating synthetic GUC txs, in-tx visibility, no cross-tx leakage (pooled)", async () => {
    const pids: number[] = [];
    let iter = -1;
    try {
      for (iter = 0; iter < TX_COUNT; iter++) {
        const expected = iter % 2 === 0 ? TENANT_A : TENANT_B;
        await db().$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config(${TENANT_GUC}, ${expected}, true)`;
          const rows = await tx.$queryRaw<SettingRow[]>`
            SELECT current_setting(${TENANT_GUC}, true) AS value
          `;
          expect(rows[0]?.value).toBe(expected);
          const pidRows = await tx.$queryRaw<PidRow[]>`SELECT pg_backend_pid() AS pid`;
          const pid = pidRows[0]?.pid;
          expect(typeof pid).toBe("number");
          pids.push(pid as number);
        });
        // Each tx is over — its synthetic value must not persist outside it.
        const outside = await readGucOutsideTx();
        expect(outside).not.toBe(expected);
        expect(outside === null || (outside !== TENANT_A && outside !== TENANT_B)).toBe(true);
      }
      // Diagnostic only: report backend reuse; never assert it must occur.
      const distinct = new Set(pids).size;
      process.stdout.write(
        `[pg-live-pg5] pb-t3 txs=${pids.length} distinct_backends=${distinct} reuse_observed=${distinct < pids.length}\n`,
      );
      expect(pids).toHaveLength(TX_COUNT);
    } catch (error) {
      classifyAndRethrow("pb-t3", iter, error);
    }
  }, 60_000);

  it("PB-T3-final: final transaction starts clean (neither probe value leaked)", async () => {
    try {
      await db().$transaction(async (tx) => {
        const rows = await tx.$queryRaw<SettingRow[]>`
          SELECT current_setting(${TENANT_GUC}, true) AS value
        `;
        const value = rows[0]?.value ?? null;
        expect(value).not.toBe(TENANT_A);
        expect(value).not.toBe(TENANT_B);
      });
      expect(await readGucOutsideTx()).not.toBe(TENANT_A);
      expect(await readGucOutsideTx()).not.toBe(TENANT_B);
    } catch (error) {
      classifyAndRethrow("pb-t3-final", null, error);
    }
  }, 60_000);

  it("PB-T4: light bounded concurrency completes without unbounded wait", async () => {
    // Bounded by design: a small number of concurrent interactive txs with
    // short holds and a hard 30 s cap. Deliberately EXCEEDING pooler
    // capacity is NOT attempted here — that requires knowledge of the
    // A2-time pool sizing (default_pool_size etc.) and separate approval.
    // PASS = all complete (or fail with classified errors) within the cap;
    // an unbounded hang surfaces as a vitest TIMEOUT (class TIMEOUT).
    const before = Date.now();
    const runOne = async (): Promise<boolean> => {
      return db().$transaction(async (tx) => {
        const pidRows = await tx.$queryRaw<PidRow[]>`SELECT pg_backend_pid() AS pid`;
        expect(typeof pidRows[0]?.pid).toBe("number");
        await new Promise((resolve) => setTimeout(resolve, 250));
        return true;
      });
    };
    try {
      const results = await Promise.all(
        Array.from({ length: PB_T4_CONCURRENCY }, () => runOne()),
      );
      expect(results).toHaveLength(PB_T4_CONCURRENCY);
      process.stdout.write(
        `[pg-live-pg5] pb-t4 concurrent_txs=${PB_T4_CONCURRENCY} elapsed_ms=${Date.now() - before}\n`,
      );
    } catch (error) {
      classifyAndRethrow("pb-t4", null, error);
    }
  }, 30_000);
});
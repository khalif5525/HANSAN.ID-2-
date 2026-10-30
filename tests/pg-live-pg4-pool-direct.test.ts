/**
 * OA38 — PG-4 direct-endpoint reuse probe: transaction-local tenant GUC
 * isolation across 50 sequential interactive transactions.
 *
 * CODE-ONLY + CONNECTION-FREE in OA38: AUTHORED and statically validated
 * here, but MUST NOT be executed until a separate approval supplies
 * `HANSAN_PG_TEST_URL` + `HANSAN_PG_TEST_ALLOW=DISPOSABLE-LOCAL-PG` for the
 * disposable sandbox. Do NOT claim pooled-connection safety or PG-4
 * completeness. Complements (never rewrites) `tests/pg-live-pg4-guc.test.ts`.
 *
 * Safety model:
 * - `requirePgTestGuard()` runs at module scope BEFORE any `new PrismaClient`
 *   can execute, so importing this file without the exact sentinel throws
 *   `[pg-guard] ...` and never opens a connection.
 * - Uses ONLY `HANSAN_PG_TEST_URL`. Never reads `DATABASE_URL`, `DIRECT_URL`,
 *   `.env`, `.env.local`, or any application database configuration.
 * - Bare GUC probes only: no application tables, migrations, seeds, roles,
 *   grants, or RLS. GUC key is the production key from
 *   `src/server/db/tenant-context.ts` (`tenantContextSetLocalSql()`):
 *   `app.organization_id`. No new GUC invented.
 * - Backend PID reuse is DIAGNOSTIC ONLY: recorded and reported, never
 *   asserted. A PID change (or no reuse) cannot fail this test.
 * - Disconnects Prisma in `afterAll`. No pooling changes, no PgBouncer,
 *   no external services, no new dependencies.
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

/** Bounded sequential transaction count (OA38 requirement). */
const TX_COUNT = 50;

/** Two synthetic disposable org ids — GUC values only, never persisted rows. */
const TENANT_A = "oa38_pg4_direct_tenant_a";
const TENANT_B = "oa38_pg4_direct_tenant_b";

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
      "[pg-live-pg4-pool-direct] test URL is not set — refusing to connect without it.",
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

/** Read the GUC outside any transaction; `missing_ok=true` so absent → null. */
async function readGucOutsideTx(): Promise<string | null> {
  const rows = await db().$queryRaw<SettingRow[]>`
    SELECT current_setting(${TENANT_GUC}, true) AS value
  `;
  return rows[0]?.value ?? null;
}

describe("PG-4 direct reuse probe: 50 sequential txs, alternating tenants (live, guard-gated)", () => {
  it("alternates tenant GUCs across 50 sequential txs with no cross-tx leakage", async () => {
    const pids: number[] = [];
    for (let i = 0; i < TX_COUNT; i++) {
      const expected = i % 2 === 0 ? TENANT_A : TENANT_B;
      try {
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
      } catch (error) {
        // OA38-R5 diagnostics: safe scalar fields ONLY. Never log the error
        // object itself, messages, URLs, hosts, credentials, env values, or
        // query parameters — those may embed connection secrets.
        const err = error as {
          name?: unknown;
          code?: unknown;
          errorCode?: unknown;
          cause?: { code?: unknown; name?: unknown };
        };
        // STRICT character allowlist: only short ASCII token shapes may be
        // printed (e.g. "PrismaClientInitializationError", "ECONNREFUSED",
        // "P1001"). Anything containing URL/path separators, whitespace,
        // quotes, or non-ASCII renders as "n/a" — so no connection detail or
        // message fragment can ever leak into output.
        const safe = (v: unknown): string =>
          typeof v === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(v) ? v : "n/a";
        process.stdout.write(
          `[pg-live-pg4-pool-direct] conn_error ` +
            `iter=${i} at=${new Date().toISOString()} ` +
            `name=${safe(err?.name)} code=${safe(err?.code)} ` +
            `errorCode=${safe(err?.errorCode)} cause_code=${safe(err?.cause?.code)} ` +
            `cause_name=${safe(err?.cause?.name)}\n`,
        );
        throw error;
      }
      // Each tx is over — its synthetic value must not persist outside it.
      const outside = await readGucOutsideTx();
      expect(outside).not.toBe(expected);
      expect(outside === null || (outside !== TENANT_A && outside !== TENANT_B)).toBe(true);
    }
    // Diagnostic only: report backend reuse; never assert it must occur.
    const distinct = new Set(pids).size;
    process.stdout.write(
      `[pg-live-pg4-pool-direct] txs=${pids.length} distinct_backends=${distinct} reuse_observed=${distinct < pids.length}\n`,
    );
    expect(pids).toHaveLength(TX_COUNT);
  }, 60_000);

  it("final transaction starts clean (neither probe value leaked)", async () => {
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
  });
});

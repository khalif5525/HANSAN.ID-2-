/**
 * OA35 — PG-4 minimal live test: transaction-local tenant GUC behavior.
 *
 * CODE-ONLY + CONNECTION-FREE in OA35: this file is AUTHORED and statically
 * validated here, but MUST NOT be executed until a separate approval supplies
 * `HANSAN_PG_TEST_URL` + `HANSAN_PG_TEST_ALLOW=DISPOSABLE-LOCAL-PG` for the
 * disposable sandbox. Do NOT claim PG-4 has passed.
 *
 * Safety model:
 * - `requirePgTestGuard()` runs at module scope BEFORE any `new PrismaClient`
 *   can execute, so importing this file without the exact sentinel throws
 *   `[pg-guard] ...` and never opens a connection.
 * - Uses ONLY `HANSAN_PG_TEST_URL`. Never reads `DATABASE_URL`, `DIRECT_URL`,
 *   `.env`, `.env.local`, or any application database configuration.
 * - No application tables, migrations, RLS policies, or seed data required:
 *   probes bare transaction-local GUC semantics only.
 * - GUC key is the production key from `src/server/db/tenant-context.ts`
 *   (`tenantContextSetLocalSql()`): `app.organization_id`. No new GUC invented.
 * - Disconnects Prisma in `afterAll` (finally-safe). No pooling changes,
 *   no PgBouncer, no external services, no new dependencies.
 */
import { describe, expect, it, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  PG_TEST_URL_VAR,
  requirePgTestGuard,
} from "./helpers/pg-test-guard";

// GUARD FIRST: throws unless the operator affirmed the disposable sandbox.
// This executes before `buildTestClient()` is ever called, so no connection
// can be attempted without the exact sentinel.
requirePgTestGuard();

/** Production tenant GUC key — see `tenantContextSetLocalSql()`. */
const TENANT_GUC = "app.organization_id";

/** Synthetic disposable org ids — GUC values only, never persisted rows. */
const COMMIT_VALUE = "oa35_pg4_commit_probe";
const ROLLBACK_VALUE = "oa35_pg4_rollback_probe";

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
      "[pg-live-pg4] test URL is not set — refusing to connect without it.",
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

/** Read the GUC outside any transaction; `missing_ok=true` so absent → null. */
async function readGucOutsideTx(): Promise<string | null> {
  const rows = await db().$queryRaw<SettingRow[]>`
    SELECT current_setting(${TENANT_GUC}, true) AS value
  `;
  return rows[0]?.value ?? null;
}

describe("PG-4 minimal: transaction-local tenant GUC (live, guard-gated)", () => {
  it("A. baseline: no transaction-local tenant value is visible outside a tx", async () => {
    const value = await readGucOutsideTx();
    expect(value === null || value !== COMMIT_VALUE).toBe(true);
    expect(value === null || value !== ROLLBACK_VALUE).toBe(true);
  });

  it("B+C. SET LOCAL is visible in-tx and gone after commit (no leak)", async () => {
    await db().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config(${TENANT_GUC}, ${COMMIT_VALUE}, true)`;
      const rows = await tx.$queryRaw<SettingRow[]>`
        SELECT current_setting(${TENANT_GUC}, true) AS value
      `;
      expect(rows[0]?.value).toBe(COMMIT_VALUE);
    });
    // Committed tx is over — the transaction-local value must not persist.
    expect(await readGucOutsideTx()).not.toBe(COMMIT_VALUE);
  });

  it("D+E. SET LOCAL is visible in-tx and gone after rollback (no leak into later tx)", async () => {
    await expect(
      db().$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config(${TENANT_GUC}, ${ROLLBACK_VALUE}, true)`;
        const rows = await tx.$queryRaw<SettingRow[]>`
          SELECT current_setting(${TENANT_GUC}, true) AS value
        `;
        expect(rows[0]?.value).toBe(ROLLBACK_VALUE);
        throw new Error("oa35-intentional-rollback");
      }),
    ).rejects.toThrow("oa35-intentional-rollback");
    // Rolled-back tx is over — the value must not leak into later work.
    expect(await readGucOutsideTx()).not.toBe(ROLLBACK_VALUE);
    // A later transaction starts clean (no leaked tenant context).
    await db().$transaction(async (tx) => {
      const rows = await tx.$queryRaw<SettingRow[]>`
        SELECT current_setting(${TENANT_GUC}, true) AS value
      `;
      const value = rows[0]?.value ?? null;
      expect(value).not.toBe(ROLLBACK_VALUE);
      expect(value).not.toBe(COMMIT_VALUE);
    });
  });
});

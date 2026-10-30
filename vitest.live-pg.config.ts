import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Live-PostgreSQL integration lane (explicit, authorized only).
 *
 * Runs the `pg-live-*` suites, which call `requirePgTestGuard()` at module
 * scope and fail closed unless `HANSAN_PG_TEST_URL` + the exact
 * `HANSAN_PG_TEST_ALLOW=DISPOSABLE-LOCAL-PG` sentinel are present and point at
 * an approved disposable loopback database. Never run this lane in CI or
 * production; it requires a disposable local PostgreSQL instance.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/pg-live-*.test.ts"],
    environment: "node",
    passWithNoTests: false,
  },
});
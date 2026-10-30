# HANSAN — Test Workflow & Lanes

## Commands

| Command | Purpose | Database required? |
|---|---|---|
| `npm run test` / `npm run test:unit` | Unit/regression suite (default no-database lane) | No |
| `npm run test:live-pg` | Live PostgreSQL integration lane (`pg-live-*`) | Yes — disposable local PG only |
| `npm run test:live-pg:pgbouncer` | Optional PgBouncer pooled-path probe | Yes — disposable local PgBouncer only |
| `npm run test:all` | Default lane + live-PG lane (authorized environments only) | Yes for live portion |
| `npm run typecheck` | TypeScript typecheck | No |
| `npm run lint` | ESLint | No |
| `npm run build` | Production build | No |
| `npm run verify` | typecheck + lint + unit tests + build | No (live-PG excluded) |

## Live-PostgreSQL guard

Live-PG suites are fail-closed. They run only when **both** are set:

- `HANSAN_PG_TEST_URL` — loopback disposable database URL, db name starting `hansan_test_`
- `HANSAN_PG_TEST_ALLOW=DISPOSABLE-LOCAL-PG` — exact sentinel

The guard never reads `DATABASE_URL`/`DIRECT_URL`, never connects, and refuses remote/production-like targets. Do not weaken these checks.

## Reporting unavailable integration coverage

- The default `npm run test` lane intentionally excludes `tests/pg-live-*.test.ts`.
- This is lane separation, not hiding: live-PG tests remain discoverable via `npm run test:live-pg` and `vitest.live-pg.config.ts`.
- When `HANSAN_PG_TEST_ALLOW` is unset, live-PG coverage is **not run** and must be reported as unavailable/pending, not as passed.
- CI runs only the no-database lane; live-PG coverage requires an authorized operator environment.
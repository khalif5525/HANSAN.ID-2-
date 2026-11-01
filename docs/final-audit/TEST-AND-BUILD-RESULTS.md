# HANSAN V2 — Test and Build Results

## Validation commands run

| Command | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | PASS |
| `npm run lint` (`next lint`) | PASS — no warnings or errors |
| `npm run test` (`vitest run`) | PASS — 443 passed, 1 skipped, 41 test files |
| `npm run build` (`next build`) | PASS |
| `npm run db:validate` (`prisma validate`) | PASS |
| `npm run db:migrate:status` (`prisma migrate status`) | BLOCKED — database unreachable |
| `npm run test:live-pg` | NOT RUN — requires live PostgreSQL |

## Baseline comparison

Historical baseline reported:
- 443 tests passed
- 1 test skipped
- `npm run verify` PASS
- build PASS

Current results match the test count (443 passed / 1 skipped). Typecheck, lint,
and build also pass. `npm run verify` was not executed as a single command, but
its component commands (typecheck, lint, test, build) all pass individually.

## Default test lane

- Vitest default config runs in-memory/unit/integration tests.
- No live database required.
- 41 test files passed.

## Live PostgreSQL lane

- Config: `vitest.live-pg.config.ts`
- Requires `DATABASE_URL`/`DIRECT_URL` and reachable PostgreSQL.
- Not run during this audit because the database was unreachable.

## Environment requirements

- `SESSION_SECRET` for production auth (fail-closed if missing).
- `DATABASE_URL` / `DIRECT_URL` for persistence.
- Supabase URL + publishable key for auth config.
- `SUPABASE_SECRET_KEY` for admin/provisioning features.

## Existing database guards

- `tests/pg-guard.test.ts` passed (28 tests).
- `tests/reservation-production-failclosed.test.ts` passed (2 tests).

## Notes

- One test skipped in default lane (historical baseline also reported 1 skipped).
- Live PG tests may expose additional failures not captured here.
- No E2E suite was run; E2E is not claimed as passing.

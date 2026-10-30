# OA21 — Safe Opt-In PostgreSQL Harness (local-only, uncommitted)

> Status: HARNESS COMPLETE — guard + 8 negative checks GREEN. No live PG run.
> Baseline: branch `release/hansan-c1-c3-ci-validation` @ `7c69d83`, in sync with origin (0/0).
> Safety: local-only. No remote DB, migration, seed, SQL, RLS change, deployment,
> merge, commit, push, secret access, or scratch-file deletion. No dependency changes.

## OA21.1 Changed paths and rationale

| Path | Status | Rationale |
|---|---|---|
| `tests/helpers/pg-test-guard.ts` | NEW (untracked) | Fail-closed opt-in guard: validates `HANSAN_PG_TEST_URL` + `HANSAN_PG_TEST_ALLOW=DISPOSABLE-LOCAL-PG` intent and loopback/disposable target shape WITHOUT connecting. Never reads `DATABASE_URL`/`DIRECT_URL`; never prints the URL. Pure module — importing it cannot open a connection. |
| `tests/pg-guard.test.ts` | NEW (untracked) | 8 connection-free negative checks via injected env reader (no real env read, no DB attempt). |
| `docs/OA20-DRAFT-B.md`, `docs/OA20-STAGING-READINESS-AUDIT.md` | Preserved untouched | OA20 evidence base; not staged, not committed. |
| `tests/_patch/*` (4 files) | Preserved untouched | Scratch excluded from any release scope. |

Tracked diff: clean (`git diff --stat` empty, `git diff --check` exit 0).

## OA21.2 Harness safety model and limitations

- Both `HANSAN_PG_TEST_URL` and `HANSAN_PG_TEST_ALLOW` must be explicitly set; exact sentinel `DISPOSABLE-LOCAL-PG` required (no truthy-string enable).
- Target allowlist: loopback hosts only (`localhost`/`127.0.0.1`/`::1`), port 5432 (or default), DB name starting `hansan_test_`. Remote fragments (`supabase.co`, `amazonaws.com`, `neon.tech`, `prod`, `staging`, …) refused.
- No auto-migrate/reset/truncate/drop anywhere in the harness path; schema setup (when needed) must be a separate explicit documented procedure, never part of `npm test` / `vitest run`.
- Failure reasons never contain the URL or credentials (asserted by test).
- LIMITATION: hostname checks are not proof of safety — operator affirmation via the sentinel is still required, and ambiguous identity fails closed. Live PG test files must call `requirePgTestGuard()` before any DB import is used.

## OA21.3 Negative checks performed (all connection-free)

`npx vitest run tests/pg-guard.test.ts` — 8/8 pass as part of the full suite (32 files, 342 passed / 1 skipped):

1. Missing opt-in flag → refuse. 2. Missing dedicated URL → refuse.
3. Invalid opt-in value (`"yes"`) → refuse. 4. `DATABASE_URL`+`DIRECT_URL` present but opt-in pair absent → refuse (no fallback).
5. Supabase-like remote target → refuse. 6. Non-loopback host / non-`hansan_test_*` name → refuse.
7. Valid loopback disposable target → accept (guard-only, no connection made).
8. Secret-like URL in failure path → reason contains neither password nor URL.

## OA21.4 PG-1…PG-6 evidence classification

| Scenario | Status | Evidence |
|---|---|---|
| PG-4 GUC/RLS across reuse | MOCKED + HARNESS-ONLY (guard) | Unit/review only; guard ready. Run FIRST once disposable PG exists. |
| PG-1 audit-failure rollback | MOCKED + HARNESS-ONLY (guard) | OA17 mocked invalid-transition test; no live tx proof. |
| PG-2 single winner | MOCKED + HARNESS-ONLY (guard) | OA17 mocked conflict test; no live concurrency proof. |
| PG-6 no duplicate audits | MOCKED + HARNESS-ONLY (guard) | OA17 mocked no-dup test; no live lifecycle proof. |
| PG-3 indistinguishable 404 | MOCKED + HARNESS-ONLY (guard) | Route/service mocked 404 tests; no byte-compare on PG. |
| PG-5 multi-instance idempotency | MOCKED + HARNESS-ONLY (guard) | Single-instance mocked replay tests; no two-instance run. |

Nothing is LOCAL-PG (no disposable PG available) and nothing is STAGING. Recommended run order: PG-4 → PG-1 → PG-2 → PG-6 → PG-3 → PG-5.

## OA21.5 Quality gates (actual OA21 outputs)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npx next lint` | No ESLint warnings or errors, exit 0 |
| Unit tests | `npx vitest run` | 32 files, **342 passed / 1 skipped** (was 31/334 — +8 guard, +rest from suite growth) |
| Prisma | `npx prisma validate` | "The schema at prisma\schema.prisma is valid", exit 0 |
| Build | `npx next build` | Compiled successfully |
| Diff check | `git diff --check` | exit 0 |

## OA21.6 PostgreSQL availability

- `psql`: NOT on PATH. Docker daemon: DOWN (pipe not found). `HANSAN_PG_TEST_URL` / `HANSAN_PG_TEST_ALLOW`: absent. Stopped before any connection attempt per Phase D — no live-PG test code beyond the guard was written, correctly, since there is no target to run it against.

## OA21.7 Remaining owner-controlled prerequisites

1. Disposable local PG (or owner-approved `HANSAN_PG_TEST_URL` + sentinel) so PG-4…PG-5 can run LOCAL-PG.
2. Staging Supabase project (S1), target-identity confirmation (S2), backup/restore drill (S3), `migrate status` on staging (S4).
3. CI freshness confirmation on `7c69d83` in PR #1 Checks tab (S12; `gh` unavailable locally).
4. G8/G9 monitoring + sign-off (S11). No production-readiness claim until all verified.

## OA21.8 Exact safe next step

Owner: bring up a disposable local Postgres (e.g. `docker run` PG 16, create `hansan_test_oa21`), then in that shell ONLY set `HANSAN_PG_TEST_URL=postgresql://…@localhost:5432/hansan_test_oa21` and `HANSAN_PG_TEST_ALLOW=DISPOSABLE-LOCAL-PG`, and authorize OA22 to write the PG-4 connection-reuse test behind `requirePgTestGuard()`. No remote target, no migration from test commands, no secrets in chat.

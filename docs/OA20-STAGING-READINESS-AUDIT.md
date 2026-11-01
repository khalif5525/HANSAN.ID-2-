# OA20 — Staging Readiness Audit & PostgreSQL Test Preparation (local-only, uncommitted)

> Status: DRAFT (uncommitted working document for OA20 audit).
> Baseline: branch `release/hansan-c1-c3-ci-validation` @ `7c69d83`.
> Safety: local-only. No remote DB, migration, seed, SQL, RLS change,
> deployment, merge, commit, push, secret access, or scratch-file deletion.

## OA20.1 Verified baseline

- Branch: `release/hansan-c1-c3-ci-validation`
- HEAD: `7c69d835ca93ff4f94e5c91b075d7a675f9c32f4`
- Upstream: `origin/release/hansan-c1-c3-ci-validation`, in sync (0/0)
- Tracked diff: clean (`git diff --stat` empty)
- Untracked: exactly the four preserved `tests/_patch/*` files
  (`callpost.txt`, `oa19-scan.ps1`, `patch.js`, `test.js`) — untouched
- CI evidence (local records only, `gh` CLI unavailable):
  run #2 (`38929347060`) on SHA `7c69d83` reported GREEN in OA19.
  Not re-verified remotely in OA20; treat as last-known, not fresh evidence.
- PR #1: last-known open/unmerged; not re-verified remotely in OA20.
- Local PG availability: no `psql`/`pg_ctl` on PATH; Docker CLI present but
  no local PG container/service verified. Disposable PG env names
  (`HANSAN_PG_TEST_URL`, `HANSAN_PG_TEST_ALLOW`) are ABSENT in this shell.
  No `DATABASE_URL`/`DIRECT_URL`/`SESSION_SECRET` present either.

## OA20.3 PG-1…PG-6 evidence classification

All six are MOCKED today. None is LOCAL-PG. None is STAGING.

| Test | Genuinely proves (today) | Class | Missing assertion / env | Smallest safe step | Local-only? |
|---|---|---|---|---|---|
| PG-1 audit-failure rollback | OA17 mocked test: invalid transition mutates nothing, adds no audit event | MOCKED | Real PG tx: failing `auditEvent.create` must roll back the refund row | Opt-in PG harness: fault-injected audit insert inside `transitionRefundWithAudit` | Yes, once disposable PG exists |
| PG-2 single winner | OA17 mocked conflict test: second decision rejected, one audit event | MOCKED | Real concurrency: two simultaneous decides → exactly one wins | Opt-in PG harness: parallel decide race, assert one success + one conflict | Yes |
| PG-3 indistinguishable 404 | Route+service mocked tests: cross-tenant → 404 NOT_FOUND | MOCKED | Byte-identical cross-tenant vs nonexistent-id responses on PG | Opt-in PG harness: compare status+body of both cases | Yes |
| PG-4 GUC/RLS across reuse | Unit tests: SET LOCAL order, fail-closed predicates (no live PG) | REVIEW+MOCKED | Prove no GUC leaks across reused/pooled connections | Opt-in PG harness FIRST; connection-reuse assertions | Yes |
| PG-5 multi-instance idempotency | Single-instance mocked replay tests | MOCKED | Two app instances sharing PG: one executes, other replays | Two-harness-instance run against same disposable PG | Yes |
| PG-6 no duplicate audits | Mocked: repeated calls add no extra event | MOCKED | Full lifecycle on PG: exactly one event per transition | Opt-in PG harness: request→approve→complete, count events | Yes |

Known imprecision (documented, NOT changed in OA20): the broad `catch {}`
in `transitionRefundWithAudit` maps genuine audit-insert failures to
CONFLICT-shaped `null`. Rollback stays correct (whole tx rolls back); the
error taxonomy is imprecise. Minimal fix (needs owner approval + PG proof):
catch P2025 → `null` (conflict path); let all other errors propagate so
audit failures surface distinctly. Implement only with a PG test proving
both paths.


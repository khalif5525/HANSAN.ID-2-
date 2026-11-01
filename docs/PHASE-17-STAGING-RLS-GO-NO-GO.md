# HANSAN — PHASE 17: STAGING RLS ACTIVATION GO/NO-GO

**Verdict:** `BLOCKED — RLS ACTIVATION NOT AUTHORIZED`
**Scope:** This is a gate checklist only. No RLS SQL was applied to any live
environment in this phase. `prisma/rls-tenant-isolation.sql` remains a
reviewed, unapplied artifact.

---

## 1. Gate checklist

Each gate item must be `PASS` with evidence before RLS may be activated on
staging. Current statuses reflect the Phase 17 evidence baseline.

| # | Gate | Required evidence | Status |
|---|---|---|---|
| G1 | Dedicated staging identity and separation verified | Owner-recorded project ref ≠ production ref; staging-only credentials; prove-staging checklist (main report §4) signed | **BLOCKED** — no staging provisioned |
| G2 | Backup and restore tested | One real backup restored into an isolated destination with manifest, checksums, row counts, and post-restore assertions (main report §6) | **BLOCKED** — `PREPARED — NOT EXECUTED` |
| G3 | PgBouncer transaction-pooling tests passed (Stage A) | PB-01 … PB-07, PB-11 … PB-13 all `PASS — EXECUTED WITH EVIDENCE` through the pooler | **BLOCKED** — staging unavailable |
| G4 | Migration and RLS SQL reviewed against the current schema | Static review: 19 models in `prisma/schema.prisma`; init migration `20261009000000_init`; RLS file covers 15 tenant tables (enable+force), identity tables (Organization/Outlet/User/Membership) intentionally unscoped; all predicates fail-closed via `current_setting(key,false)` | **PASS** (code-side, this phase + Phases 8/12/14 reviews) |
| G5 | Application role confirmed `NOSUPERUSER` + `NOBYPASSRLS` on staging | `pg_roles` query output from the staging app role; table ownership held by a different role | **BLOCKED** — staging unavailable (local disposable-PG evidence from Phase 14 exists but is NOT staging proof) |
| G6 | Tenant isolation tests passed under the actual pooling mode (Stage B) | PB-08 … PB-10, PB-14 … PB-15 all `PASS — EXECUTED WITH EVIDENCE` through the pooler (incl. `rls-verify.sql` 38/38) | **BLOCKED** — staging unavailable; sequenced after RLS apply per §2 |
| G7 | Required indexes and query plans reviewed | Phase 15 conclusion: no new index needed (`SequenceCounter_pkey` covers `outletId`); `EXPLAIN (ANALYZE, BUFFERS)` plans captured on disposable PG; re-run plans on staging data volumes before traffic | **PASS (design)** — staging-plan re-run pending with G6 |
| G8 | Rollback and recovery plan approved | Documented RLS rollback (§3) + backup/restore gates (G2) accepted by owner | **BLOCKED** — awaiting owner approval |
| G9 | Owner explicitly authorizes staging migration AND RLS activation | Written approval naming the staging identity and the exact SQL file to apply | **BLOCKED** — not requested/granted this phase |

**Overall gate: `BLOCKED`.** G1–G3, G5, G6, G8, G9 are unmet; RLS must not be
activated in this phase (and was not).

---

## 2. Sequencing when the gate opens

1. G1 verified → staging identity signed off.
2. Migration `20261009000000_init` applied via `DIRECT_URL` (session mode).
3. Backup taken (baseline snapshot) → G2 restore drill executed and passed.
4. Stage A pooler tests executed → G3.
5. Owner issues G9 authorization → apply `prisma/rls-tenant-isolation.sql` as
   the non-owner, non-superuser app role in effect (SQL is owner-table DDL:
   executed by the staging DDL/admin role, never the app role).
6. Stage B pooler tests executed → G6; staging `EXPLAIN` plans reviewed → G7.
7. Any failure at step 6 → execute §3 rollback; gate returns to `BLOCKED`.

---

## 3. Rollback (prepared, not executed)

Reverse order, admin role on staging only:

1. Stop the staging app (remove traffic from the pooler) — owner action.
2. `DROP POLICY IF EXISTS <policy> ON "<table>";` for every policy created by
   `prisma/rls-tenant-isolation.sql` (file is idempotent `DROP POLICY IF
   EXISTS` + `CREATE POLICY`, so re-apply after rollback is safe).
3. `ALTER TABLE "<table>" DISABLE ROW LEVEL SECURITY;` on the 15 tenant tables
   (or restore the pre-change snapshot from the G2 baseline backup if data
   integrity is in question — prefer snapshot restore when uncertain).
4. Re-verify: catalog counts of policies = 0; app read/write smoke test
   restored; evidence captured.
5. Report: which tests failed, what was rolled back, and the re-open plan.

Stop conditions during rollback: identity mismatch, unexpected policy counts,
or any error resolving which policies existed pre-change → halt and restore
from the baseline snapshot instead of manual drops.

---

## 4. Sign-off template (future use — NOT signed)

```
Staging identity verified (project ref recorded separately): ____  date: ____
Backup/restore drill evidence ID: ____
Stage A pooler tests evidence IDs: PB-01__ ... PB-13__
RLS SQL reviewed: prisma/rls-tenant-isolation.sql (sha256: ____)
Owner authorization (G9): "I authorize applying the above file to the named
staging identity." — ____ date: ____
```

---

## 5. Current verdict

```text
BLOCKED — RLS ACTIVATION NOT AUTHORIZED (staging unavailable; G2 backup drill
unexecuted; owner authorization G9 absent)
```

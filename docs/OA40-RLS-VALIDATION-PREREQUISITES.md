# HANSAN OA40 — RLS AND TENANT-ISOLATION VALIDATION PREREQUISITES (ARTIFACTS ONLY, NOT APPLIED)

**Status:** `ARTIFACTS PREPARED — NOTHING APPLIED (roles/policies/seeds/migrations require separate approval)`
**Prepared:** 2026-10-18, branch `release/hansan-c1-c3-ci-validation` @ `7c69d835ca93ff4f94e5c91b075d7a675f9c32f4`
**Boundary honored:** no role, grant, policy, schema, seed, or migration was created,
applied, or executed while preparing this document. No database connection was opened.

---

## 1. Evidence tiers — never treat these as equivalent

| Tier | Description | Current status |
|---|---|---|
| T1 | Static inspection of schema/code/policies | PARTIAL (schema + migration + tenant-context reviewed historically) |
| T2 | Mock/unit tests (no PostgreSQL) | PASS for what they cover (`tests/tenant-isolation.test.ts`, `tests/authz.test.ts`, etc. green in connection-free suite) |
| T3 | Direct PostgreSQL transaction/GUC tests | PARTIAL — OA36 GUC 3/3 PASS; OA38 50-tx direct probe incomplete (connectivity failure, root cause unconfirmed) |
| T4 | Actual RLS enforcement (positive) | NOT TESTED |
| T5 | Cross-tenant negative enforcement | NOT TESTED |
| T6 | Transaction-pooling (PgBouncer) behavior | NOT TESTED (plan: `docs/OA39-PGBOUNCER-DISPOSABLE-VALIDATION-PLAN.md`; staging: PHASE-17) |
| T7 | Authorized staging validation + owner sign-off | NOT TESTED (staging unavailable) |

Only T4/T5 evidence (and T6/T7 for pooled production paths) can move gates G6/G8/G11.
T1–T3 evidence must never be reported as RLS proof — invariant 21.

---

## 2. Prerequisites checklist (what exists / what is missing)

| # | Prerequisite | Status | Notes |
|---|---|---|---|
| R1 | RLS policies authored in a migration | **MISSING** | Only `prisma/migrations/20261009000000_init/migration.sql` exists; zero matches for `ROW LEVEL SECURITY` / `CREATE POLICY` in it |
| R2 | SQL review artifacts for RLS checks | EXISTS (authored, never executed) | `prisma/rls-verify.sql`, `prisma/rls-tenant-isolation.sql`, `prisma/rls-demo-isolation.sql`, `prisma/guc-impersonation-probe.sql` — tracked files; execution requires approval |
| R3 | Application DB role: `NOSUPERUSER NOBYPASSRLS CREATEROLE=n LOGIN`, non-owner of protected tables | **MISSING** | Role never created; creation/grants = AMBER/RED (never autonomous) |
| R4 | Table ownership by a different (non-app) role | **MISSING** | A migration-applied table owned by the app role would bypass RLS (owner exempt); ownership must be arranged in the approved RLS migration |
| R5 | Tenant context primitive in transactions | EXISTS | `src/server/db/tenant-context.ts` — `tenantContextSetLocalSql()` sets `app.organization_id` transaction-locally (key verified against tests) |
| R6 | Migration/schema integrity baseline | PARTIAL | Init migration exists and was previously status-audited; `prisma migrate status` against a DB is a live command (AMBER) |
| R7 | Synthetic tenant seed rows for positive/negative tests | **MISSING** | Seeding = AMBER (data creation on disposable DB requires approval; synthetic values only, invariant §4) |
| R8 | Pooling interplay (GUC + RLS under PgBouncer) | **BLOCKED** | Depends on OA39/PHASE-17 stage ordering: RLS Stage-B pooler tests come after pooler infra approval |
| R9 | Verified role flags at run time | NOT TESTED | `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcanlogin FROM pg_roles WHERE rolname = current_user` (mirrors PHASE-17 PB-12) must run on the test DB during the approved RLS session |

**If asked to "just run RLS tests" today:** report exactly R1, R3, R4, R7 missing and
stop — no setup without separate explicit approval.

---

## 3. Prepared test matrix (to be executed only after R1–R7 are approved & applied)

| ID | Test | Type | PASS criteria |
|---|---|---|---|
| RLS-01 | Role flags | T4 precheck | App role shows `rolsuper=f rolbypassrls=f rolcreaterole=f rolcanlogin=t` and is not the table owner |
| RLS-02 | Positive same-tenant read | T4 | Rows visible when `app.organization_id` pinned to owning tenant inside tx |
| RLS-03 | Positive same-tenant write | T4 | Insert/update succeeds for owning tenant, then rolled back (no persistent test data) |
| RLS-04 | Negative cross-tenant read | T5 | With other tenant pinned: **zero rows**, never an error leaking existence of data |
| RLS-05 | Negative cross-tenant write | T5 | Insert under wrong tenant fails or affects 0 rows of the victim tenant |
| RLS-06 | Missing tenant context fails closed | T5 | No `app.organization_id` set → `current_setting(key, false)` raises → zero rows, fail-closed |
| RLS-07 | Transaction rollback restores state | T4 | Rolled-back writes invisible to any subsequent tx/tenant |
| RLS-08 | Owner/superuser exemption caveat documented | T1+T4 | Evidence that running tests as owner would falsely pass (documented, then re-run as non-owner app role) |
| RLS-09 | Backend-reuse leak: alternate tenants on reused PIDs | T5 (+T6 if pooled) | No tenant context or row visibility ever crosses transactions regardless of PID reuse |
| RLS-10 | Pooler pass-through (Stage B of PHASE-17) | T6 | PB-08…PB-10/PB-14…PB-15 criteria via pooler connection string |

Ordering: RLS-01 → RLS-02/03 → RLS-04/05/06 → RLS-07/09 → (pooler approval) RLS-10.
Any failure stops the sequence; no assertion weakening; no target change; no retry.

---

## 4. Explicit non-actions (this artifact)

- No `CREATE ROLE`/`GRANT`/`ALTER ... ROW LEVEL SECURITY`/`CREATE POLICY` executed or drafted into a migration.
- No seeds, no migration applies, no `prisma db execute`.
- No claim of RLS enforcement anywhere in the readiness table (G6 remains NOT TESTED).

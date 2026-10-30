# HANSAN — PHASE 17: PGBOUNCER STAGING TEST PLAN

**Status:** `PLAN PREPARED — NOT RUN (STAGING UNAVAILABLE)`
**Boundary:** No remote database was contacted. No PgBouncer was installed
anywhere (explicitly forbidden on the owner's laptop per owner decision; tests
run only in the dedicated, isolated staging environment after provisioning and
explicit owner approval).

---

## 1. Status legend

| Status | Meaning |
|---|---|
| `PLAN PREPARED` | Test designed, method and pass criteria documented; not executed. |
| `NOT RUN — STAGING UNAVAILABLE` | Cannot run: staging resources do not exist yet. |
| `PASS — EXECUTED WITH EVIDENCE` | Executed on staging pooler with captured evidence. |
| `FAIL` | Executed and failed; blocks the RLS gate. |

**Hard rule:** direct-PostgreSQL (session-connection) verification is **never**
proof of PgBouncer compatibility. Only tests executed *through the intended
pooler connection string* carry pooled-status weight.

---

## 2. Preconditions (all currently unmet)

| # | Precondition | Current |
|---|---|---|
| P1 | Dedicated staging environment provisioned and identity-verified by owner (see main report §4 "prove-staging" checklist) | NOT RUN |
| P2 | Owner explicitly approves executing this plan on staging | NOT RUN |
| P3 | Staging `DATABASE_URL` routes through the transaction pooler (Supabase pooler host, port 6543); `DIRECT_URL` (port 5432) reserved for migrations/admin only | NOT RUN |
| P4 | Committed migration `20261009000000_init` applied on staging | NOT RUN |
| P5 | Staging app role is `NOSUPERUSER NOBYPASSRLS`, not the table owner (verified *on staging*) | NOT RUN |
| P6 | Synthetic test tenants seeded (`org_pb_a`, `org_pb_b`) with ≥1 row each in Order/Payment/SequenceCounter; test data is obviously synthetic (§4 safety rules) | NOT RUN |

### Execution ordering (resolves RLS chicken-and-egg)

- **Stage A — pre-RLS (P1–P6, migration applied, RLS NOT yet applied):**
  PB-01 … PB-07, PB-11 … PB-13. These prove pooler config, Prisma
  transaction compatibility, GUC scoping/reset semantics, saturation behavior,
  and role privileges.
- **Stage B — post-RLS (after owner-approved RLS apply per the GO/NO-GO gate):**
  PB-08 … PB-10, PB-14 … PB-15. These prove fail-closed behavior, cross-tenant
  denial, and the full isolation matrix *under the actual pooling mode*.
  If any Stage-B test fails, the documented RLS rollback is executed and the
  gate returns to `BLOCKED`/`FAIL`.

The RLS GO/NO-GO gate requires Stage A green **before** RLS apply and Stage B
green **before** the gate can be declared satisfied.

---

## 3. Test matrix

All tests run **through the pooler connection string** (client → pooler →
PostgreSQL) unless noted. Evidence = saved query output + timestamps + pooler
version/mode line, committed to the owner's evidence store (never into the
public repo if it contains connection details).

### Stage A — pre-RLS

| ID | Test | Method | Pass criteria | Status |
|---|---|---|---|---|
| PB-01 | Pooler version & effective pool mode | `SHOW VERSION;` `SHOW POOL_MODE;` via the pooler port | Version recorded; `pool_mode = transaction` | PLAN PREPARED |
| PB-02 | Application routing through intended pooler | Connect with Prisma using staging `DATABASE_URL`; `SHOW` commands + `pg_stat_activity` cross-check (`application_name`, ports) from `DIRECT_URL` | App connections terminate at the pooler host:6543, not the direct endpoint | PLAN PREPARED |
| PB-03 | Prisma interactive transaction compatibility | `prisma.$transaction([...])` batch + interactive `async (tx) =>` with reads/writes, through pooler; repeat 50× | No prepared-statement/protocol errors; all commit | PLAN PREPARED |
| PB-04 | Tenant GUCs set inside the SAME transaction as protected queries | `withTenantTransaction`-equivalent: `set_config(..., true)` as first statements, then queries, inside one interactive tx, through pooler | GUC values visible to `current_setting(key,false)` within the tx; no error | PLAN PREPARED |
| PB-05 | Sequential transactions reusing pooled backends | 200 iterations alternating tenant A/B contexts, each its own tx through the same pooler; log `pg_backend_pid()` per tx | Backend pid reuse observed at least once; every tx sees only its own tenant context | PLAN PREPARED |
| PB-06 | COMMIT resets context | After COMMIT of a pinned tx, run `current_setting('app.organization_id', false)` in a fresh tx on the same pooled connection | Setting missing → error (fail-closed), never a leaked value | PLAN PREPARED |
| PB-07 | ROLLBACK resets context | Same as PB-06 with explicit ROLLBACK and with error-induced abort | Setting missing after rollback | PLAN PREPARED |
| PB-11 | Connection saturation / wait behavior | Hold tx until pool limits; time a new client; inspect `SHOW POOLS`/`SHOW CLIENTS` | Waits then errors per configured `pool_wait_timeout`/`client_login_timeout`; Prisma `connection_limit`/`pool_timeout` behave as documented; no silent hang beyond configured timeouts | PLAN PREPARED |
| PB-12 | Role privileges | Via direct URL as app role: `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcanlogin FROM pg_roles WHERE rolname = current_user;` + TRUNCATE-denial probe | `f, f, f, t`; TRUNCATE denied | PLAN PREPARED |
| PB-13 | Error path followed by connection reuse | Force a mid-tx unique-violation error → rollback → immediately run a fresh pinned tx ×20 | Every post-error tx succeeds with correct context; pool health intact | PLAN PREPARED |

### Stage B — post-RLS (requires owner-approved RLS apply first)

| ID | Test | Method | Pass criteria | Status |
|---|---|---|---|---|
| PB-08 | Missing tenant context fails closed | Query a protected table through pooler WITHOUT pinning GUCs | `current_setting('app.organization_id', false)` throws; zero rows returned; fail-closed | PLAN PREPARED |
| PB-09 | Cross-tenant denial | Pin tenant A in tx, query/insert tenant B rows through pooler | Reads: B rows invisible. Inserts with B's organizationId: RLS WITH CHECK rejects | PLAN PREPARED |
| PB-10 | Cross-tenant denial on reused connection | PB-09 interleaved with PB-05-style pid reuse | Same denial results on every reused backend | PLAN PREPARED |
| PB-14 | Same-tenant + cross-tenant assertions vs actual staging RLS | Run the `prisma/rls-verify.sql` 38-assertion harness **through the pooler** (connection target adapted) | 38/38 pass; fail-guard NOTICE emitted | PLAN PREPARED |
| PB-15 | Post-RLS sequential reuse & reset re-run | Re-run PB-05/06/07 unchanged | Same passes as Stage A — proves GUC scoping still holds with policies active | PLAN PREPARED |

---

## 4. Safety rules for execution day

1. Connect only to the owner-verified staging pooler host (precondition P1
   prove-staging checklist first). Verify identity **before** any write.
2. Seed data must be unmistakably synthetic (`org_pb_a`/`org_pb_b`, names
   prefixed `[PB-TEST]`). Never copy production rows into staging.
3. Never print, log, or paste connection strings, passwords, or keys into
   evidence files — record host, port, database name, and masked user only.
4. Cleanup (end of session, in FK-safe order): delete `[PB-TEST]` rows via the
   pinned-tenant path as the app role; verify `count(*) = 0`; keep only the
   evidence logs. If cleanup cannot complete cleanly, stop and escalate to the
   owner rather than improvising destructive SQL.
5. Abort immediately (and report) if: the connected database identity does not
   match P1, any superuser/bypass-RLS surprise appears, or any write lands
   outside the synthetic tenants.

---

## 5. Evidence capture template (per test)

- Test ID, UTC timestamp, executing operator (owner or owner-supervised)
- Pooler host masked, pooler `SHOW VERSION` and `SHOW POOL_MODE` lines
- Statement + full result output (redacted of credentials)
- `pg_backend_pid()` traces for reuse tests (PB-05/10/15)
- Final status line: `PASS — EXECUTED WITH EVIDENCE` / `FAIL`

---

## 6. Current summary

| Group | Status |
|---|---|
| PB-01 … PB-07, PB-11 … PB-13 (Stage A) | `NOT RUN — STAGING UNAVAILABLE` |
| PB-08 … PB-10, PB-14 … PB-15 (Stage B) | `NOT RUN — STAGING UNAVAILABLE` (also gated on owner-approved RLS apply) |
| Direct-PG evidence from Phases 9/14 | Valid for schema/RLS design only; explicitly NOT pooled proof |
| Overall | `PLAN PREPARED — NOT RUN (STAGING UNAVAILABLE)` |

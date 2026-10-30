# HANSAN OA39 — DISPOSABLE PGBOUNCER TRANSACTION-POOLING VALIDATION PLAN (CODE-ONLY, NOT RUN)

**Status:** `PLAN PREPARED — NOT RUN (AMBER: infrastructure + guard change + live test all require explicit owner approval)`
**Prepared:** 2026-10-18, branch `release/hansan-c1-c3-ci-validation` @ `7c69d835ca93ff4f94e5c91b075d7a675f9c32f4`
**Boundary honored:** no container was pulled/created/started, no guard was changed, no live test was written or executed, no dependency was installed while preparing this plan.

---

## 0. Owner-decision conflict — resolve BEFORE any execution

`docs/PHASE-17-PGBOUNCER-STAGING-TEST-PLAN.md` records a prior owner decision: **PgBouncer
is explicitly forbidden on the owner's laptop; pooler tests run only in the dedicated
isolated staging environment.** The current master brief asks for a *disposable local*
PgBouncer validation plan. Both options are legitimate, but they conflict. The owner must
pick one before anything runs:

- **Option A (local, disposable):** explicit owner override of the laptop decision, scoped
  to exactly one container on loopback, same sentinel rules as the PG harness. Steps in §2.
- **Option B (staging):** skip local entirely; execute the existing PHASE-17 matrix when
  its preconditions P1–P6 are met (staging currently unavailable).

No image pull, container, port, volume, network, or guard change happens until the owner
selects an option and approves the exact scope.

---

## 1. Verified configuration facts (official documentation, checked 2026-10-18)

| # | Fact | Source |
|---|---|---|
| F1 | Latest PgBouncer release is **1.26.1 (2026-10-14)**; the 1.17.0–1.26.0 / 1.26.0 CVEs (SCRAM StartupMessage auth bypass, unauthenticated CPU spin, packet-overflow hangs) are fixed in it. Proposed version: **≥1.26.1**. | pgbouncer.org/changelog |
| F2 | `pool_mode` default is **session** → must be explicitly set to **transaction**. | pgbouncer.org/config.html |
| F3 | `max_prepared_statements` introduced in **1.21.0**, default **0 (disabled)**; upstream suggests ~**100** to enable named prepared-statement tracking. | PgBouncer 1.21.0 release notes |
| F4 | Prisma docs: PgBouncer **must** run in transaction mode for Prisma Client; `?pgbouncer=true` is for PgBouncer **< 1.21.0** and is **not recommended** for ≥1.21.0; `max_prepared_statements > 0` required for Prisma prepared statements. | prisma.io PgBouncer page |
| F5 | Defaults `default_pool_size=20`, `max_client_conn=100`; real timeout keys are `query_wait_timeout` / `client_login_timeout` (PHASE-17 PB-11 cites `pool_wait_timeout`, which does **not** exist — correct that staging doc in a later GREEN pass). | pgbouncer.org/config.html |
| F6 | PgBouncer 1.26.0 tracks `search_path` by default; `ignore_startup_parameters` takes precedence over tracked params. | pgbouncer.org/changelog |

**Uncertainty (do NOT invent):** F4 comes from the current (v7/v8) Prisma docs. The project
uses **Prisma 5.22.0**, whose era docs historically required `?pgbouncer=true` even against
≥1.21.0 poolers. Prisma 5.22.0 (library engine) × PgBouncer 1.26.x behavior with/without
the flag is **empirically unverified** — decided by test **PB-T0** (§5) during the approved
run and recorded as evidence, never assumed.

**Uncertainty:** registry availability of a pinned `1.26.1` image tag is unverified — check
with `docker manifest inspect` at approval time. Also verify `auth_type` compatibility with
PostgreSQL 16's default `scram-sha-256` against the installed version's docs at that time.

---

## 2. Proposed infrastructure (Option A — exact, for approval; nothing executed)

- **Image:** pinned PgBouncer ≥ **1.26.1** (exact repo:tag verified at approval time).
- **Mode:** `pool_mode = transaction`.
- **Client binding:** host publish **`127.0.0.1:5434`** → container 5434 (port 5434
  confirmed free at approval time; 5433 stays the direct PostgreSQL port).
- **Server path:** containers cannot reach the host's `127.0.0.1:5433` binding, so use a
  shared user network: `docker network create hansan-pgnet` then
  `docker network connect hansan-pgnet hansan-pg-test`; pooler connects
  `host=hansan-pg-test port=5432` (container-to-container, never remote).
- **Target DB unchanged:** `hansan_test_oa21` (guard's `hansan_test_*` check intact).
- **Credentials:** the OA36 disposable password file
  (`C:\temp\hansan-pg-test-postgres-password`) feeds PgBouncer `auth_file` and the test
  URL; URL-encoded, never printed (output redacted `://***@`).

Proposed `pgbouncer.ini` (each `[verify]` item checked against installed-version docs):

```ini
[databases]
hansan_test_oa21 = host=hansan-pg-test port=5432 dbname=hansan_test_oa21

[pgbouncer]
listen_addr = 0.0.0.0          ; container-internal; host publishes 127.0.0.1:5434 only
listen_port = 5434
pool_mode = transaction        ; F2: default is session — must override
max_client_conn = 100          ; F5 default
default_pool_size = 20         ; F5 default
max_prepared_statements = 100  ; F3: default 0 disables Prisma prepared-stmt tracking
auth_type = scram-sha-256      ; [verify] matches PG16 password_encryption
```

**Explicitly prohibited at this stage:** any host port other than `127.0.0.1:5434`, any
volume deletion/creation beyond what the pooler needs, any change to the running
`hansan-pg-test` container, any application `.env`/`DATABASE_URL`/`DIRECT_URL` touch, any
dependency install.

## 3. Guard change (AMBER — NOT done in this session)

`tests/helpers/pg-test-guard.ts` currently allows loopback ports `["", "5432", "5433"]`.
A pooler on **5434 would be rejected — correctly**. Running through PgBouncer therefore
requires a reviewed guard change:

- Add `"5434"` to `ALLOWED_LOOPBACK_PORTS` **only** (loopback host gate, sentinel
  `HANSAN_PG_TEST_ALLOW=DISPOSABLE-LOCAL-PG`, `hansan_test_*` DB-name requirement, and
  `HANSAN_PG_TEST_URL`-only rule all unchanged).
- Update `tests/pg-guard.test.ts` in the same change.
- Classification: **AMBER** (changing a live-test guard). Included in the approval
  request; not applied now.

---

## 4. URL separation

- **Pooler test URL (only via `HANSAN_PG_TEST_URL`, built in-command from the password
  file):** `postgresql://hansan_test:***@127.0.0.1:5434/hansan_test_oa21`
- **Application runtime:** untouched — `DATABASE_URL`/`DIRECT_URL` remain reserved for
  staging's Supabase pooler (6543) / direct endpoint (5432) per PHASE-17 P3 and are never
  read in this workflow.

---

## 5. Test matrix (one new live file; authored/only run with approval)

| ID | Test | Method | PASS criteria |
|---|---|---|---|
| PB-T0 | Pooler smoke + `pgbouncer=true` decision | One `current_setting('app.organization_id', true)` read through 127.0.0.1:5434; on protocol errors, repeat with/without `?pgbouncer=true` and record which works | Read succeeds; flag decision recorded as evidence (F4 uncertainty resolved empirically) |
| PB-T1 | 50-tx alternating-tenant GUC probe through pooler | Mirror of the OA38 direct probe: `set_config(..., true)` + in-tx visibility assert + outside-tx leak assert per tx, tenants A/B alternating, 60 s timeout | 50/50 tx complete; every in-tx assert passes; every leak check passes; final clean tx passes |
| PB-T2 | Backend reuse diagnostics | Log `pg_backend_pid()` per tx (diagnostic only, never asserted) | `distinct_backends` reported; a pooler should show fewer distinct PIDs than 50 — observation only, never asserted |
| PB-T3 | COMMIT/ROLLBACK context reset | Covered by PB-T1 outside-tx reads + final clean tx | No probe value ever observed outside its transaction |
| PB-T4 | Mid-tx error → pool recovery | Force `SELECT 1/0` inside an interactive tx (expect throw) → immediately run a full GUC tx, ×10 | Every post-error tx passes; pool never hangs; no assertion weakened |
| PB-T5 | Saturation/wait behavior | Hold more concurrent interactive txs than `default_pool_size`; time a new tx; inspect `SHOW POOLS`/`SHOW CLIENTS` through the pooler | Bounded wait then per-`query_wait_timeout` error; no hang beyond the test timeout |

**Execution discipline (when approved):** exact file, exact target, executed **once**;
env vars set only in child env and removed regardless of outcome; no automatic retry; no
target change after failure; no assertion weakening.

**PASS** = every row's criteria met in one run · **FAIL** = any assertion or pooler error
(stop, report class, no retry) · **INCONCLUSIVE** = preflight fails (container/port/
guard/code drift) or environment abort (stop without repair).

**Cleanup:** env vars removed; container and network left in place (container/volume
deletion is RED — owner-approved teardown only).

---

## 6. Limitations (must accompany any result)

- Direct-endpoint results (OA36/OA38) carry **zero** pooling weight — invariant 20.
- A local disposable pooler ≠ Supabase Supavisor; gate G8 still requires the PHASE-17
  staging matrix (PB-01…PB-15).
- GUC-only probes prove nothing about RLS enforcement — invariant 21.
- Prisma 5.22 × PgBouncer 1.26.x is an empirical question until PB-T0 runs.


# HANSAN — PHASE 17: STAGING READINESS & CI ACTIVATION PLAN

**Date:** 10/13/2026
**Decision:** `READY FOR OWNER REVIEW — STAGING PLAN PREPARED`
**Scope:** Local preparation and documentation only. No external provisioning,
no remote database access, no PgBouncer installation, no Docker changes, no
secret creation/modification, no GitHub settings changes, no CI activation, no
Git stage/commit/push/merge/reset/checkout/deploy. This decision does **not**
authorize staging provisioning, CI activation, remote database operations, or
production release.

> All validation exit codes below were captured this session on the current
> working tree. Prior-phase baselines are not reused as evidence for changed
> files.

---

## 1. Repository baseline

### 1.1 Git state (verified this session)

| Property | Value |
|---|---|
| Branch | `main` (tracking `origin/main`) |
| HEAD | `1bf82a404fb6a02a12db3d2eb73349403538b934` — "fix: resolve Next.js page export build error" |
| Upstream status | 0 ahead / 0 behind (`main...origin/main` clean per porcelain + `git branch -vv`) |
| Staged changes | **0** (`git diff --cached --stat` empty) |
| Modified tracked files | **49** (package/config, UI pages/components, domain, server modules, tests) |
| Untracked entries | **75** (incl. `.github/workflows/`, Phase 8–16 docs, `prisma/schema.prisma`, `prisma/migrations/`, RLS SQL artifacts, new `src/server/*` + `src/domain/*` modules, new tests, `AppData/`, `tmp_*` files, `flaky_run_*.txt`) |
| Git operations this phase | **None** (no stage, commit, push, merge, stash, checkout, reset, clean) |

Prior-report claims verified: HEAD, upstream sync, empty index, and the large
uncommitted working tree all match. File counts differ from earlier reports
(Phase 16 said 49 modified / 73 untracked; today: 49 modified / 75 untracked —
the Phase 17-adjacent docs account for the drift).

### 1.2 Toolchain & environment (verified this session unless noted)

| Item | Value |
|---|---|
| Node | v24.11.1 (local dev; CI pins 20 — parity caveat §2.4) |
| npm | 11.6.2 |
| Lockfile | `package-lock.json` present, tracked, currently modified (uncommitted work) |
| Docker daemon | Not running (Phase 16 finding; not re-verified — no container work was needed) |
| PgBouncer binary | Not installed locally; **not required** — owner decision routes PgBouncer to dedicated staging |
| `.env` | Present, gitignored, untracked. **Never read or printed.** Only its 8 variable *names* were enumerated (to blank them for the clean-runner build simulation); values were never displayed |
| `node_modules` / `.next` | Present; left in place |

### 1.3 Prisma / RLS artifacts

| Item | State |
|---|---|
| `prisma/schema.prisma` | Untracked; 19 models (Organization, Outlet, User, Membership, MenuCategory, MenuItem, Ingredient, Recipe, RecipeItem, InventoryMovement, Order, OrderItem, SequenceCounter, IdempotencyRecord, Payment, Refund, SettlementBatch, Approval, AuditEvent) |
| Migrations | 1 migration `20261009000000_init` + `migration_lock.toml` (untracked directory) |
| `prisma/rls-tenant-isolation.sql` | 238-line reviewed artifact — ENABLE+FORCE RLS on 15 tenant tables, fail-closed `current_setting(key,false)` predicates, idempotent `DROP POLICY IF EXISTS`; **not applied to any live DB** |
| Tenant context | `src/server/db/tenant-context.ts` — `withTenantTransaction` pins `app.organization_id` / `app.outlet_id` / `app.role` / `app.data_scope` via `set_config(..., is_local=true)` as the FIRST statements of the same transaction; validated by `requireTenantContext` (fail-closed) |

---

## 2. CI workflow review and local validation

### 2.1 Workflow reviewed: `.github/workflows/ci.yml` (untracked, unstaged)

"CI — Pull Request Gate" — 1 job (`check` on `ubuntu-latest`), 8 steps:
checkout → setup-node (Node 20, `cache: npm`) → `npm ci` → `npm run typecheck`
→ `npm run lint` → `npm test` → `npm run db:validate` → `npm run build`.

| Review dimension | Result |
|---|---|
| Node version / lockfile / caching | PASS — Node 20 pinned (supported LTS for Next 14.2.35); `npm ci` + npm cache via `actions/setup-node@v4` |
| Script names vs `package.json` | PASS — all 5 invoked scripts exist verbatim |
| Required env vars / safe defaults | PASS — no step reads `secrets.*`; `prisma validate` is schema-only (no DB); no `DATABASE_URL`/`SESSION_SECRET` needed |
| Permissions | PASS after narrow hardening — explicit `permissions: contents: read` added (was default/implicit) |
| Trigger behavior | PASS (minimal) — `pull_request → [main]` + `workflow_dispatch` (no inputs). Note: **no `push` trigger**, so plain branch pushes don't run the gate |
| PR/fork execution without secrets | PASS — full gate runs secret-free; fork PRs have nothing to leak |
| Deploy/migrate/production access | NONE — no step deploys, migrates, or touches a DB |
| Clean-runner viability | PASS (local simulation) — build executed with all 8 `.env` var names blanked → exit 0 |

### 2.2 Narrow corrections made (local, untracked, unstaged)

1. Added `permissions: contents: read` (least-privilege token).
2. Removed the **unused** `workflow_dispatch.inputs.LIVE_DB_URL` input — dispatch
   inputs are recorded in run metadata; an owner pasting a connection string
   there would expose it to repository readers. Its own comments declared it
   unused. `workflow_dispatch` retained for manual runs.

YAML syntax re-validated after edits with the already-present local `js-yaml`
(no new tools installed): parses cleanly; triggers =
`{pull_request→[main], workflow_dispatch}`; `permissions={contents: read}`;
8 steps confirmed.

### 2.3 Local validation (this session, actual exit codes)

| # | Check | Command | Result | Exit |
|---|---|---|---|---|
| 1 | TypeScript | `npm run typecheck` | Clean | **0** |
| 2 | ESLint | `npm run lint` | "No ESLint warnings or errors" | **0** |
| 3 | Unit tests | `npm test` | 28 files passed; **284 passed, 1 skipped (285)** | **0** |
| 4 | Schema | `npm run db:validate` | "The schema at prisma\schema.prisma is valid" (schema-only; connects to no DB) | **0** |
| 5 | Build | `npm run build` | Compiled successfully | **0** |
| 6 | Clean-runner build | `npm run build` with all 8 `.env` var names blanked | Compiled successfully | **0** |

Post-edit scope note: the only changed/new files are the workflow YAML
(re-validated) and Phase 17 markdown docs — none are in scope of tsc, ESLint,
vitest, Prisma validate, or Next build, so the gate results above remain
current for the tree.

### 2.4 Honest caveats

- CI runs Node 20; local gates ran on Node 24. The first remote run is the
  real Node-20 verification (`UNVERIFIED` until then).
- `npm ci` on a clean runner installs from the committed lockfile; the
  lockfile is currently modified-but-uncommitted — CI will validate whatever
  lockfile lands on `main` at activation time.

---

## 3. Exact steps requiring owner approval

No step below was performed by this phase.

| # | Approval | Exact scope | Blocked until |
|---|---|---|---|
| OA1 | CI activation | Commit/push `.github/workflows/ci.yml` (Phase 17 reviewed version) and enable "CI — Pull Request Gate"; apply checklist settings R1–R5 (R4 deferred until N green runs). Exact approval text: `PHASE-17-CI-ACTIVATION-CHECKLIST.md` §8 | Owner statement in writing |
| OA2 | Staging provisioning | Create/allocate a **dedicated** staging environment (e.g., separate Supabase project) + record its identity per §4 | Owner provisioning decision + budget |
| OA3 | Staging secrets | Set staging-only Supabase keys and `SESSION_SECRET` (≥32 chars) in the staging platform's secret store — never committed, never printed | Owner key generation |
| OA4 | Migration apply | Run committed `20261009000000_init` against staging via `DIRECT_URL` | OA2 + prove-staging checklist signed |
| OA5 | Backup/restore drill | Execute the §6 gates (including retention/RPO/RTO decisions) | OA2 + owner retention decision |
| OA6 | PgBouncer staging tests | Execute `PHASE-17-PGBOUNCER-STAGING-TEST-PLAN.md` Stage A (then Stage B) on staging | OA2, OA4 + explicit go |
| OA7 | RLS activation | Apply `prisma/rls-tenant-isolation.sql` to staging | All `PHASE-17-STAGING-RLS-GO-NO-GO.md` gates G1–G9 = PASS |
| OA8 | Production release | Anything touching production | Not in scope of this or any current phase |

---

## 4. Staging resource specification (prepared, nothing provisioned)

### 4.1 Isolation & identity
- A dedicated staging environment, fully isolated from production: separate
  database/project (e.g., separate Supabase project ref), separate network
  endpoints, separate credentials. **Never** a production project, database,
  or branch/schema.
- An existing remote project must **not** be assumed to be staging. The owner
  independently verifies and records its identity (project ref, region,
  creation date, accountable owner) in the owner's asset store — not in this
  repository.
- One accountable owner for staging access; no shared/unattributed accounts.

### 4.2 Credentials
- Distinct application credentials (pooler user via `DATABASE_URL`) and
  distinct administrative/direct credentials (via `DIRECT_URL`) from
  production. Distinct Supabase publishable and secret keys from production.
- Any credential ever shared with production is treated as compromised and
  rotated before staging use.

### 4.3 Runtime & direct-connection configuration
- `DATABASE_URL` → staging pooler host, **port 6543** (transaction pooling) —
  the app's only runtime DB path.
- `DIRECT_URL` → same database, **port 5432** (session/direct) — migrations
  and admin tooling only; never used by app request paths.
- Prisma runtime sized for `pool_mode=transaction` with explicit
  `connection_limit` and `pool_timeout` (owner-tuned; validated by PB-11).
- Staging app config (`NEXT_PUBLIC_SUPABASE_URL`, publishable key,
  `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`) lives in the staging
  platform's configuration/secrets UI — never committed.

### 4.4 Supabase Auth (staging)
- Auth enabled on the staging project only; its own URL, publishable key,
  secret (service-role) key, and JWKS URL — all pointing at the staging ref.
- Redirect/allow-list URLs restricted to staging domains. No production JWT
  secret or key reuse. Test users are synthetic.

### 4.5 SESSION_SECRET validation (no secret generated or exposed here)
- Code rule (verified in `src/server/session.ts`): values shorter than 32
  characters are refused; in production, a missing secret fails closed (503,
  `AUTH_NOT_CONFIGURED`).
- Staging requirement: a staging-only secret, ≥32 chars, generated and stored
  by the owner in the staging secret store; distinct from any production
  value. Acceptance check on staging: sign-in endpoint returns a non-503
  outcome in production mode (401 for bad credentials is fine; 503 means the
  secret is missing/too short).

### 4.6 PgBouncer availability & transaction pooling
- Pooling is provided in the dedicated staging environment only (Supabase
  transaction pooler or an owner-operated PgBouncer inside staging
  infrastructure). **No PgBouncer on the owner's laptop** (owner decision).
- Required configuration: `pool_mode = transaction`; recorded version; sane
  `max_client_conn` / `default_pool_size`; defined server reset behavior
  (e.g., `DISCARD ALL` on release); restart policy; config/secrets kept out of
  this repository. Values recorded as PB-01/PB-11 evidence.

### 4.7 Migration execution & rollback
- Forward: `20261009000000_init` via `DIRECT_URL` (prisma migrate deploy),
  additive-only. RLS SQL is applied **separately**, later, per the GO/NO-GO
  gate.
- Rollback: no down-migration exists; recovery strategy is snapshot/backup
  restore (§6) plus documented manual reverse SQL (policy drops — GO/NO-GO
  §3). Destructive operations are staging-only.

### 4.8 Monitoring & access control
- Staging logs (auth, API, DB connections, slow queries) enabled and retained
  per owner policy; dashboard access limited to named individuals with MFA;
  least-privilege DB roles; periodic access review; alerting on auth failures
  and connection saturation.

### 4.9 Prove-staging gate (before ANY destructive or schema-changing op)
All must be recorded by the owner before migration/RLS/backup-restore work:
1. Project ref/endpoint used matches the value recorded at provisioning
   (compared programmatically; values not printed in reports).
2. `SELECT current_database(), version()` captured from the target.
3. App role check: `rolsuper = false`, `rolbypassrls = false`.
4. Staging app config points at the staging Supabase URL (owner spot-check).
5. Data sanity: staging contains no production lineage (e.g., production
   organization ids absent).
6. Signed owner attestation: "this connection is staging, not production."
If any item fails → **stop**.

---

## 5. PgBouncer staging test plan (summary)

Full plan: `docs/PHASE-17-PGBOUNCER-STAGING-TEST-PLAN.md`.

- **Stage A (pre-RLS):** PB-01 version/mode · PB-02 app routing through
  pooler · PB-03 Prisma interactive transactions · PB-04 GUCs pinned in the
  same tx as protected queries · PB-05 sequential tx reusing pooled backends
  (alternating tenants, pid traces) · PB-06 COMMIT resets context ·
  PB-07 ROLLBACK resets context · PB-11 saturation/timeouts · PB-12 role
  privileges (`NOSUPERUSER`/`NOBYPASSRLS`) · PB-13 error path then reuse.
- **Stage B (post owner-approved RLS apply):** PB-08 missing tenant context
  fails closed · PB-09 cross-tenant denial · PB-10 denial on reused
  connections · PB-14 `rls-verify.sql` 38 assertions **through the pooler** ·
  PB-15 re-run of PB-05/06/07 with policies active.
- This split resolves the RLS chicken-and-egg: GUC/pool mechanics are proven
  pre-RLS; isolation-under-pooling is proven immediately post-RLS, with
  automatic rollback to `BLOCKED` on any Stage-B failure.
- Current status of every test: `NOT RUN — STAGING UNAVAILABLE`.
  Direct-PG evidence (Phases 9/14) remains valid for design only and is
  explicitly **not** pooled proof.

---

## 6. Backup and recovery gates (operationalized from Phase 16)

**Status: `PREPARED — NOT EXECUTED`.** No backup was created, no remote DB was
connected, no restore was attempted.

| Gate | Requirement |
|---|---|
| BG1 Scope | Full logical dump of the staging DB (schema + data, custom format) plus a schema-only dump; manifest with per-artifact sizes and SHA-256 checksums |
| BG2 Encryption | Owner decision on method (platform-managed encryption at rest + TLS in transit at minimum; dump-level encryption if dumps leave the staging host). No plaintext dump leaves staging without explicit owner approval |
| BG3 Retention / RPO / RTO | **Owner decisions — not invented here.** Owner records: retention period, acceptable RPO, acceptable RTO, PITR on/off |
| BG4 Isolated restore destination | New empty database or disposable cluster with distinct credentials; never production, never the live staging DB |
| BG5 Integrity verification | Checksums verified pre/post transfer; `pg_restore --list` item counts; schema diff vs source; row counts on a fixed set of lineage tables; `npm run db:validate`; if RLS applied: catalog policy counts + `rls-verify.sql` on the restored target |
| BG6 Application-level verification | Staging app pointed (temporarily, owner-controlled) at the restored target with synthetic tenants: read + write + tenant-isolation smoke |
| BG7 Required evidence | Backup manifest + checksums, restore log with elapsed time, row-count table, assertion pass/fail summary, operator + UTC timestamps |
| BG8 Rollback & stop conditions | Stop on: restore-target identity mismatch, checksum mismatch, row-count divergence beyond expectation, failed RLS assertions. Response: bar app config from the broken target, restore the pre-change snapshot for affected scope, re-verify before any traffic |

Procedure detail carried forward from Phase 16 §4.2 remains valid; the gates
above make it executable and evidence-checked once staging exists.

---

## 7. Staging RLS activation checklist (summary)

Full gate: `docs/PHASE-17-STAGING-RLS-GO-NO-GO.md`.

| Gate | Item | Status |
|---|---|---|
| G1 | Dedicated staging identity + separation verified | BLOCKED |
| G2 | Backup and restore tested | BLOCKED (prepared, not executed) |
| G3 | PgBouncer Stage A tests passed | BLOCKED (staging unavailable) |
| G4 | Migration + RLS SQL reviewed vs current schema | **PASS** (code-side) |
| G5 | App role `NOSUPERUSER` + `NOBYPASSRLS` on staging | BLOCKED |
| G6 | Tenant isolation passed under actual pooling mode | BLOCKED |
| G7 | Indexes + query plans reviewed | **PASS (design)**; staging re-run pending |
| G8 | Rollback + recovery plan approved | BLOCKED (awaiting owner) |
| G9 | Owner explicit authorization | BLOCKED |

**Overall RLS verdict: `BLOCKED — RLS ACTIVATION NOT AUTHORIZED`.** RLS was not
activated anywhere in this phase.

---

## 8. Remaining blockers and next actions

| # | Blocker | Next action (owner) |
|---|---|---|
| B1 | No dedicated staging environment/identity | OA2 — provision + record identity; run §4.9 prove-staging gate |
| B2 | No staging secrets/config (Supabase keys, `SESSION_SECRET` ≥32 chars) | OA3 — set in staging secret store only |
| B3 | No staging migration applied | OA4 — `prisma migrate deploy` via `DIRECT_URL` after prove-staging |
| B4 | No backup/restore evidence | OA5 — execute BG1–BG8 |
| B5 | All PgBouncer tests `NOT RUN — STAGING UNAVAILABLE` | OA6 — Stage A then Stage B per test plan |
| B6 | RLS gate G1–G3/G5–G6/G8–G9 unmet | OA7 — only after B1–B5 close |
| B7 | CI not enabled; no remote run history | OA1 — approve per checklist §8 |
| B8 | Node 20 CI parity UNVERIFIED | Resolves itself on first CI run (part of OA1) |

Recommended order: OA1 (CI) can proceed independently now; OA2 → OA3 → OA4 →
OA5 → OA6(Stage A) → OA7 (with OA6 Stage B completing G6).

---

## 9. Local preparation vs remotely executed verification

**Executed locally this phase (with evidence):**
git baseline inspection; CI workflow review + 2 narrow hardening edits (local,
untracked); YAML parse validation; five-gate local validation (5× exit 0) +
clean-runner build simulation (exit 0); RLS SQL / tenant-context / session-
secret code review; authoring of four Phase 17 documents.

**Prepared but NOT executed (requires owner approval + staging):**
CI activation and any remote CI run; staging provisioning and identity
verification; any remote database connection, migration, or query; PgBouncer
installation or any pooled test; backup creation or restore; RLS activation;
secret generation/rotation; GitHub settings/branch-protection changes; any
Git write operation (stage/commit/push/merge/reset/checkout/deploy).

No claim of remote CI, staging, PgBouncer, backup, or RLS success is made
anywhere in this phase. Statuses used: `PASS` (local only), `PLAN PREPARED`,
`NOT RUN — STAGING UNAVAILABLE`, `PREPARED — NOT EXECUTED`, `BLOCKED`,
`UNVERIFIED` (Node-20 CI parity).

---

## Final decision

```text
READY FOR OWNER REVIEW — STAGING PLAN PREPARED
```

All locally resolvable preparation is complete: the CI gate is reviewed,
hardened, and validated; the staging specification, PgBouncer test plan,
backup gates, and RLS go/no-go gate are written and internally consistent; all
five local validation gates pass with fresh exit codes. Everything requiring
external resources or approvals is explicitly blocked and itemized (§3, §8).
This decision does **not** authorize staging provisioning, CI activation,
remote database operations, or production release.

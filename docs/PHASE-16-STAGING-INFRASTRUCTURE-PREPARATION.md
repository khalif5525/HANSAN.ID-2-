# HANSAN — PHASE 16: STAGING INFRASTRUCTURE & CI PREPARATION

**Date:** 10/13/2026
**Decision:** `PARTIALLY READY — REQUIRED LOCAL PREPARATION BLOCKED`
**Scope:** Infrastructure discovery, local preparation, and documentation only. No remote database changes, no migrations, no RLS activation, no provisioning, no secret reads/modifies, no Git stage/commit/push/deploy, no system-wide configuration changes.

> All validation exit codes below were captured this session on the current working
> tree. Old phase baselines are NOT reused as evidence for modified files.

---

## 1. Current repository baseline

### 1.1 Git
| Property | Value |
|---|---|
| Branch | `main` |
| HEAD | `1bf82a404fb6a02a12db3d2eb73349403538b934` |
| Upstream | `origin/main` — 0 ahead / 0 behind |
| Staged changes | 0 |
| Modified tracked files | **49** (latest porcelain; prior Phase-13 baseline reported 48) |
| Untracked entries | **73** (docs/ Phase reports, prisma/ SQL artifacts, AppData/, .env, tmp files) |
| Git operations this phase | None (no stage, commit, push, merge, reset, checkout, clean) |

### 1.2 Toolchain & environment
| Item | Value |
|---|---|
| Node | `v24.11.1` |
| npm | `11.6.2` |
| Docker | CLI `29.2.1` present, but **daemon not running** (`docker info` fails to connect to the engine pipe) → containers **not** usable |
| PostgreSQL / pgbouncer binaries | No `psql`, `pg_isready`, or `pgbouncer` executable on PATH |
| `.env` | Present, gitignored, untracked. **NOT read, NOT modified** (may contain local secrets) |
| `node_modules` / `.next` | Present locally (left in place; not cleaned) |

### 1.3 Package scripts (verified from `package.json`)
`dev`, `build` (`next build`), `start`, `lint` (`next lint`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `db:validate` (`prisma validate`), `db:generate` (`prisma generate`), `db:migrate:status` (`prisma migrate status`).

## 2. PgBouncer availability and feasible setup options

Feasibility decision (evidence-backed):
1. **Existing local executable** — NONE. No `pgbouncer` binary found in PATH.
2. **Existing approved container runtime + previously available PgBouncer image** — Docker CLI is installed, but the **daemon is not running**, so no image pull or container run is possible. There is no approved PgBouncer image present.
3. **Later owner-approved installation** — future, **outside this phase** (the phase's safety constraints forbid downloads and system-wide changes).

### Conclusion
**PgBouncer transaction-pooling evidence is BLOCKED in this phase.** A safe, isolated PgBouncer test cannot be executed today without: (a) a running local PostgreSQL cluster, (b) a PgBouncer binary (or an approved image + running daemon), and (c) an owner-approved install step. None of these are available, so no passing claim is made, and none is implied.

### PgBouncer test matrix (documented, pending the prerequisite)

| # | Scenario | Status |
|---|---|---|
| T1 | Sequential transactions reusing pooled connections (different tenants interleaved) | NOT RUN — blocked |
| T2 | Commit clears per-tx GUC (tenant pin does not leak past `COMMIT`) | NOT RUN — blocked |
| T3 | Rollback clears per-tx GUC (no pin leak after `ROLLBACK`) | NOT RUN — blocked |
| T4 | Missing tenant context rejected fail-closed in pooled path | NOT RUN — blocked |
| T5 | Cross-tenant read rejected on a reused connection | NOT RUN — blocked |
| T6 | Failed transaction then connection reuse (pool health + pin recovery) | NOT RUN — blocked |
| T7 | Pool saturation / waiting (if intended config uses `pool_mode = transaction` + `max_client_conn`) | NOT RUN — blocked |

Tie to the intended staging configuration: transaction pooling only applies under Supabase's pooler (`pool_mode = transaction`); this local phase had no pooler to test. The local disposable PG tests (Phase 9/14) run on a **direct** connection and therefore *do not* prove pooled semantics — they only exercised GUC transaction-locality conceptually.

### Prerequisite to unblock (for owner)
Recommend a controlled local PgBouncer install (owner-approved) paired with a disposable PG cluster on a non-default port, then re-run T1–T7 against that pool. Until that is done, `PgBouncer transaction-pooling` remains **UNVERIFIED** and is an open security-verification item for staging.

## 3. CI workflow status and validation

### 3.1 Workflow presence
No `.github/workflows/` directory existed before this phase. A minimal, reviewable draft was created:
- **File:** `.github/workflows/ci.yml`
- **Status:** draft for review only — **NOT enabled**, no repository secrets added, no settings changed, no deployment triggered, no Git commit/push.

The draft follows the repository's actual scripts (`npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run db:validate`, `npm run build`) and pins Node 20 LTS (Next.js 14.2.35 supported LTS lines).

### 3.2 Script correctness check
All invoked commands exist in `package.json` scripts — no invented names.

### 3.3 Secret-free design (fail-safe)
- No step consumes `SUPABASE_SECRET_KEY`, `SESSION_SECRET`, or `DATABASE_URL`.
- `npm run db:validate` is schema-only (`prisma validate`) — no live DB connection.
- The build/typecheck/lint/test steps are static or test-only; they do not need DB secrets.
- The workflow fails fast on the first non-zero exit (GitHub Actions terminates the step).
- The optional `LIVE_DB_URL` input is declared but **unused** — it exists only to leave a documented hook for a future live pre-flight step at owner request.

### 3.4 Local validation (this session, actual exit codes)

| # | Check | Command | Result | Exit code |
|---|---|---|---|---|
| 1 | TypeScript typecheck | `npm run typecheck` | Clean (no errors) | **True (0)** |
| 2 | ESLint | `npm run lint` | No warnings/errors | **True (0)** |
| 3 | Unit tests | `npm test` | **28 test files, 284 passed, 1 skipped (285 total)** | **True (0)** |
| 4 | DB schema validation | `npm run db:validate` | Schema at `prisma/schema.prisma` valid 🚀 | **True (0)** |
| 5 | Production build | `npm run build` | `Compiled successfully` / type check valid | **True (0)** |

Notes: build emitted `- Environments: .env`; a local `.env` (gitignored) exists but was **not read or modified**. A pre-existing disposable PG harness was torn down earlier and is not in the tree; direct-PG RLS evidence from Phases 14/9 is recorded in prior reports but no longer present locally.

## 4. Backup and recovery procedure and execution status

### 4.1 Execution status
**PREPARED — NOT EXECUTED.** No backups were created, no remote DB was connected, and no restore was attempted in this phase.

### 4.2 Written backup/recovery procedure (staging only)
**Backup mechanism & scope**
- Logical: `pg_dump --schema-only` + per-tenant dump of the staging database (catch-all + per-org lineage) — does **not** touch production.
- Physical (optional, owner-approved): `pg_basebackup` of the staging PostgreSQL data directory; full DB plus a `pg_basebackup` manifest with checksums (`pg_checksums`).

**Retention requirements**
- Owner-confirmed. Default proposal: backups retained for N days (e.g., 7–14) for staging, with point-in-time recovery (PITR) window on the pooler/production side per production policy — to be confirmed by owner before execution.

**Restore into an isolated target**
1. Provision an empty isolated DB (new database or disposable cluster on a non-default port).
2. Restore: `pg_restore --clean --if-exists` from the staged dump, or copy the base backup.
3. Apply the committed migration `20261009000000_init` + RLS SQL only on the isolated target.

**Integrity verification after restore**
- `pg_dump --schema` diff vs. source; `SELECT count(*)` on a fixed set of lineage tables; re-run `prisma validate`; re-run `rls-verify.sql` (38 assertions) on the restored target; verify `relrowsecurity=on, relforcerowsecurity=on` for the 15 tenant tables.

**Recovery / rollback procedure**
1. On failed restore/assertion: abort the smoke run.
2. Bar the app config pointer away from the broken target.
3. Restore from the pre-change backup snapshot for the affected tenant/tables only.
4. Re-apply the committed migration (additive, non-destructive) and re-verify RLS assertions before traffic returns.

**Evidence required to demonstrate working restoration**
- Backup manifest (sizes + checksums), restore log with elapsed time, restored row counts, pass/fail summary of post-restore RLS assertions, and the rollback entry for the failed path.

## 5. Staging prerequisite checklist

"Code prep" = artifacts confirmed in the repository. "Infrastructure" = owner-provisioned items, none currently available locally.

| # | Item | Code prep? | Infra? | Status |
|---|---|---|---|---|
| 1 | Dedicated staging database + project identity | yes | BLOCKED | **BLOCKED** (no staging env provisioned) |
| 2 | Separate staging credentials + application config | yes | BLOCKED | **BLOCKED** (no staging credentials; secrets owner-managed) |
| 3 | Session-secret validation (`SESSION_SECRET` set on staging config) | yes | NOT RUN | **NOT RUN** (no staging config materialized; production fails closed without it) |
| 4 | Supabase Auth configuration | yes | BLOCKED | **BLOCKED** (BLOCKER-001 — no staging Supabase project) |
| 5 | Migration execution + rollback plan | yes | ready | **PASS** (1 migration commit; additive/rollback documented) |
| 6 | PgBouncer transaction-pooling test | yes | BLOCKED | **BLOCKED** (no binary/daemon/image; prerequisite absent) |
| 7 | Backup / restore evidence | yes | NOT RUN | **NOT RUN / PREPARED** (written procedure only; not executed) |
| 8 | RLS verification + index review | yes | ready | **PASS** (38/38 RLS assertions on disposable PG; no new `SequenceCounter` index — composite PK covers `outletId`) |
| 9 | Application deployment + smoke test | yes | BLOCKED | **NOT RUN** (no staging app/deployment) |

> Distinction: items 5 and 8 are code-side prerequisites that are **prepared and validated locally**; they are NOT verified in staging. Items 1–4, 6, 9 require owner-provisioned infrastructure. Item 7 is prepared as a procedure only.

---

## 6. Owner approvals still required

| # | Owner action | Notes |
|---|---|---|
| OA1 | Approve the CI workflow draft (`.github/workflows/ci.yml`) and enable it (or provide own) | No secrets involved; script names verified |
| OA2 | Provision a dedicated staging Supabase project (project identity + staging credentials) | BLOCKER-001 |
| OA3 | Configure Supabase Auth for staging (`NEXT_PUBLIC_SUPABASE_URL`, publishable key, `SUPABASE_SECRET_KEY`) | Owner-only; never commit values |
| OA4 | Set a non-empty `SESSION_SECRET` on the staging app configuration | Fails closed (503) without it |
| OA5 | Approve the PgBouncer local install + disposable PG cluster step | Owner-approved installation; unblocks T1–T7 |
| OA6 | Confirm backup/restore retention policy for staging | Owner decision |
| OA7 | Approve applying `prisma/rls-tenant-isolation.sql` + supporting indexes to staging (or keep RLS unapplied) | Owner decision; independent of CI |

---

## 7. Exact remaining blockers

| # | Blocker | Owner gate |
|---|---|---|
| B1 | No isolated staging database / project identity | OA2 (provisioning) |
| B2 | No staging application config / secrets (`SESSION_SECRET`, Supabase keys) | OA3/OA4 |
| B3 | PgBouncer binary + running local daemon + no approved image | OA5 (install/approval) |
| B4 | No backup / restore evidence | OA6 (retention) |
| B5 | No RLS activation on any live environment (SQL reviewed, harness proven 38/38 on disposable PG only) | OA7 |
| B6 | No staging application deployment/daemon to smoke-test | OA2 + OA7 |
| B7 | No CI execution history (workflow drafted but not enabled) | OA1 |

No remaining blocker implies production is ready or staging is available — all item 5/8 pass are code-side validations only.

---

## 8. Recommended next action

1. **Owner reviews this report + the CI draft** (`.github/workflows/ci.yml`) and approves OA1–OA7.
2. On approval, provision the dedicated staging environment (OA2/OA3/OA4), then re-run `npm run typecheck && npm run lint && npm test && npm run db:validate && npm run build` against the newly provisioned config.
3. Install PgBouncer locally (OA5) and execute T1–T7; record evidence in the next phase report.
4. Execute backup/restore procedure (OA6) and capture evidence per §4.2.
5. Apply `prisma/rls-tenant-isolation.sql` + supporting indexes to staging **only after** owner-approved (OA7), then re-run `rls-verify.sql` on staging.
6. Deployment + smoke test for staging app (OA2/OA6) — owner-conducted or owner-supervised.

---

## Decision

```text
PARTIALLY READY — REQUIRED LOCAL PREPARATION BLOCKED
```

Rationale:
- **Code preparation is green:** `typecheck`, `lint`, `test`, `db:validate`, `build` all pass with fresh exit codes; CI draft and backup/restore procedure are written and ready for review.
- **Required local preparation is blocked:** PgBouncer transaction-pooling evidence cannot be produced because no binary/daemon/approved image exists and the Docker daemon is not running. This is a required local verification gap, not an optional nicety.
- **Staging itself is not available:** no dedicated staging DB/project/credentials/config/deployment exist. This report affirms code readiness only; it does **not** imply staging is available or production is ready.


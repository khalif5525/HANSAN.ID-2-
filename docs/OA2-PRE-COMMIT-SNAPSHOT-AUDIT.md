# HANSAN — OA2: PRE-COMMIT SNAPSHOT SAFETY AUDIT

**Date:** 10/13/2026
**Mode:** Audit only. No Git write operation was performed (`git add/commit/push/
merge/reset/clean/stash` all unused); the index is empty and HEAD is unchanged.
No file was modified, deleted, renamed, or created except this report. No `.env`
value was read, printed, or exposed. No remote database, cloud resource, or
GitHub setting was touched. The workflow was **not** activated.

---

## §1 — Executive decision

```text
BLOCKED — SNAPSHOT NOT YET SAFE
```

Primary reason: the proposed CI workflow (`.github/workflows/ci.yml`) will
**fail its `db:validate` step on a clean GitHub runner**. `prisma validate`
requires the `DATABASE_URL` and `DIRECT_URL` environment variables to be
present (empirically proven: P1012, §5/§6), but a clean checkout has no
`.env` (gitignored) and the workflow sets no environment variables. OA1's
clean-runner simulation exercised only `npm run build`, not
`npm run db:validate`, so this defect was not caught then. A narrow,
evidence-based correction to the workflow (supply safe, non-secret placeholder
`DATABASE_URL`/`DIRECT_URL` to the `db:validate` step) must be applied **before**
the activation commit. Per OA2 rules this audit did **not** modify the workflow
or `package.json`.

Secondary: the snapshot requires careful staging because it mixes real source
with large local artifacts (`AppData/` = 1684 binary files / 72.4 MB) and
convenience temp files (`tmp_*`, `flaky_run_*.txt`) that must be excluded, and
`.gitignore` does not currently ignore them (§7).

---

## §2 — Repository baseline

| Property | Value |
|---|---|
| Branch | `main` (only branch) |
| HEAD | `1bf82a404fb6a02a12db3d2eb73349403538b934` — "fix: resolve Next.js page export build error" |
| Upstream | `origin/main` — 0 ahead / 0 behind |
| Staged (index) | **Empty** (`git diff --cached` = no output) |
| Modified tracked files | **49** |
| Untracked entries | **80** (porcelain `??` lines) |
| Untracked real files (excluding `AppData/`) | **98** |
| `AppData/` | 1684 files, **72.4 MB** — the Phase 14 disposable PostgreSQL cluster (`hansan_pg_p14`), binary PG data + WAL |
| Tracked deleted | 0 |
| Total candidate files audited | **147** (49 modified + 98 untracked real) |

Prior reports present and untracked: Phase 8–17 + OA1 markdown under `docs/`.
The workflow `.github/workflows/ci.yml` is untracked (2778 bytes).

---

## §3 — OA1 consistency

**Still valid from OA1:**
- Workflow triggers (`pull_request → [main]` + input-free `workflow_dispatch`),
  explicit `permissions: contents: read`, Node 20 pin, `npm ci` from lockfile,
  the five npm script names (all present in the working-tree `package.json`),
  no deploy/migrate/DB steps, secret-free design.
- Index empty, HEAD unchanged, upstream sync.

**Changed since OA1:** nothing in the working tree. Only this new report file
was added. The five local gates remain reproducible (§6).

**Newly discovered inconsistency (OA1 did not catch):**
- OA1 §1.4 concluded the first remote run is safe and listed `db:validate` as
  "schema-only (no DB)". That is true about *connection* (it never connects)
  but **false about environment**: `prisma validate` still resolves `env()`
  and fails with **P1012** when `DATABASE_URL`/`DIRECT_URL` are absent. On a
  clean runner both are absent → the workflow fails at step 7. This downgrades
  OA1's "READY FOR EXPLICIT OWNER APPROVAL" to the BLOCKED status above until
  the workflow is corrected.
- OA1's §5 OB3 dependency (HEAD `package.json` lacks `db:validate`;
  `prisma/schema.prisma` untracked) is **confirmed and expanded** in §5 below.

---

## §4 — File-by-file audit

Legend — Category: `RFC` = Required for CI · `RAS` = Required application/security
change · `DOC` = Documentation · `ART` = Local artifact (exclude) · `SENS` =
Sensitive/unsafe (block) · `UNREV` = Unrelated/unreviewed (block until reviewed).
"Full?" = reviewed line-by-line this session (Y/N) — coverage note at end of §4.

### 4a. Modified tracked files (49) — all belong in the application/security commit

| Path | Cat | Purpose | Full? | Commit? |
|---|---|---|---|---|
| `.env.example` | RAS | Placeholder env template (names only, no secret values) | Y | yes |
| `.eslintrc.json` | RFC/RAS | Adds `no-restricted-imports` guard blocking `@/server/*` + `server-only` from browser code (`src/lib`, `src/components`) | Y | yes |
| `.gitignore` | RFC | Adds `/screenshots/`, `dist/`, `*.key`, `credentials*`, `secrets*`, and `!src/server/config/secrets.ts` negation | Y | yes |
| `package-lock.json` | RFC | Lockfile; verified in sync (`npm ci --dry-run` exit 0) | scan | yes |
| `package.json` | RFC | Adds `db:validate`/`db:generate`/`db:migrate:status` scripts + `@prisma/client`, `@supabase/ssr`, `@supabase/supabase-js`, `server-only`, `prisma` deps | Y | yes |
| `prisma/.gitkeep-note.md` | DOC | Note explaining the prisma dir | Y | yes (harmless) |
| `src/app/finance/transactions/page.tsx` | RAS | Finance UI wiring | diff | yes |
| `src/app/hq/*` (11 pages: analytics, catalog, customers, finance, inventory, marketing, operations, purchasing, reports, settings, workforce) | RAS | HQ workspace UI wiring | diff | yes |
| `src/app/kds/{page,bar/page}.tsx`, `src/app/login/page.tsx`, `src/app/pos/history/page.tsx` | RAS | KDS / login / POS-history UI | diff | yes |
| `src/components/layout/header.tsx`, `src/components/ui/{badge,button,card,empty-state,icon-button,index}.tsx` | RAS | UI components | diff | yes |
| `src/config/environment.ts` | RAS | Config boundary (Supabase/DB/session reads; never throws at import; server secrets excluded) | Y | yes |
| `src/config/routes.ts` | RAS | Route contract | diff | yes |
| `src/domain/{audit/events,authz/rbac,finance/service,kds/service,pos/lifecycle,pos/service,shared/errors,shared/ids,shared/ports}.ts` (9) | RAS | Domain logic + RBAC + port contracts (security-relevant) | diff + tests | yes |
| `src/lib/dev-session.ts` | RAS | Dev/demo session helper | diff | yes |
| `src/styles/tokens.css`, `tailwind.config.ts` | RAS | Styling/tokens | diff | yes |
| `tests/{analytics,audit-rate-limit,customers,finance-service,inventory}.test.ts`, `tests/helpers/memory.ts` (6) | RAS | Test updates (domain + security) | diff | yes |

No modified tracked file is a secret or an artifact; all are coherent project
source/config required to build/typecheck/test.

---

### 4b. Untracked source/config/test/SQL (required — must be committed)

| Path | Cat | Purpose | Full? |
|---|---|---|---|
| `prisma/schema.prisma` | RFC | 19-model tenant-aware schema; datasource `url=env("DATABASE_URL")`, `directUrl=env("DIRECT_URL")` | Y (datasource+rules) |
| `prisma/migrations/20261009000000_init/migration.sql`, `prisma/migrations/migration_lock.toml` | RFC | Init migration (19 tables) + lock (`provider="postgresql"`); read by `prisma-schema.test.ts` | Y (lock) / scan |
| `prisma/rls-tenant-isolation.sql` | RAS | 238-line additive fail-closed RLS (ENABLE+FORCE + `current_setting(key,false)` policies) | header+struct |
| `prisma/rls-demo-isolation.sql`, `prisma/rls-verify.sql`, `prisma/guc-impersonation-probe.sql` | RAS | Superseded demo RLS; 38-assertion harness; GUC impersonation probe | scan |
| `src/middleware.ts` | RAS | Fail-closed auth gate (503 no-secret / 401 no-session) + workspace role routing | Y |
| `src/server/session.ts`, `authz.ts`, `audit.ts`, `compose.ts`, `runtime.ts`, `idempotency.ts`, `order-response.ts`, `orders-create.ts` | RAS | Session/authz/runtime server layer | Y (session, authz) / scan |
| `src/server/config/secrets.ts` | RAS | Server-only secret accessor; null-when-absent, fail-closed | Y |
| `src/server/auth/{admin-guard,live-session,provisioning,revalidate}.ts` | RAS | Provisioning guard (constant-time, fail-closed 503), live session + revalidation | Y (admin-guard) / scan |
| `src/server/db/{audit-adapter,catalog-adapter,client,idempotency-adapter,memory-store,orders-adapter,payment-adapter,rls-coverage-matrix,tenant-context,tenant-isolation-design}.ts` | RAS | DB adapters + tenant context (scoped callers) | Y (tenant-context, matrix) / scan |
| `src/server/supabase/{admin,server}.ts` | RAS | Privileged admin + server Supabase clients (fail-closed; server-only) | Y (admin) / scan |
| `src/lib/supabase/client.ts` | RAS | Browser Supabase client (publishable key only) | Y |
| `src/config/tax.ts`, `src/domain/kds/aggregate.ts`, `src/domain/shared/tenant-scope.ts` | RAS | Tax config, KDS aggregate, tenant-scope helper | scan |
| `src/app/api/admin/{provision-developer,provision-owner}/route.ts` | RAS | Provisioning routes (secret-gated) | scan |
| `src/app/api/auth/{live,session,sign-in,signout}/route.ts` | RAS | Auth routes | scan |
| `src/app/api/orders/route.ts`, `orders/[id]/route.ts`, `src/app/api/staff/invite/route.ts` | RAS | Business API routes (authz-scoped) | scan |
| `src/app/finance/settlement/page.tsx`, `src/components/modules/kds/ticket-board.tsx`, `src/components/ui/list-toolbar.tsx` | RAS | New UI | scan |
| `tests/*` (19 untracked test files) + `tests/helpers/env.ts` | RFC | Unit/security tests (285 pass locally; hermetic, no DB) | scan |
| `.github/workflows/ci.yml` | RFC | CI gate — **needs `db:validate` env correction** (§1/§5) | Y |

### 4c. Documentation (20 files) — separate documentation commit

`docs/{AUTOPILOT-PHASE-REPORT,FINAL-HANDOFF-20261011,OA1-CI-ACTIVATION-REVIEW,
PHASE-8-TENANT-ISOLATION-REPORT,PHASE-9-POSTGRES-SECURITY-REPORT,
PHASE-10-BACKEND-HARDENING-REPORT,PHASE-11-RLS-ACTIVATION-READINESS,
PHASE-12-SCOPED-CALLERS-REPORT,PHASE-13-STAGING-SECURITY-READINESS,
PHASE-14-LOCAL-SECURITY-HARNESS-REPORT,PHASE-15-INDEX-AND-PGBOUNCER-REPORT,
PHASE-16-STAGING-INFRASTRUCTURE-PREPARATION,PHASE-17-CI-ACTIVATION-CHECKLIST,
PHASE-17-PGBOUNCER-STAGING-TEST-PLAN,PHASE-17-STAGING-READINESS-AND-CI-ACTIVATION-PLAN,
PHASE-17-STAGING-RLS-GO-NO-GO,PRODUCTION-READINESS,STAGING-CHECKLIST}.md`
— Cat `DOC`. Reviewed by secret scan (0 secrets). Historical reports; safe but
not required for CI. Excluded from the CI commit to keep it minimal.

### 4d. Local artifacts — EXCLUDE (never commit)

| Path | Cat | Evidence |
|---|---|---|
| `AppData/` (1684 files, 72.4 MB) | ART | Phase 14 disposable PostgreSQL cluster (`hansan_pg_p14`): binary PG relations, `pg_wal` segments, `pg_control`. Machine-specific, non-source |
| `tmp_explain_order.sql`, `tmp_explain_orderitem.sql`, `tmp_explain_recipeitem.sql`, `tmp_explain_seqcounter.sql` | ART | Ad-hoc EXPLAIN scratch queries |
| `tmp_explain_recipeitem.out.txt`, `tmp_explain_seqcounter.out.txt`, `tmp_indexes.out.txt` | ART | EXPLAIN/catalog output captures |
| `flaky_run_1.txt`, `flaky_run_2.txt`, `flaky_run_3.txt` | ART | Local test-run logs (owner said do not delete; but do not commit) |

### 4e. Sensitive/unsafe — BLOCK · 4f. Unrelated/unreviewed — BLOCK

- **SENS: none found.** Secret scan (private keys, JWTs, `sb_secret_`,
  AWS/GitHub tokens, credential-bearing `://user:pass@` URLs) returned 0 real
  secrets across all 147 candidates. The only 4 `sb_secret_` hits are
  deliberate **fake** test fixtures (`sb_secret_SENTINEL_VALUE`,
  `sb_secret_present`) asserting the secret is *not* exposed — safe.
- **UNREV: none.** Every candidate maps to application, schema, tests, config,
  CI, docs, or artifact. No unrelated stray file was found. (Lower-risk files
  are line-"scan"-reviewed per the §4 coverage note, not blocked.)

---

## §5 — OB3 dependency analysis

### 5a. The five CI commands vs candidate `package.json`

| Step | Command | Script in working-tree `package.json` | At HEAD |
|---|---|---|---|
| Install | `npm ci` | n/a (lockfile) | n/a |
| 1 | `npm run typecheck` | `tsc --noEmit` | present |
| 2 | `npm run lint` | `next lint` | present |
| 3 | `npm test` | `vitest run` | present |
| 4 | `npm run db:validate` | `prisma validate` | **MISSING** |
| 5 | `npm run build` | `next build` | present |

The working-tree `package.json` supplies all five; HEAD's lacks `db:validate`
(OA1 finding, re-confirmed). `db:generate`/`db:migrate:status` exist but are
not invoked by CI.

### 5b. `db:validate` dependency tree — and the clean-checkout defect

`prisma validate` needs: `prisma/schema.prisma` (**untracked**; datasource
`url=env("DATABASE_URL")`, `directUrl=env("DIRECT_URL")`); the `prisma`
devDependency (installed by `npm ci`); and **both env vars present as non-empty
values** (never used to connect — validate is schema-only — but Prisma resolves
`env()` and errors when absent).

**Empirical proof (this session; cwd and schema dir both free of `.env`; no env
vars):** a minimal `url=env("DATABASE_URL")` probe → `P1012 Environment variable
not found: DATABASE_URL`; the real `prisma/schema.prisma` → `P1012 Environment
variable not found: DIRECT_URL`. Both fail.

**Consequence:** on a clean GitHub runner (no `.env`, no workflow env) the
`db:validate` step **fails**. Minimal correction (to be applied by owner/next
phase, **not** by this audit) — give the step safe placeholder env:

```yaml
      - name: Prisma DB schema validation (schema-only, no DB)
        run: npm run db:validate
        env:
          DATABASE_URL: "postgresql://user:pass@localhost:5432/hansan"
          DIRECT_URL: "postgresql://user:pass@localhost:5432/hansan"
```

`prisma validate` only checks the URL is syntactically valid; it never connects,
so placeholders keep the workflow secret-free.

### 5c. Minimum coherent file set for a reproducible clean-checkout CI run

| Area | Paths | Why needed |
|---|---|---|
| Manifest + lock | `package.json`, `package-lock.json` | `npm ci`, all scripts |
| CI definition | `.github/workflows/ci.yml` | the gate |
| Build/lint/ts config | `tsconfig.json`, `.eslintrc.json`, `next.config.*`, `tailwind.config.ts`, `postcss.config.*` | tsc/lint/build |
| App source | entire `src/**` + `public/**` (tracked-modified + untracked) | compile/typecheck/test/build |
| Prisma | `prisma/schema.prisma`, `prisma/migrations/**` | `db:validate`; `prisma-schema.test.ts` + `tenant-isolation.test.ts` read them from disk |
| Tests | `tests/**` | `npm test` |
| db:validate env | placeholder `DATABASE_URL`/`DIRECT_URL` in workflow `env:` | **not a file** — workflow fix (§5b) |

**Categories:** CI-execution set = table above + env fix. Application/security
release set = identical (the app source, schema, migrations, tests ARE the
release). Documentation-only = `docs/**` (20 reports; not needed by CI).
Unnecessary artifacts = `AppData/`, `tmp_*`, `flaky_run_*.txt` (never needed).

**Commit status of CI-critical files:** `package.json`/`package-lock.json` =
tracked-modified; `prisma/schema.prisma`, `prisma/migrations/**`, `tests/**`,
`src/server/**`, `.github/workflows/ci.yml` = **untracked (must be added)**;
`tsconfig.json`, `next.config.*`, `postcss.config.*`, `public/**` = already
tracked & unmodified.

A complete, safe candidate snapshot **can** be assembled — but it is not yet
*executable* on CI until the §5b workflow env fix is applied. BLOCKED therefore
reflects a missing workflow correction, not a missing file.

---

## §6 — Validation evidence

No relevant file changed since OA1's five-gate run except added report docs
(out of gate scope), so prior evidence remains valid; one NEW check (clean-
checkout `prisma validate`) was run because it had never been tested.

| # | Check | Command | Evidence source / freshness | Result |
|---|---|---|---|---|
| 1 | TypeScript | `npm run typecheck` | OA1 same-session run; src unchanged since | PASS — valid prior evidence; relevant files unchanged |
| 2 | Lint | `npm run lint` | OA1 same-session run; src unchanged since | PASS — valid prior evidence; relevant files unchanged |
| 3 | Tests | `npm test` | OA1 run: 28 files, 285 passed, 0 skipped | PASS — valid prior evidence; relevant files unchanged |
| 4 | Schema (with `.env` present) | `npm run db:validate` | OA1 run exit 0 (local, `.env` loaded) | PASS — locally reproduced earlier |
| 4b | Schema (clean-checkout sim) | `prisma validate` — no env, no `.env` (cwd + schema dir isolated) | **new probe this session** | **FAIL — reproduced failure (P1012 DIRECT_URL / DATABASE_URL not found)** |
| 5 | Build | `npm run build` | OA1 clean-runner sim exit 0 (env blanked) | PASS — valid prior evidence; src unchanged since |
| 6 | Lockfile consistency | `npm ci --dry-run` | OA1 run: "up to date", exit 0 | PASS — valid prior evidence; lockfile unchanged since |
| 7 | Workflow YAML | `node` + local `js-yaml` parse | re-parsed this session | PASS — freshly reproduced (triggers/permissions/steps confirmed) |

Exit codes: gates 1–3, 5, 6 = 0 (OA1, this working tree); gate 4 (local with
`.env`) = 0; gate 4b (clean-checkout) = **non-zero (P1012)**. No check was
reported passing without evidence. The single FAIL (4b) is the blocker driver.
No destructive or file-rewriting command was run; the clean-checkout probe used
a throwaway schema in the OS temp dir (outside the repo), which was deleted
afterward.

---

## §7 — Security findings

- **Secrets/credentials:** none committed. Automated scan across all 147
  candidates (private keys, JWTs, `sb_secret_`, `AKIA`, `ghp_`, `sk-`,
  credential-bearing `://user:pass@` URLs) → 0 real secrets. The 4 `sb_secret_`
  hits are deliberate **fake** test fixtures (`sb_secret_SENTINEL_VALUE`,
  `sb_secret_present`) that assert the secret is *not* exposed. `.env` is
  gitignored and was never read for values (only variable names inventoried).
- **Environment config:** `.env.example` holds placeholders only;
  `src/config/environment.ts` never reads/exposes `SUPABASE_SECRET_KEY`;
  server secrets live only in `src/server/config/secrets.ts` (server-only,
  null-when-absent). `.eslintrc.json` hardens this by banning `@/server/*` and
  `server-only` imports from `src/lib`/`src/components` (client bundle).
- **Tenant isolation / RLS:** `prisma/rls-tenant-isolation.sql` is additive
  (ENABLE+FORCE + policies), fail-closed via
  `current_setting('app.*', false)` (missing GUC throws → no fail-open). Not
  applied to any live DB. `tenant-context.ts` pins GUCs with `SET LOCAL` in the
  same transaction. No relaxation found.
- **Authentication:** `middleware.ts` + `authz.ts` fail closed (503 when
  `SESSION_SECRET` missing, 401 no/invalid session, 403 role/tenant/outlet).
  Session secret ≥32 chars enforced; CSRF Origin check present.
- **Authorization / privileged access:** provisioning routes are gated by
  `assertProvisionSecret` (constant-time; 503 when unconfigured); admin
  Supabase client is server-only and throws when secret missing; RBAC +
  organization/outlet scoping enforced in `authz.ts`.
- **No guard disabled / no security relaxation** observed in any diff.
- **Artifact/secret-leak risk (non-secret):** `.gitignore` does **not** ignore
  `AppData/`, `tmp_*`, or `flaky_run_*.txt`. A blanket `git add .` would stage
  72.4 MB of PG binaries and scratch files. Not a secret leak, but a repo-hygiene
  and review-safety risk → recommend the owner add these to `.gitignore` in the
  application commit (owner action; not done here per audit-only rule).
- **Machine-specific paths:** none found in committed source; the disposable-PG
  cluster lives only under the ignored `AppData/` path.

Confirmed findings vs assumptions: the above are confirmed by direct file
inspection and scanning. The only assumption (clearly labeled): lower-risk
files were scan-reviewed, not every line read (§4 coverage note).

---

## §8 — Proposed commit plan

Smallest safe, coherent structure — 3 commits, in dependency order. **This is a
proposal only; no staging/commit was performed.**

**Commit 1 — Application/security + schema + tests + configs (the validated tree).**
Includes: all 49 modified tracked files; all untracked `src/**`, `prisma/**`
(schema + migrations + RLS SQL), `tests/**`, `package.json`,
`package-lock.json`, `.eslintrc.json`, `.gitignore`, `.env.example`,
`tailwind.config.ts`, and (optional) `prisma/.gitkeep-note.md`.
Rationale: these together make typecheck/lint/test/build/db:validate pass and
constitute the actual application/security release. Excludes all artifacts and
docs. **Prerequisite:** apply the §5b `db:validate` env fix (in Commit 2's
workflow, or a temporary env) so CI is green; and ideally extend `.gitignore`
for `AppData/`, `tmp_*`, `flaky_run_*.txt` before any `git add .`.

**Commit 2 — CI workflow (the activation commit).**
Includes: `.github/workflows/ci.yml` **with the §5b placeholder-env correction**
applied. Depends on Commit 1 being on `main` first (so the scripts/schema it
invokes exist). This is the file the owner pushes to activate CI; it must land
only after Commit 1 merges and the five gates are re-verified on the exact tree.

**Commit 3 — Documentation (optional, independent).**
Includes: the 20 `docs/*.md` reports. No dependency on CI; can land any time.

**Excluded entirely (never commit):** `AppData/` (1684 files/72.4 MB PG
cluster), `tmp_*.sql`/`tmp_*.out.txt` (7 files), `flaky_run_*.txt` (3 files).

**Review gates before each commit:**
- Before Commit 1: secret scan re-run clean; five gates green on the tree.
- Before Commit 2: §5b fix applied; a one-time owner-approved CI run observed
  green (this is the OA1 activation step, deferred until the fix exists).
- Commit 3: none beyond the existing secret scan.

Note: Commit 1 alone does not activate CI (no workflow file). CI activates only
when Commit 2 reaches `main` (OA1 §1.7 dependency).

---

## §9 — Blockers and next action

| # | Blocker | Severity | Smallest safe resolution |
|---|---|---|---|
| OB-1 | `npm run db:validate` fails on a clean CI checkout (P1012; `DATABASE_URL`/`DIRECT_URL` absent). Proven this session against both a probe schema and the real `prisma/schema.prisma` | **Hard — fails first CI run** | Add placeholder `env: DATABASE_URL/DIRECT_URL` to the workflow `db:validate` step (§5b). Owner/next phase applies it; OA2 did not |
| OB-2 | Activation commit must include untracked `prisma/schema.prisma`, `prisma/migrations/**`, `tests/**`, `src/server/**`, `.github/workflows/ci.yml` — HEAD lacks them (OA1 OB3, re-confirmed) | Hard (sequencing) | Follow §8 Commit 1 → 2 order; do not push `ci.yml` alone |
| OB-3 | `.gitignore` does not ignore `AppData/`, `tmp_*`, `flaky_run_*.txt` → blanket `git add .` would stage 72.4 MB PG binaries + scratch | Medium (repo hygiene / review safety) | Owner adds these to `.gitignore` before staging; then exclude |
| OB-4 | Lower-risk files scan-reviewed, not line-read (§4 coverage note) | Low (disclosure) | Optional full read before Commit 1; no blocker found |

**Smallest safe next action (owner):** apply the OB-1 one-line workflow env fix,
extend `.gitignore` per OB-3, then re-run the five gates on the exact tree and
re-request OA1 activation approval. Nothing in this audit requires or triggers
a Git write; all blockers are owner/next-phase actions.

---

## §10 — Final decision rationale

Decision: `BLOCKED — SNAPSHOT NOT YET SAFE`.

Why this follows from the evidence:
1. The snapshot's **file set is complete and safe** — 147 candidates audited,
   0 secrets, sound auth/RLS/privileged-access design, artifacts identified for
   exclusion (§4, §7). This alone would support "READY FOR OWNER REVIEW".
2. **However**, the snapshot embeds a CI workflow that provably **fails on its
   first run**: the `db:validate` step errors with P1012 on a clean checkout
   because `DATABASE_URL`/`DIRECT_URL` are absent and the workflow sets none
   (§5b, §6 gate 4b — freshly reproduced). A snapshot whose CI gate cannot pass
   is not "safe" to activate, even though every application file is fine.
3. The defect is narrow and known (add placeholder env to one step), but OA2 is
   an audit phase and must not modify the workflow — so it remains uncorrected
   and therefore blocking.
4. This is not "AUDIT INCOMPLETE": the baseline, OB3 dependency, security
   review, and reproducibility were all established with evidence; the one
   partial-coverage area (line-scan vs full-read of lower-risk files) is
   disclosed and introduces no blocker.

The snapshot becomes READY the moment OB-1 (and OB-2/OB-3 sequencing) are
addressed by the owner. Until then, no activation, staging, or push should
occur — consistent with the audit's stop condition.

---

*Prepared in audit mode. No Git write, no file modification (except this
report), no `.env` value read or exposed, no remote DB/cloud/GitHub access, no
CI activation. Clean-checkout probe used a throwaway schema in the OS temp dir
(outside the repository), deleted afterward.*

---

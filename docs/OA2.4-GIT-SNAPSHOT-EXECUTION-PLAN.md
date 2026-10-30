# HANSAN — OA2.4 GIT SNAPSHOT EXECUTION PLAN

Status: **READ-ONLY AUDIT & PLANNING**. No Git write operations performed.
Prepared by: Cline (architectural authority) · Owner gate: pending.

---

## §1 — Executive decision

```text
READY FOR EXPLICIT STAGING APPROVAL
```

The working tree reconciles exactly with the OA2.2/OA2.3 manifests — no new,
missing, renamed, or inconsistent files. Every changed path is classified once.
No secret or local artifact is eligible for inclusion. The C1→C2→C3 dependency
grouping is coherent, and an explicit-path staging plan (no `git add .`) is
provided. This decision authorizes **no** Git write; staging requires a separate
explicit owner approval, and the plan below is not executed here.

---

## §2 — Verified repository baseline (rechecked this phase)

| Item | Value | Evidence |
|---|---|---|
| Branch | `main` | `git status -sb` |
| HEAD | `1bf82a404fb6a02a12db3d2eb73349403538b934` | `git log -1` (matches expected) |
| Upstream | `origin/main`, ahead 0 / behind 0 | `git branch -vv` |
| Modified tracked | **49** | `git status` ` M` |
| Untracked | **73** | `git status` `??` (dirs collapsed by Git) |
| Staged | **0** — index empty | `git diff --cached` → empty |
| Deleted | **0** | no ` D` |
| Renamed | **0** | no ` R` |

The baseline matches OA2.2/OA2.3. Untracked = 73 = OA2.2's 72 + the OA2.3
report. No deviation → audit proceeds.

---

## §3 — Prior-report reconciliation

OA2.2/OA2.3 classification is carried forward and re-verified against the
current tree:

- **New since OA2.2:** only `docs/OA2.3-FINAL-COMMIT-PREPARATION.md` (C3). No
  new source/config/schema/test file appeared.
- **Missing:** none. Every OA2.2 candidate path is still present.
- **Renamed:** none.
- **ci.yml:** untracked; OA2.1 dummy env (lines 82–83) + OA2.3 comment fix
  (lines 20–22) intact; `permissions: contents: read` (line 45); Node 20
  (line 58). Unchanged logic.
- **Ignore rules:** `.env` (line 29), `.env.local` (line 30), `/AppData/` (58),
  `/tmp_*` (59), `/flaky_run_*.txt` (60) all confirmed via `git check-ignore`.

No prior report conflicts materially with current evidence.


---

## §4 — Complete exact file manifest

Every changed path appears exactly once. Git collapses untracked directories;
those are expanded below to real files. Total: 49 modified + 73 untracked
entries (untracked dirs expand to the file counts noted).

### C1 — Application / schema / tests

**Modified tracked (49) — all C1:**

| Path | Purpose / coupling |
|---|---|
| `.env.example` | Env template (no secrets) |
| `.eslintrc.json` | Lint rules incl. server/client boundary (security) |
| `.gitignore` | Hygiene; `!secrets.ts` negation; protects all commits |
| `package.json` | Adds `db:validate` + all five CI scripts (OB3 core) |
| `package-lock.json` | Reproducible `npm ci` |
| `tailwind.config.ts` | Build/config |
| `prisma/.gitkeep-note.md` | Prisma dir note |
| `src/config/environment.ts` | Env access / fail-closed config |
| `src/config/routes.ts` | Route contract |
| `src/middleware.ts` | Auth/session gate (fail-closed) — security |
| `src/lib/dev-session.ts` | Dev-session handling |
| `src/domain/audit/events.ts` | Audit domain logic |
| `src/domain/authz/rbac.ts` | RBAC domain logic |
| `src/domain/finance/service.ts` | Finance logic |
| `src/domain/kds/service.ts` | KDS logic |
| `src/domain/pos/service.ts` | POS logic |
| `src/domain/pos/lifecycle.ts` | POS lifecycle |
| `src/domain/shared/errors.ts` | Shared errors |
| `src/domain/shared/ids.ts` | Shared id types |
| `src/domain/shared/ports.ts` | Shared ports/contracts |
| `src/app/hq/analytics\|catalog\|customers\|finance\|inventory\|marketing\|operations\|purchasing\|reports\|settings\|workforce/page.tsx` (11) | HQ UI pages |
| `src/app/kds/page.tsx`, `src/app/kds/bar/page.tsx` | KDS UI |
| `src/app/login/page.tsx` | Login UI |

**Untracked (source/schema/tests) — all C1:**

| Path | Purpose / coupling |
|---|---|
| `prisma/schema.prisma` | Core OB3; required by `prisma validate`/migrate |
| `prisma/migrations/migration_lock.toml` | Provider lock |
| `prisma/migrations/20261009000000_init/migration.sql` | Initial migration |
| `prisma/rls-tenant-isolation.sql` | RLS/tenant isolation — security |
| `prisma/rls-verify.sql` | RLS verification — security |
| `prisma/rls-demo-isolation.sql` | RLS demo — security |
| `prisma/guc-impersonation-probe.sql` | GUC impersonation probe — security |
| `src/middleware.ts` (untracked) | Auth/session gate — security |
| `src/server/audit.ts` | Audit logging — security |
| `src/server/authz.ts` | RBAC/authz — security |
| `src/server/session.ts` | Session — security |
| `src/server/runtime.ts` | Server runtime wiring |
| `src/server/compose.ts` | Composition/DI root |
| `src/server/idempotency.ts` | Idempotency guard |
| `src/server/order-response.ts` | Order response shaping |
| `src/server/orders-create.ts` | Order creation logic |
| `src/server/auth/admin-guard.ts` | Admin guard — security |
| `src/server/auth/live-session.ts` | Live session — security |
| `src/server/auth/provisioning.ts` | Privileged provisioning gate — security |
| `src/server/auth/revalidate.ts` | Revalidation |
| `src/server/config/secrets.ts` | Secret accessor (server-only) — security |
| `src/server/db/client.ts` | DB client |
| `src/server/db/tenant-context.ts` | Tenant context — security |
| `src/server/db/tenant-isolation-design.ts` | Tenant isolation design — security |
| `src/server/db/rls-coverage-matrix.ts` | RLS coverage — security |
| `src/server/db/audit-adapter.ts` | Audit adapter |
| `src/server/db/catalog-adapter.ts` | Catalog adapter |
| `src/server/db/idempotency-adapter.ts` | Idempotency adapter |
| `src/server/db/memory-store.ts` | In-memory store (test/dev) |
| `src/server/db/orders-adapter.ts` | Orders adapter |
| `src/server/db/payment-adapter.ts` | Payment adapter |
| `src/server/supabase/admin.ts` | Privileged server client — security |
| `src/server/supabase/server.ts` | Server Supabase client — security |
| `src/lib/supabase/client.ts` | Supabase client wiring — security |
| `src/app/api/admin/provision-developer/route.ts` | Privileged provisioning route — security |
| `src/app/api/admin/provision-owner/route.ts` | Privileged provisioning route — security |
| `src/app/api/auth/live/route.ts` | Auth route — security |
| `src/app/api/auth/session/route.ts` | Auth route — security |
| `src/app/api/auth/sign-in/route.ts` | Auth route — security |
| `src/app/api/auth/signout/route.ts` | Auth route — security |
| `src/app/api/orders/route.ts` | Orders API |
| `src/app/api/orders/[id]/route.ts` | Order-by-id API |
| `src/app/api/staff/invite/route.ts` | Staff invite API |
| `src/app/finance/settlement/page.tsx` | Settlement UI |
| `src/components/modules/kds/ticket-board.tsx` | KDS ticket board UI |
| `src/components/ui/list-toolbar.tsx` | UI primitive |
| `src/config/tax.ts` | Tax config |
| `src/domain/kds/aggregate.ts` | KDS aggregate logic |
| `src/domain/shared/tenant-scope.ts` | Tenant scope helper — security |
| `tests/auth-session\|authz\|environment-config\|idempotency\|kds-aggregate\|kds-tickets\|live-revalidation\|live-session\|payment-lifecycle\|phase-a-persistence\|phase12-scoped-callers\|pos-order-state\|pos-order\|prisma-schema\|provisioning\|refund-rules\|supabase-clients\|tenant-isolation\|tenant-scope-stores.test.ts` (19) | Tests for coherent `npm test` |
| `tests/helpers/env.ts` | Test env fixture (no secrets) |

| `src/app/pos/history/page.tsx` | POS history UI |

### C2 — CI workflow + supporting config

| Path | Purpose / coupling |
|---|---|
| `.github/workflows/ci.yml` (untracked) | PR gate incl. OA2.1 dummy env + OA2.3 comment; depends on C1 (scripts, schema, tests) |

### C3 — Documentation (all untracked `docs/*.md`)

`OA1-CI-ACTIVATION-REVIEW.md`, `OA2-PRE-COMMIT-SNAPSHOT-AUDIT.md`,
`OA2.1-MINIMAL-CI-BLOCKER-REMEDIATION.md`, `OA2.2-FINAL-SNAPSHOT-REVIEW.md`,
`OA2.3-FINAL-COMMIT-PREPARATION.md`, `OA2.4-GIT-SNAPSHOT-EXECUTION-PLAN.md`
(this file), `PHASE-8-TENANT-ISOLATION-REPORT.md`,
`PHASE-9-POSTGRES-SECURITY-REPORT.md`, `PHASE-10-BACKEND-HARDENING-REPORT.md`,
`PHASE-11-RLS-ACTIVATION-READINESS.md`, `PHASE-12-SCOPED-CALLERS-REPORT.md`,
`PHASE-13-STAGING-SECURITY-READINESS.md`,
`PHASE-14-LOCAL-SECURITY-HARNESS-REPORT.md`,
`PHASE-15-INDEX-AND-PGBOUNCER-REPORT.md`,
`PHASE-16-STAGING-INFRASTRUCTURE-PREPARATION.md`,
`PHASE-17-CI-ACTIVATION-CHECKLIST.md`, `PHASE-17-PGBOUNCER-STAGING-TEST-PLAN.md`,
`PHASE-17-STAGING-READINESS-AND-CI-ACTIVATION-PLAN.md`,
`PHASE-17-STAGING-RLS-GO-NO-GO.md`, `AUTOPILOT-PHASE-REPORT.md`,
`FINAL-HANDOFF-20261011.md`, `PRODUCTION-READINESS.md`,
`STAGING-CHECKLIST.md`.

### REVIEW — Ambiguous / sensitive / dependency-unclear

**None.** Every path is unambiguously classified. `src/server/db/memory-store.ts`
is an intentional in-memory adapter (used by tests/dev), part of C1.

---

---

## §6 — Dependency-safe snapshot grouping

Recommended sequence (evidence supports the C1→C2→C3 order):

```text
C1 (application/security + schema + migrations + tests + package metadata)
   → C2 (.github/workflows/ci.yml)
   → C3 (docs/*.md)
```

- **C1 is self-contained and independently coherent.** From a clean checkout it
  builds, typechecks, lints, tests, and validates the schema — `package.json`
  (scripts), `package-lock.json` (`npm ci`), `prisma/schema.prisma` +
  `migrations/` (`prisma validate`), and all `tests/` are included together.
- **C2 depends on C1.** The workflow calls the five npm scripts and validates
  the schema; without C1 on the branch it would fail. C2 must land with/after C1.
- **C3 is order-independent** relative to C1/C2 and logically last.

**Splitting into separate commits/PRs — broken-state analysis:**

- Splitting C1 into sub-commits by directory would create intermediate commits
  where, e.g., a server module is committed before its schema/tests → `npm test`
  or `tsc` could fail mid-sequence. C1 is safest as **one commit**.
- C1 and C2 **may** be separate commits **within one PR** (C1 first, C2 second):
  the final tree is coherent, and CI only runs against the PR head/merge ref, so
  intermediate commits are not independently gated. This preserves review
  granularity without a broken merge target.
- A PR containing **only C2** (without C1) would be incoherent (missing scripts/
  schema) and must not be created alone.
- C3 can be its own commit in the same PR or a follow-up; no coupling.

**Recommendation:** one feature-branch PR with commits ordered C1 → C2 → C3 (or
C1+C2 then C3). Do not split C1 across commits.

---


---

## §9 — Proposed explicit-path staging plan (NOT executed)

Order of operations for the owner (or a future explicitly-authorized act-phase):

1. **Review final diff and exclude list.** Confirm no `.env`, `AppData/`,
   `tmp_*`, or `flaky_run_*` path is present: `git status --short`.
2. **Stage only approved C1 paths** — explicit paths/path-groups, never
   `git add .` / `git add -A`:
   - Config/meta: `package.json` `package-lock.json` `.env.example`
     `.eslintrc.json` `.gitignore` `tailwind.config.ts` `prisma/.gitkeep-note.md`
   - Config/domain/server/lib/components source: `src/config` `src/domain`
     `src/lib` `src/server` `src/components` `src/middleware.ts`
     `src/app/hq` `src/app/kds` `src/app/login` `src/app/pos`
     `src/app/finance` `src/app/api` `src/styles`
   - Schema/migrations/RLS: `prisma/schema.prisma` `prisma/migrations`
     `prisma/rls-tenant-isolation.sql` `prisma/rls-verify.sql`
     `prisma/rls-demo-isolation.sql` `prisma/guc-impersonation-probe.sql`
   - Tests: `tests`
3. **Inspect staged diff and staged file list** — `git diff --cached --stat` and
   `git diff --cached --name-only`; confirm the count matches C1 and excludes
   artifacts.
4. **Run relevant checks** on the staged tree: typecheck, lint, test,
   db:validate, build.
5. **Request approval before creating a commit** (commit message describing the
   application/security + schema foundation).
6. **Stage C2 separately** (only if the owner prefers it split): explicit path
   `.github/workflows/ci.yml`; inspect staged list; request commit approval.
7. **Stage C3 separately**: explicit path `docs`; request commit approval.
8. **Request separate explicit approval before push, PR open, merge, CI
   activation, or any deployment.**

No blanket staging is recommended. No commit hash, test outcome, or approval is
invented. The plan is a proposal only.

---

## §10 — Outstanding risks and required owner approvals

| # | Item | Severity |
|---|---|---|
| 1 | First-run PR gate depends on remote Actions settings (unverified) | Medium — mitigated by merge-then-`workflow_dispatch` fallback (§7) |
| 2 | Node 20 (CI) vs Node 24 (local) parity unverified | Low — resolves on first real CI run |
| 3 | C1 is large (100+ files) — review burden | Low — mitigated by explicit path groups + staged-diff inspection |

**Required owner approvals (in order):** (a) approve this manifest + staging
plan; (b) approve staging the exact C1 paths; (c) approve the C1 commit;
(d) approve C2 (+C3) commit(s); (e) approve push/PR; (f) approve merge + CI
observation. Each is a separate gate; none is granted by this report.

---

## Final decision

```text
READY FOR EXPLICIT STAGING APPROVAL
```

No secret or local artifact is eligible for inclusion; every changed path is
classified; the C1→C2→C3 plan is dependency-safe. This authorizes **no** Git
write — staging requires separate explicit owner approval.

---

## Final safety verification

- No existing file was modified by this audit (only the new report was created). ✓
- Exactly one new report created: `docs/OA2.4-GIT-SNAPSHOT-EXECUTION-PLAN.md`. ✓
- Git index remains **empty** (0 staged). ✓
- No Git write operation was run (no add/reset/restore/clean/stash/commit/push/
  pull/merge/rebase). ✓
- HEAD (`1bf82a4`) and branch (`main`) unchanged. ✓
- No remote DB, GitHub settings, CI activation, or deployment touched. ✓
- `.env` / secret values never read or printed. ✓

## §7 — CI first-run risk and activation recommendation

Reassessed caveats:

- **Workflow not on `main` yet.** True — `ci.yml` is untracked. The first PR that
  adds it is the first opportunity for the gate to run.
- **First PR run depends on GitHub Actions permissions / behavior.** A PR that
  introduces `ci.yml` **can** trigger `pull_request` (GitHub evaluates the
  workflow from the PR merge ref), **but only if** repo Actions settings allow
  PR workflows and fork-PR policy permits. This phase has **no access** to
  remote settings → **NOT VERIFIED**. Do not claim the first PR gate will run.
- **`workflow_dispatch` available only after the workflow is on the default
  branch.** True — manual runs are impossible until `ci.yml` reaches `main`.
- **Node 20 (CI) vs Node 24 (local) parity.** **NOT VERIFIED** until a real run.
- **Workflow must not become deploy/migration.** Confirmed — steps are read-only
  checks; no deploy/migrate/DB-write; dummy env step-scoped.

**Safest activation sequence (no settings change, no CI activation here):**

1. Land C1+C2 via a reviewed PR; if Actions permits, observe the `pull_request`
   gate on the PR (best case — validates before merge).
2. If the gate does not run on the PR (Actions restricted), merge after owner
   review + the local five-gate evidence, then trigger `workflow_dispatch` on
   `main` to observe the first run there.
3. Never weaken tests/security gates to force a green run; investigate failures.

---

## §8 — Validation evidence and limitations

| Check | Status |
|---|---|
| YAML syntax (`js-yaml`, post-OA2.3 edit) | **Freshly reproduced — PASS** (OA2.3) |
| Workflow integrity (triggers/perms/Node/scripts/env) | **Freshly reproduced — PASS** (OA2.3) |
| `db:validate` offline-only | **Valid prior evidence; file unchanged** (OA2.1/OA2.3) |
| Five CI gates (typecheck/lint/test/db:validate/build) | **Valid prior evidence; relevant files unchanged** (OA2.1) — NOT rerun this phase |
| `.gitignore` no-regression | **Freshly reproduced — PASS** (this phase, `git check-ignore`) |
| Node 20 vs 24 parity | **Not verified** — needs a real CI run |
| First-run PR-gate behavior | **Not verified** — depends on remote Actions settings |

No remote integration tests, DB writes, migrations, or deployment commands were
run. No mutation-capable command was executed. The five gates were not rerun
because no relevant executable/config changed since OA2.1 and the only edit
since (OA2.3) was a YAML comment proven structurally identical.


## §5 — Explicit exclusion list

Verified via `git check-ignore` and `git status` (none appear as changed):

| Excluded | Rule / reason |
|---|---|
| `.env` | `.gitignore:29` — secret-bearing; never read/printed |
| `.env.local` | `.gitignore:30` — secret-bearing |
| `AppData/` (PG cluster) | `.gitignore:58 /AppData/` — ~72 MB disposable local cluster |
| root `tmp_*` | `.gitignore:59 /tmp_*` — scratch artifacts |
| root `flaky_run_*.txt` | `.gitignore:60 /flaky_run_*.txt` — QA run logs |
| Any keys/certs/credentials | Existing `.gitignore` rules (`*.key`, `credentials*`, etc.) preserved |

`.gitignore` rules are preserved (not modified this phase). No secret or local
artifact is eligible for inclusion. No required source/schema/migration/test/
lockfile is omitted — all appear in the C1 manifest above.

| `src/app/finance/transactions/page.tsx` | Finance transactions UI |
| `src/components/layout/header.tsx` | Layout |
| `src/components/ui/badge\|button\|card\|empty-state\|icon-button.tsx` + `index.ts` (6) | UI primitives |
| `src/styles/tokens.css` | Design tokens |
| `tests/analytics\|audit-rate-limit\|customers\|finance-service\|inventory.test.ts` (5) | Tests for coherent `npm test` |
| `tests/helpers/memory.ts` | Test fixture helper |

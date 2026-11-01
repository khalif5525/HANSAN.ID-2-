# HANSAN — OA1: FINAL CI ACTIVATION REVIEW

**Date:** 10/13/2026
**Scope:** Review-only. No workflow activation, no GitHub settings changes, no
secrets, no Git write operations (no stage/commit/push/merge/reset/checkout),
no secret values read or printed, no unrelated files modified. All existing
working-tree changes preserved.
**Reviewed artifacts:** `.github/workflows/ci.yml` (2778 bytes, untracked),
`docs/PHASE-17-CI-ACTIVATION-CHECKLIST.md`, `docs/PHASE-17-STAGING-READINESS-AND-CI-ACTIVATION-PLAN.md`.

---

## 1. Review findings

### 1.1 Workflow structure (requirement 1) — PASS

Verified by parsing the file with the already-present local `js-yaml`:

| Element | Actual value | Expected | Result |
|---|---|---|---|
| Triggers | `pull_request → branches:[main]` + `workflow_dispatch` (no inputs) | PR gate + manual, no push trigger | PASS |
| Permissions | `permissions: contents: read` (workflow-level) | Least-privilege read | PASS |
| Node version | `node-version: 20` via `actions/setup-node@v4`, `cache: npm` | Pinned LTS for Next 14.2.35 | PASS |
| Install | `npm ci` (lockfile; `package-lock.json` is tracked) | Reproducible install | PASS |
| npm scripts | `typecheck`, `lint`, `test`, `db:validate`, `build` — all verified verbatim against working-tree `package.json` | No invented names | PASS |
| Steps total | 8 (checkout → node → ci → typecheck → lint → test → db:validate → build) | Minimal gate | PASS |
| Actions used | `actions/checkout@v4`, `actions/setup-node@v4` only (GitHub-owned) | Minimal supply chain | PASS |
| Deploy/migrate/DB steps | **None** — grep of all `run:` commands shows only the 6 npm commands above | No deployment, migration, RLS, or DB write | PASS |

### 1.2 Secret-free execution on PRs and pushes (requirement 2) — PASS

- No `secrets.*` reference anywhere in the workflow; no environment variables
  are set or consumed by any step.
- `prisma validate` (db:validate) is schema-only — no live DB connection.
- Fork PRs: the workflow needs no secret, so GitHub's fork restrictions cannot
  block or endanger it; nothing sensitive is exposed to fork code.
- Push events: the workflow has **no `push` trigger**, so plain branch pushes
  do not execute it (only PRs targeting `main` and manual dispatch do).
- Test-suite hermeticity verified live this session (see §2): the full suite
  ran with `DATABASE_URL`, `DIRECT_URL`, and all Supabase env values
  **blank/absent** — 285/285 passed. No test reads
  `process.env.DATABASE_URL/DIRECT_URL/SUPABASE_*` directly (codebase grep: 0
  results).

### 1.3 Syntax validity and repository consistency (requirement 3) — PASS (with one dependency, §1.5)

- YAML parses cleanly; job `check` on `ubuntu-latest`; triggers/permissions as
  declared above.
- Only one workflow file exists in `.github/workflows/` (`ci.yml`) — no
  competing definitions.
- Working-tree `package.json` contains all five invoked scripts; `npm ci
  --dry-run` exit 0 ("up to date") — lockfile and package.json are in sync.
- **Dependency:** the committed `package.json` at HEAD does **not** contain
  `db:validate` (HEAD scripts: dev/build/start/lint/typecheck/test only), and
  `prisma/schema.prisma` is untracked (absent at HEAD). See §1.5.

### 1.4 First remote run safety without production config (requirement 4) — PASS

- The workflow requires zero secrets, zero env vars, zero services, and makes
  no network calls beyond dependency install and GitHub-owned actions.
- Local clean-runner simulation (Phase 17, build with all 8 `.env` vars
  blanked → exit 0) plus this session's test run under blanked env prove the
  gate does not depend on any production or staging configuration.
- The workflow cannot reach a database, cannot migrate, cannot deploy, and
  cannot modify repository settings. `GITHUB_TOKEN` is read-only by explicit
  `permissions`.

### 1.5 CRITICAL activation dependency — what lands on `main` must be the validated tree

GitHub executes the workflow against the **committed** tree, not this working
tree. Evidence: `git show HEAD:package.json` has no `db:validate` script, and
`prisma/schema.prisma` is untracked. If the owner pushed **only** the workflow
file, the first run would **fail at step 7** with `Missing script: "db:validate"`
(and would lack the schema and the 16 new test files entirely; the old
committed tests/build state is UNVERIFIED).

Therefore the activation commit must include, at minimum, the files the gate
depends on: `.github/workflows/ci.yml`, `package.json`,
`package-lock.json`, `prisma/schema.prisma`, `prisma/migrations/`, `tests/`,
and the `src/` changes — in practice: **commit the full validated working tree
(49 modified + 75 untracked entries as inspected) together with the workflow,
so CI validates exactly what was validated locally.** This is a Git write
operation reserved to the owner (§3).

### 1.6 GitHub repository settings to check BEFORE activation (requirement 5) — NONE changed by this review

| # | Setting (GitHub UI path) | Check / expected value |
|---|---|---|
| S1 | Settings → General → Actions → General → **Actions permissions** | "Allow owner actions and reusable workflows" (permits `actions/checkout@v4` and `actions/setup-node@v4`) |
| S2 | Same page → **Workflow permissions** | "Read repository contents permissions" + "Grant read permission for scopes" — matches the explicit `permissions: contents: read` |
| S3 | Same page → **Fork pull request workflows** | "Require approval for first-time contributors" (default) — acceptable; the gate is secret-free so approval friction is optional to relax (owner decision) |
| S4 | Settings → Secrets and variables → Actions | Confirm **no repository secrets exist or are needed** — the gate uses none |
| S5 | Settings → Branches / Rulesets for `main` | Review existing rules: if direct pushes are blocked, activation must go through a PR (recommended path). Do **not** add the required status check yet (checklist R4: deferred until N green runs) |
| S6 | Actions tab | If GitHub Actions was never enabled for this repo, GitHub will prompt "I understand my workflows, go ahead and enable them" after the first workflow file lands — owner must confirm |

### 1.7 Can activation be done WITHOUT pushing the workflow file? (requirement 7)

**No — impossible.** Precise dependency: GitHub Actions only recognizes
workflow definitions that exist **in the repository on the default branch**.
For `pull_request` events the workflow must exist on the PR's *base* branch
(here `main`); the run then executes the workflow version from the PR's merge
ref. A file that exists only in a local working tree (currently untracked:
`?? .github/workflows/`) is invisible to GitHub — there is no UI, API, or
settings action that can activate a workflow that has not been committed to
the default branch.

**Conclusion: activation requires a Git write (commit + push, or PR merge) by
the owner. This review stops here for approval** — no Git operation was or
will be performed by the agent.

---

## 2. Local validation evidence (this session, current working tree)

| # | Check | Command | Result | Exit |
|---|---|---|---|---|
| 1 | TypeScript | `npm run typecheck` | Clean | **0** |
| 2 | ESLint | `npm run lint` | "No ESLint warnings or errors" | **0** |
| 3 | Unit tests | `npm test` | 28 files; **285 passed, 0 skipped** | **0** |
| 4 | Schema | `npm run db:validate` | "The schema at prisma\schema.prisma is valid" | **0** |
| 5 | Build | `npm run build` | Compiled successfully | **0** |
| 6 | Lockfile sync | `npm ci --dry-run` | "up to date" (no lockfile drift vs working-tree package.json) | **0** |
| 7 | Workflow YAML | `node` + local `js-yaml` parse | YAML_OK; triggers/permissions/steps verified (§1.1) | **0** |

Honesty notes:

- **db:validate anomaly and resolution:** the first `db:validate` run this
  session failed (exit 1, P1012 "DIRECT_URL resolved to an empty string").
  Root cause was **this agent's own Phase 17 clean-runner simulation** — the
  shared terminal session persisted 8 blanked env vars, and dotenv-style
  loading does not override pre-set empty values. `.env` was verified intact
  (last write 10/10/2026; `DIRECT_URL` value length 108 — value never
  printed). After removing the 8 shell-level blanks, `db:validate` passed
  (exit 0). No repo or `.env` change was involved.
- **Test-count variance:** Phase 17 reported 284 passed | 1 skipped; this run
  reported 285 | 0. Explained: `tests/pos-order.test.ts:278` uses
  `it.runIf(!DB_CONFIGURED)` where
  `DB_CONFIGURED = Boolean(DATABASE_URL || POSTGRES_URL || PRISMA_DATABASE_URL)`.
  With DB vars blank this session, the guarded test **ran and passed** — which
  is precisely the CI condition (CI has no DB vars). The CI-relevant count is
  therefore 285/285, verified.
- Node parity caveat: local gates ran on Node 24; CI pins Node 20. The first
  remote run is the real Node-20 verification (`UNVERIFIED` until then).

---

## 3. Exact owner action required

The owner states, in writing:

> "I approve activating `.github/workflows/ci.yml` ('CI — Pull Request Gate',
> OA1-reviewed version) on `main`: committing the validated working tree
> together with this workflow file, pushing it (directly or via PR), and
> observing the first run per `docs/OA1-CI-ACTIVATION-REVIEW.md` §4. No
> repository secrets will be added. Settings S1–S6 reviewed as in §1.6.
> — <owner name, date>"

Then the owner performs the Git write (agent cannot do this):
1. Review `git status` (49 modified + 75 untracked entries — the validated
   tree) and stage/commit **all of it**, including
   `.github/workflows/ci.yml`. Minimum non-optional set: `ci.yml`,
   `package.json`, `package-lock.json`, `prisma/schema.prisma`,
   `prisma/migrations/`, `tests/`, `src/` (see §1.5 — omitting these breaks
   the first run).
2. Push to a new branch and open a PR to `main` (recommended), or push
   directly to `main` if branch rules allow.

---

## 4. GitHub activation steps (owner, exact UI path)

1. **Settings → General → Actions → General:** confirm S1 ("Allow owner
   actions…") and S2 ("Read repository contents permissions") before or
   immediately after the push.
2. **Push/PR** per §3. The workflow becomes recognized once the file exists on
   `main` (direct push) or, for PR runs, once the PR targets `main` with the
   workflow in its merge ref.
3. **Actions tab → "CI — Pull Request Gate":** open the newest run; verify the
   8 steps in order (checkout → setup-node → `npm ci` → typecheck → lint →
   test → db:validate → build), all green; expected duration ~5–15 min.
4. **Verify logs:** `npm ci` clean; tests report `285 passed` under Node 20;
   `db:validate` "schema … is valid"; build "Compiled successfully".
5. **Secret audit:** run page references no secrets; Settings → Secrets shows
   none added.
6. **Evidence:** record run URL, run ID, triggering commit SHA, durations.
7. If the repo had Actions disabled, confirm the "enable workflows" prompt
   (S6).
8. Only after **N consecutive green runs** (owner decides N; checklist
   suggests 3–5) consider making job `check` a required status check (R4) — a
   separate, later settings change.

---

## 5. Rollback / disable procedure (owner)

1. **Fastest:** Actions → "CI — Pull Request Gate" → `⋯` menu → **Disable
   workflow** → confirm. No code change; re-enable from the same menu.
2. If job `check` was made a required status check, **remove it from branch
   protection at the same time** (Settings → Branches/Rulesets → main →
   required status checks) or merges will block on a check that never runs.
3. Full removal: revert the enabling commit/PR (Git write, owner) or delete
   the workflow file in a follow-up commit.
4. Emergency stop for a misbehaving run: on the run page use **Cancel**; then
   apply (1).

---

## 6. Remaining blockers

| # | Blocker | Type | Owner resolution |
|---|---|---|---|
| OB1 | Activation requires committing + pushing the validated tree (§1.5) — Git write reserved to owner | Approval/ownership | §3 statement + §3 steps |
| OB2 | First run executes against Node 20 — locally UNVERIFIED (local dev is Node 24) | Informational | Observe first run (§4.3–4.4) |
| OB3 | Committed `package.json` at HEAD lacks `db:validate`; `prisma/` untracked — pushing only ci.yml guarantees a failing first run | Sequencing | Include the validated tree in the activation commit |
| OB4 | GitHub settings S1–S6 unverified from here (no remote access) | Owner-side | Walk §1.6 before/after push |

No workflow-file correction is required: the file passes every required check
(§1.1–1.4). All blockers are owner actions or first-run observations.

---

## Decision

```text
READY FOR EXPLICIT OWNER APPROVAL
```

Rationale: the workflow is syntactically valid, secret-free, least-privilege,
deploy/migration-free, and locally reproducible end-to-end (7/7 local checks
exit 0, including a no-env CI-condition test run of 285/285). Activation is
technically impossible without the owner committing and pushing the validated
tree together with the workflow file (§1.5/§1.7) — that Git write is the exact
approval being requested. Nothing was activated, pushed, staged, or changed in
GitHub settings or secrets by this review.

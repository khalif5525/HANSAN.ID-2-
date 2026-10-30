# HANSAN — PHASE 17: CI ACTIVATION CHECKLIST

**Status:** `PREPARED — NOT ACTIVATED` (review and local validation only)
**Boundary:** This phase did NOT enable any workflow, trigger remote CI, add
secrets, change repository settings, or change branch protections. The workflow
file `.github/workflows/ci.yml` remains **untracked and unstaged**.

---

## 1. Workflow state after Phase 17 review

File: `.github/workflows/ci.yml` — "CI — Pull Request Gate" (1 job `check`, 8 steps).

| # | Review dimension | Result | Evidence |
|---|---|---|---|
| 1 | Node version | PASS | `node-version: 20` pinned (Next 14.2.35 supported LTS lines 18/20/22). Local dev runs Node 24 — CI parity caveat noted in §6. |
| 2 | Lockfile install | PASS | `npm ci` with tracked `package-lock.json` and `cache: npm` in `actions/setup-node@v4`. Reproducible. |
| 3 | Script names | PASS | `typecheck`, `lint`, `test`, `db:validate`, `build` all verified against `package.json` scripts — no invented names. |
| 4 | Environment variables / secrets | PASS | No step reads `secrets.*`; no `DATABASE_URL`/`SESSION_SECRET`/`SUPABASE_SECRET_KEY` needed. `prisma validate` is schema-only (no DB connection). |
| 5 | Clean-runner viability | PASS (local simulation) | `npm run build` executed with all 8 `.env` variable names blanked → exit 0. Tests use their own env helpers (no `.env` dependency). |
| 6 | YAML syntax | PASS | Parsed with the already-present local `js-yaml` (no new tooling installed); re-validated after Phase 17 edits. |
| 7 | Triggers | PASS (minimal) | `pull_request → [main]` + `workflow_dispatch` (manual, **no inputs**). No `push` trigger — branch pushes to main do NOT run the gate; PRs and manual dispatch do. |
| 8 | Permissions | PASS (hardened) | Phase 17 added explicit `permissions: contents: read` (least-privilege token). Previously implicit/default. |
| 9 | Deploy / migrate / production access | NONE | No deployment, migration, DB-write, or RLS step exists. Fail-safe by design. |
| 10 | Fork-PR secret isolation | PASS | PRs (including forks) run the full gate without any secret — nothing to leak. |

### Phase 17 narrow edits (local, untracked, unstaged)
1. Added `permissions: contents: read` — the workflow previously relied on the
   repository's default `GITHUB_TOKEN` scope, which can be read-write depending
   on repository settings. Explicit least-privilege is the correct hardening for
   a read-only gate.
2. Removed the **unused** `workflow_dispatch.inputs.LIVE_DB_URL` input — its own
   comments declared it unused, and dispatch inputs are recorded in
   workflow-run metadata, where a pasted connection string would become visible
   to repository readers. `workflow_dispatch` is kept for manual runs.

No other changes were made to the workflow.

---

## 2. Required repository and branch protections (owner-applied — NONE applied yet)

Recommended settings for the owner to apply in GitHub **before or together with**
activation. None of these were changed by this phase:

| # | Setting | Recommended value | Rationale |
|---|---|---|---|
| R1 | Actions workflow permissions (repo default) | "Read repository contents" | Matches the explicit `permissions: contents: read`. |
| R2 | Allowed actions | Allow GitHub-owned actions only (`actions/checkout`, `actions/setup-node`) | Supply-chain minimization. |
| R3 | Pull request before merge to `main` | Required | Ensures the gate runs before integration. |
| R4 | Required status check | `CI — Pull Request Gate` job `check` | Makes the gate blocking. Enable only after §5's green-run count is met. |
| R5 | Branch push restrictions on `main` | No direct pushes / no force pushes / no deletions | Protects the default branch. |
| R6 | Repository secrets audit | Confirm zero secrets exist (none are needed) | Keeps the gate verifiably secret-free. |
| R7 | Merge policy (approvals, stale-review dismissal, up-to-date branches) | Owner decision | Not prescribed by this phase. |

---

## 3. How the workflow will be enabled (owner-executed, after approval)

A GitHub workflow becomes active only when it exists on the default branch.

1. Owner gives the explicit approval quoted in §8.
2. Owner (not this agent) commits `.github/workflows/ci.yml` — the Phase 17
   reviewed version — and pushes it to `main`, **or** opens a PR containing only
   this file, reviews it, and merges it. Note: for `pull_request` events GitHub
   executes the workflow version from the PR's merge ref, so the enabling PR
   itself may already trigger the first run.
3. Owner verifies in **Settings → Actions** that "CI — Pull Request Gate" is
   listed and enabled, and that R1/R2 are set.
4. Owner applies R3–R5. R4 (required status check) is deferred until §5.

---

## 4. First-run observation and verification

| Step | What to check | Expected |
|---|---|---|
| 1 | Actions tab → "CI — Pull Request Gate" → newest run | Run appears for the enabling PR / dispatch |
| 2 | Step list | 8 steps, in order: checkout → setup-node → `npm ci` → typecheck → lint → test → `db:validate` → build |
| 3 | `npm ci` | Exit 0, no lockfile drift ("up to date" or clean install) |
| 4 | Unit tests log | `Test Files 28 passed (28)`, `Tests 284 passed \| 1 skipped (285)` — matches the local baseline recorded in the Phase 17 report |
| 5 | `db:validate` log | "The schema at prisma/schema.prisma is valid" |
| 6 | Build log | "Compiled successfully", no env-dependent failures (clean-runner simulation predicted exit 0) |
| 7 | Run conclusion | Green check; total duration recorded (expected ~5–15 min) |
| 8 | Secret audit | Run page references no secrets; repo Settings → Secrets shows none added |
| 9 | Evidence capture | Record run URL, run ID, triggering commit SHA, and the step log excerpts in the next phase report |

---

## 5. Failure handling

1. **Never** fix a failure by adding a repository secret or weakening a step.
2. Classify the first failing step:
   - *Infrastructure* (registry outage, runner flake) → use GitHub's "Re-run
     failed jobs" once; if it recurs, investigate before further re-runs.
   - *Code* → reproduce locally with the exact same command (e.g.
     `npm run typecheck`) on the current tree; fix locally; re-validate all five
     gates before proposing a new commit.
   - *Environment parity* → the CI runs Node 20 while local dev is Node 24. A
     Node-20-specific failure must be fixed in code (preferred) or the pinned
     version changed only with explicit owner approval and evidence.
3. Do not mark the check as *required* (R4) until the owner has observed
   **N consecutive green runs** on `main` (suggested N = 3–5; owner decides).
   Local `flaky_run_*.txt` artifacts exist in the tree, so a small flake budget
   before making the check blocking is prudent.
4. Any run failure report must quote the exact failing step and exit code — no
   "probably fine" claims.

---

## 6. Disable / rollback

| # | Method | Who | Code change? | Notes |
|---|---|---|---|---|
| D1 | Actions → workflow → **Disable workflow** | Owner | No | Fastest rollback; file stays on `main` but runs stop. Re-enable anytime. |
| D2 | Remove R3/R4 branch-protection requirements | Owner | No | Do this **together with D1** if the check was made required, otherwise merges block on a check that never runs. |
| D3 | Revert the enabling commit / PR | Owner (git op) | Yes | Full removal of the workflow file from `main`. |
| D4 | Comment out `on:` triggers and push | Owner (git op) | Yes | Keeps file as documentation; workflow never fires. |

All of D3/D4 are git operations requiring the same owner approval class as §3.

---

## 7. Post-activation status discipline

Until the workflow has run green on GitHub, all remote-CI statuses in reports
remain `NOT RUN` / `UNVERIFIED`. Local gate passes (Phase 17: all five exit 0)
are evidence for **local validation only** and are never reported as CI success.

---

## 8. Exact approval required before activation

Before §3 step 2, the owner must state — explicitly and in writing —

> "I approve enabling `.github/workflows/ci.yml` ('CI — Pull Request Gate',
> Phase 17 reviewed version) on `main`: committing and pushing this file,
> allowing the workflow to run on pull requests targeting `main` and on manual
> dispatch, and applying the branch-protection settings R1–R5 (with R4 deferred
> until N green runs) from the Phase 17 CI Activation Checklist. No repository
> secrets are to be added. — <owner name, date>"

Any subsequent change to the workflow file (new steps, new triggers, any
reference to secrets or a database) voids this approval and requires re-review.

---

## 9. Status summary

| Item | Status |
|---|---|
| Workflow drafted, reviewed, narrow-hardened | **PASS — LOCAL** |
| Script names / lockfile / triggers / permissions | **PASS — LOCAL** |
| Local five-gate validation of the current tree | **PASS — LOCAL** (exit 0 ×5, this session) |
| Clean-runner build viability | **PASS — LOCAL SIMULATION** (env blanked, exit 0) |
| Remote CI execution | **NOT RUN** — requires owner approval (§8) |
| Branch protections / secrets audit (GitHub settings) | **NOT RUN** — owner-side |
| Final phase status | `PREPARED — NOT ACTIVATED` |
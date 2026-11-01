# HANSAN — OA2.1: MINIMAL CI BLOCKER REMEDIATION

**Date:** 10/13/2026
**Mode:** Minimal, authorized remediation of the two OA2 blockers. Only two
files were modified (`.github/workflows/ci.yml`, `.gitignore`) and one report
was created. No Git write operation was performed; the index is empty and HEAD
is unchanged. No secret value was read or printed. No remote DB, cloud, or
GitHub setting was touched; CI was not activated. No application code, Prisma
schema, migration, auth, RLS, or tenant-isolation logic was modified.

---

## Before / after summary

| Blocker (OA2) | Before | After |
|---|---|---|
| `prisma validate` fails on a clean checkout (P1012; no `DATABASE_URL`/`DIRECT_URL`) | `db:validate` step had no env → would fail at step 7 on a clean runner | `db:validate` step now provides step-scoped **dummy** `DATABASE_URL`/`DIRECT_URL`; clean-checkout validation now **passes** (empirically proven) |
| `.gitignore` does not exclude `AppData/`, `tmp_*`, `flaky_run_*.txt` | Blanket `git add .` could stage a 72.4 MB PG cluster + scratch files | Three root-anchored patterns added; artifacts now ignored (verified with `git check-ignore` + `git status`), real source still tracked/trackable |

---

## Exact minimal diff description

### 1. `.github/workflows/ci.yml` — one step only
The `db:validate` step ("Prisma DB schema validation (schema-only, no DB)") was
given a step-scoped `env:` block with two dummy placeholders plus an explanatory
YAML comment. Nothing else in the workflow changed:

```yaml
      - name: Prisma DB schema validation (schema-only, no DB)
        run: npm run db:validate
        # NON-SECRET, non-routable dummy placeholders (localhost only). `prisma
        # validate` only checks that the datasource URLs are syntactically valid —
        # it does NOT open a database connection. ... Scoped to THIS step only ...
        env:
          DATABASE_URL: "postgresql://user:pass@localhost:5432/hansan"
          DIRECT_URL: "postgresql://user:pass@localhost:5432/hansan"
```

Triggers, `permissions: contents: read`, action versions (`checkout@v4`,
`setup-node@v4`), Node 20, the five npm commands, and job structure are
**unchanged** (verified by YAML parse, below).

### 2. `.gitignore` — three root-anchored lines appended
```
# local disposable/scratch artifacts (OA2) — never source. Root-anchored so
# only repo-root artifacts are excluded; legitimate nested files are unaffected.
/AppData/
/tmp_*
/flaky_run_*.txt
```
Every pre-existing rule was preserved. The `git diff` for `.gitignore` also
shows a pre-existing secrets-hardening block (`secrets*` + the
`!src/server/config/secrets.ts` negation) — that block **predates OA2.1** (it
was part of the original 49 modified files) and was not touched here. The
OA2.1-specific delta is only the five lines above.

**Scope confirmation:** OA2.1 performed exactly two file edits. `git status`
counts are unchanged for tracked files (MODIFIED = 49, which already included
`.gitignore`); `.github/workflows/ci.yml` was already untracked. No other file
was edited.

---

## Placeholder URLs are dummy and non-secret

- Values: `postgresql://user:pass@localhost:5432/hansan` (both vars).
- **Non-routable / non-secret:** host is `localhost` (loopback; no remote DB),
  user/pass are literal placeholder strings `user`/`pass`, database is `hansan`.
  These are not real credentials, hostnames, IPs, project refs, or any actual
  connection string. They are safe to publish in a workflow file.
- **Scoped to `db:validate` only:** the parsed YAML confirms `env` appears on
  that one step; the other seven steps have `env: -`. No repository secret, no
  job-level env, and no workflow-level env were added.
- No network access, database setup, migration, or connection test was added.

---
## Evidence that `db:validate` is offline-only

- The script is literally `"db:validate": "prisma validate"` (from
  `package.json`). `prisma validate` performs **configuration/schema**
  validation; it resolves `env()` and checks the datasource URLs are
  syntactically valid but does **not** open a database connection.
- **Empirical proof (this session):** I ran `prisma validate` against the real
  `prisma/schema.prisma` in an isolated child process — cwd in the OS temp dir
  (no `.env`), with `DATABASE_URL`/`DIRECT_URL` set to the exact workflow
  placeholders and no database running on `localhost:5432`. Result:
  `The schema at prisma\schema.prisma is valid 🚀`. Because no server was
  listening on that loopback port yet validation succeeded, no connection was
  attempted → offline-only confirmed. (The child process was fully isolated;
  the persistent terminal env and `.env` were untouched. The temp dir was
  deleted afterward — the cleanup hit a benign Windows EPERM after validation
  already passed, and the dir was removed in a follow-up.)
- This is the exact clean-runner condition that previously failed with P1012
  in OA2; it now passes, so the workflow's `db:validate` step is fixed.

## Five CI gates (local, this session, actual exit codes)

Run on the current working tree (unmodified persistent terminal env; `.env`
present and untouched). These are the same five commands the workflow runs.

| # | Gate | Command | Result | Exit |
|---|---|---|---|---|
| 1 | typecheck | `npm run typecheck` | Clean | **0** |
| 2 | lint | `npm run lint` | "No ESLint warnings or errors" | **0** |
| 3 | test | `npm test` | 28 files; **284 passed, 1 skipped (285)** | **0** |
| 4 | db:validate | `npm run db:validate` | "The schema at prisma\schema.prisma is valid" | **0** |
| 5 | build | `npm run build` | Compiled successfully | **0** |
| + | clean-checkout `db:validate` | isolated `prisma validate` with the workflow placeholders | "schema … is valid" | **0 (PASS)** |

Notes (honest):
- The persistent terminal environment was **not** blanked or modified for any
  gate. The clean-checkout proof used an isolated child process only.
- Test-count variance: this local run shows **284 passed | 1 skipped** because
  `.env` supplies `DATABASE_URL`, so the guarded test
  `tests/pos-order.test.ts → it.runIf(!DB_CONFIGURED)` is skipped. On a clean
  CI runner (no `.env`, no DB vars) that test **runs**, giving **285 | 0**
  (proven in OA1/OA2). Both are green; the difference is environmental, not a
  regression.
- Test and build do **not** require or access a remote database: the suite is
  hermetic (in-memory stores + mocked Prisma), and `next build` completed with
  no DB. Neither contacted any remote DB during these runs.

---
## YAML validation

Parsed with the already-installed `js-yaml` (no new tooling). Result: **YAML_OK**.
Confirmed unchanged / correct:
- `on: {"pull_request":{"branches":["main"]},"workflow_dispatch":null}` — triggers intact, dispatch input-free.
- `permissions: {"contents":"read"}` — least-privilege intact.
- Actions: `actions/checkout@v4`, `actions/setup-node@v4` (unchanged).
- `node-version: 20`; job `check` on `ubuntu-latest`.
- Five CI commands unchanged: `npm ci`, `npm run typecheck`, `npm run lint`,
  `npm test`, `npm run db:validate`, `npm run build`.
- `env` present **only** on the `db:validate` step (other 7 steps: `env: -`).

## `git check-ignore` results

| Artifact | Ignored by | Match? |
|---|---|---|
| `AppData/Local/Temp/hansan_pg_p14/pg_control` | `.gitignore:58 /AppData/` | YES |
| `tmp_explain_order.sql`, `tmp_indexes.out.txt` | `.gitignore:59 /tmp_*` | YES |
| `flaky_run_1.txt`, `flaky_run_3.txt` | `.gitignore:60 /flaky_run_*.txt` | YES |

Negative control: legitimate nested files are **not** ignored — `git status`
still lists `prisma/schema.prisma`, `src/server/config/secrets.ts` (via its
`!` negation), and the OA1/OA2/OA2.1 reports as untracked (`??`), and all 49
modified tracked files remain modified. Untracked-entry count dropped 81 → 70
(11 artifact entries removed: 1 AppData + 7 tmp + 3 flaky); real files
untouched. The root-anchored patterns (`/…`) cannot hide nested source.

## Git safety verification

| Check | Result |
|---|---|
| Index (`git diff --cached`) | **Empty** |
| HEAD | `1bf82a404fb6a02a12db3d2eb73349403538b934` (unchanged) |
| Branch | `main … origin/main` (unchanged) |
| Staged/added/deleted files | 0 |
| Git write operations | None (`add/commit/push/merge/reset/clean/stash` all unused) |
| OA1 / OA2 reports | Present, untracked, untouched |
| Files changed by OA2.1 | `.github/workflows/ci.yml`, `.gitignore` (both authorized) + this report |
| Artifacts deleted | None (only excluded from Git; on-disk intact) |

## Remaining risks and next recommended action

- **Residual (low):** the workflow file's header comment (lines ~18–19) still
  says "No … DATABASE_URL is required anywhere below." That sentence is now
  slightly stale (a **dummy** placeholder is provided for `db:validate`). It is
  cosmetically inaccurate but harmless; correcting it was **outside** the
  authorized "modify only the db:validate step" scope, so it was left as-is.
  Recommend the owner fold that one-line comment tidy-up into the OA2.2 review.
- **Residual (low):** the CI-runner Node 20 vs local Node 24 parity remains
  `UNVERIFIED` until the first real CI run (unchanged from OA1/OA2).
- **Not changed here:** the three-commit sequencing plan from OA2 §8 still
  applies — `ci.yml` activates CI only when it reaches `main`, after the
  application tree commit.

**Next recommended action (owner):** proceed to OA2.2 review; then execute the
OA2 §8 commit plan (Commit 1 application tree → Commit 2 `ci.yml` → Commit 3
docs), re-verifying the five gates on the exact tree before activation.

## Decision

```text
READY FOR OA2.2 REVIEW
```

Rationale: both OA2 blockers are minimally fixed and validated within the two
authorized files. The clean-checkout `prisma validate` now passes (P1012
resolved) via non-secret, step-scoped, non-routable placeholders; `.gitignore`
now excludes `AppData/`, `tmp_*`, and `flaky_run_*.txt` without hiding any
legitimate file. All five CI gates pass with exit code 0; YAML is valid with
triggers/permissions/actions/Node/scripts unchanged; the index is empty and
HEAD is unchanged. No unauthorized file was modified.



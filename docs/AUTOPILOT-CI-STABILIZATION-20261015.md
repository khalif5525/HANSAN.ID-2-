# HANSAN — Autopilot CI Stabilization Report (2026-10-15)

**Batch:** Autonomous Production Mission — Priorities 1 (Stabilize CI) + 2 (Doc
reconciliation). **Status:** local fix COMPLETE — pending owner push + observed
GitHub Actions run. No commit, push, PR, merge, deploy, migration, or remote-DB
operation was performed in this batch.

## 1. Verified baseline (start of batch)

- Branch `release/hansan-c1-c3-ci-validation` = local `main` = `17d9906`; clean tree;
  in sync with `origin/release/hansan-c1-c3-ci-validation` (owner had pushed).
- **PR #1 OPEN** (3 commits → `main`); Vercel Preview Ready @ `17d9906e`.
- **GitHub Actions run #1 — `CI — Pull Request Gate` — FAILED (17s, Oct 15 2026)**
  at `npm ci` with EUSAGE: missing lockfile entries `@emnapi/core@1.11.3`,
  `@emnapi/runtime@1.11.3` (owner-provided log evidence).
- Local runtime: Node 24.11.1 / npm 11.6.2 (registry: single install).

## 2. Root cause (evidence-based)

1. **Lockfile/npm-version mismatch:** `package-lock.json` recorded `@emnapi/core` /
   `@emnapi/runtime` only **nested** under
   `node_modules/@unrs/resolver-binding-wasm32-wasi/node_modules/`. npm 11 accepts
   this layout; the CI runner's **npm 10 (Node 20/22) rejects it during `npm ci`
   lockfile validation** → the observed EUSAGE. Proof: local `npm ci` under npm
   11.6.2 exited 0 on the same lockfile (OA10), while CI failed.
2. **Node engine:** locked `@supabase/supabase-js@2.117.3` declares
   `engines.node >=22.0.0`; the workflow pinned Node 20.

## 3. Fix prepared (uncommitted, working tree)

| File | Diff | Content |
|---|---|---|
| `.github/workflows/ci.yml` | +5/−4 | `node-version: 20 → 22` (+ step name + header comment rationale). Triggers, `permissions: contents: read`, `setup-node@v4`, `cache: npm`, all gate steps unchanged. |
| `package-lock.json` | +26/−15 | Regenerated with **Node 22.23.3 / npm 10.9.9** (official zip, extracted to `%USERPROFILE%\.hansan-runtime` — isolated, non-system, owner Node 24 untouched). Adds the two missing `@emnapi/*@1.11.3` entries (registry URLs + integrity) and normalizes boolean `peer` flags (npm 10 vs 11 semantics). **Version-line churn: +2 (new entries only) / −0 removed; `package.json` unchanged.** |

## 4. Validation evidence (all LOCAL, on the CI runtime class)

Isolated runtime: `node --version` → **v22.23.3**; bundled `npm --version` → **10.9.9**.

| Check | Command | Exit | Result |
|---|---|---|---|
| Lockfile install | `npm ci` (npm 10.9.9, no bypass flags) | **0** | clean install; earlier attempt failed transiently (`prisma preinstall` MODULE_NOT_FOUND + external deletion of the `%TEMP%` runtime — isolated repro then passed, retry passed; root cause environmental, not lockfile) |
| Typecheck | `npm run typecheck` | **0** | clean |
| Lint | `npm run lint` | **0** | no warnings/errors |
| Tests | `npm test` | **0** | **28 files, 284 passed, 1 skipped (285)** |
| Schema | `npm run db:validate` | **0** | schema valid (schema-only; `.env` filename loaded, values never printed) |
| Build | `npm run build` | **0** | Next 14.2.35, **56/56 pages** |
| Diff hygiene | `git diff` scan | — | 2 intended files + 3 docs; no secrets (pattern scan 0 hits), no generated files, no untracked files, no dependency upgrades/downgrades |

## 5. Documentation reconciliation (Priority 2, this batch)

Updated (all claims verified from code/tests; no live-verification inflated):
`docs/PRODUCTION-READINESS.md` (baseline header, P0-1…P0-5, auth/authz + POS rows,
P2-4, P2-6), `docs/STAGING-CHECKLIST.md` (state line, B1, B2, gap note, RLS gate
note), `docs/MANUAL-BLOCKERS.md` (publishable-key wording, push/CI note).
Historical phase reports left untouched and remain identifiable as historical.

## 6. Residual risks / next actions

1. **CI still FAILING remotely** — fix exists only locally. Owner: commit + push the
   two files (`.github/workflows/ci.yml`, `package-lock.json`), then supply the
   Actions run URL for run #2 evidence. (RED: push requires owner.)
2. npm audit on fresh install: **18 vulns (5 moderate, 10 high, 3 critical)** —
   pre-existing; assess for exploitability before production (Priority: P2/§7.6).
3. Staging/backup/PgBouncer/RLS/live-auth gates unchanged → **Production NO-GO**
   (see PHASE-17 go/no-go and `MANUAL-BLOCKERS.md`).
4. Isolated runtime location: `%USERPROFILE%\.hansan-runtime\node-v22.23.3-win-x64`
   (safe to delete; does not modify the system Node 24 install).

---

## 7. ADDENDUM — OA11 batch (same day): CI re-verification + security advisory triage

### 7.1 CI re-verification (fresh, all LOCAL, Node 22.23.3 / npm 10.9.9)

| Check | Exit | Result |
|---|---|---|
| `npm ci` (no bypass flags) | **0** | lockfile sync proven by execution on the CI runtime class |
| `npm run typecheck` | **0** | clean |
| `npm run lint` | **0** | no warnings/errors |
| `npm run db:validate` | **0** | schema valid (schema-only) |
| `npm test` | **0** | 28 files, **284 passed / 1 skipped** |
| `npm run build` | **0** | **56/56 pages** |

Remote (read-only observation): **still only Actions run #1 = FAILED**; PR #1 OPEN;
no new runs/comments → **the fix remains unpushed; remote CI = FAIL / post-fix NOT VERIFIED.**
ci.yml header comments updated (draft/NOT-AUTO-ENABLED → active status; evidence: run #1).

### 7.2 Advisory register (`npm audit` under npm 10.9.9: 18 = 3 critical, 10 high, 5 moderate; prod deps 39 / dev 473)

| # | Package | Sev | Class | Reachability evidence | Fix | Decision |
|---|---|---|---|---|---|---|
| 1 | `next@14.2.35` (+ nested `postcss@8.4.31`) | **CRITICAL** (+high) | **PRODUCTION runtime** | middleware redirects used (`src/middleware.ts:77`); App Router/RSC endpoints live; **no `next/image` usage (0×)**; **no rewrites**; CSP **static, no nonce**; prod on Vercel (Linux) | only ≥15.5.16/15.5.21/15.5.24 (major) | **Owner decision: staged Next 15.x migration** — not autonomous (framework-major, §7.6). Per-advisory: rewrite-smuggling & CSP-nonce & Windows-RCE & Server-Function-disclosure NOT reachable (no rewrites/no nonce/Linux prod/no server functions); image-optimizer cluster LOW (zero usage, Vercel-served); **middleware-redirect cache poisoning + RSC/cache DoS = reachable, exploitability UNCONFIRMED** |
| 2 | `vitest@2.1.9` chain (`tinypool`, `vite`, `vite-node`, `@vitest/mocker`) | **CRITICAL** + high/mod | **DEV/TEST only** (`dev=true`; CLI `vitest run`, `environment: node`, **no UI server**, first-party tests only) | vitest 5 (major) | **Accept residual + document**; optional dedicated test-runner migration batch later (never mid-release) |
| 3 | `tailwindcss@3.4.19` chain (braces/chokidar/fast-glob/micromatch/postcss-nested/selector-parser) | HIGH/mod | **BUILD-time only** (dev=true; attacker would need control of our CSS/file names) | tailwind 4 (major) | **Accept residual** (build inputs are first-party) |
| 4 | `eslint-config-next@14.2.35` → `@next/eslint-plugin-next` → `glob@10.3.10` | HIGH | **DEV only** (lint-time; glob CLI `-c` injection not invoked with external input) | eslint-config-next 16 (major, tied to next 16) | **Accept residual**; re-evaluate with Next migration |
| 5 | `esbuild@0.21.5` (via vite) | MOD | **DEV only** (advisory concerns esbuild *dev server*; HANSAN uses `next dev`, tests are non-server) | ≥0.25 (major vs pinned ranges) | **Accept residual** |
| 6 | `postcss` top-level `8.5.29` | (flagged via nested) | nested vulnerable instance = `next/node_modules/postcss@8.4.31` → build-time CSS only | bundled with next | **Tied to decision #1** |

**Remediation performed this batch: none (deliberate).** Every available fix is a
major-version upgrade; `npm audit fix --force` and mass majors forbidden; running
plain `npm audit fix` would churn the freshly regenerated lockfile right before the
owner push for negligible reachability gain (glob CLI is dev-only). **Verified: no
dependency was weakened, no test disabled, no check suppressed.**

**Accepted residual risk (written):** criticals #2 are development-only with no
production attack path; critical #1 has confirmed production reachability for the
middleware-cache/DoS classes with exploitability unconfirmed — mitigated only by
full security headers (present) and the pending Next major-upgrade decision
(owner). Classification labels used below per §8.8:
`IMPLEMENTED` / `TESTED LOCALLY` / `VERIFIED ON STAGING` / `VERIFIED IN PRODUCTION`


## §8 ADDENDUM — OA12 batch (this day): route-to-persistence defect sweep

### 8.1 Scope

Sweep across:
- POS order creation/state transitions (route `POST /api/orders` + `[id]` GET)
- KDS station independence / parent-order aggregation (`KdsService`, `KdsTicket`, `aggregateProgress`)
- Refund authorization / concurrency / duplicate-processing prevention (`FinanceService`)
- Tenant isolation / IDOR / authorization (`authz.ts`, ports, adapters)
- Idempotency and payment lifecycle where they intersect

### 8.2 Results

**Confirmed critical defect: 1**
- **F1:** Idempotency `fail()` clears completed claims → duplicate-order risk on retry after post-complete error

**Not a defect (analyzed; no change):**
- KDS station independence / aggregation — correct explicit-field routing
- Refund authorization/concurrency — `canDecideRefund`/`canTransitionRefund` correct, but service **unwired from routes** (latent-only; not reachable via any API)
- Tenant isolation/IDOR — `authorizeRecord` → `assertTenant` + `assertOutlet` at query boundary
- Body parsing strictness — `parseCreateOrder` → `createOrderSchema` rejects non-objects, validates required fields, strips unknown keys
- Memory store `limit`/`sinceIso` — route validates `limit`; `sinceIso` format not validated at route level; store filter uses `sinceIso` unvalidated

### 8.3 Proof of failure (pre-fix)

```
FAIL  tests/idempotency-fail-completed.test.ts > idempotency fail() on completed claim > replay after fail on completed claim — duplicate execute must fail
AssertionError: expected 'started' to be 'replay' // Object.is equality
```

### 8.4 Fix

`InMemoryIdempotency.fail()` and `PrismaIdempotency.fail()` now only release `in_progress` claims:

```typescript
async fail(params) {
  const id = this.id(params);
  const existing = this.rows.get(id);
  if (existing && existing.status !== 'completed') {
    this.rows.delete(id);
  }
}
```

Same guard added to Prisma adapter. Completed claims remain — retry replays, never re-executes.

### 8.5 Regression tests

- `tests/idempotency-fail-completed.test.ts` — new (2 tests: completed-claim must replay; in_progress must release)
- `tests/idempotency.test.ts` — updated `fail()` on completed now expects `replay`

### 8.6 Validation matrix

| Check | Exit | Result |
|---|---|---|
| Idempotency tests (2 files) | 0 | 4 passed |
| `npm run typecheck` | 0 | clean |
| `eslint` (changed source) | 0 | clean |
| `prisma validate` | 0 | schema valid |
| `npm test` (full suite) | 0 | 29 files, 286 passed (1 skipped) |

### 8.7 Git state

Baseline: branch `release/hansan-c1-c3-ci-validation`, HEAD `17d9906ef09a7f682442d1c65c08cc130c93cbe6` (OA11). 5 OA11 files modified in prior batch — **untouched in this batch**. This batch: 2 source files + 2 test files + 1 doc file changed. No remote ops, no migrations, no lockfile/dependency changes.

### 8.8 Owners / next steps

- **Owner:** Backend/Identity
- **Next:** Route wiring for `FinanceService` (refunds) + KDS actions; then re-run full sweep with integration proofs. Route-level `sinceIso` validation and Prisma atomic refund update are follow-up work.

/ `BLOCKED` / `NOT VERIFIED`.

## §9 ADDENDUM — OA13 batch (this day): database integrity, idempotency, tenant GUC, observability audit

### 9.1 Scope

Audit of PostgreSQL-only durability guarantees across:
- `PrismaOrders` adapter transaction boundaries / rollback semantics
- Concurrent idempotency claim handling (InMemory + Prisma adapters)
- Tenant context propagation via `SET LOCAL` GUCs + RLS
- Observability coverage (audit, logging, tracing, metrics)

**Finding: PostgreSQL-only guarantees are NOT VERIFIED locally.** All runtime validation below was performed against the in-memory DEMO sandbox (demoSandbox), not against Postgres. `prisma validate` confirms schema syntax only; it does not exercise transactions, GUCs, or RLS.

### 9.2 Transaction / rollback trace (Prisma adapter)

| Method | Wrapped in `$transaction` | Atomic units | Rollback on failure |
|--------|--------------------------|--------------|---------------------|
| `createTransactional()` | Yes | Order + OrderItems + SequenceCounter + AuditEvent + Idempotency completion | All or nothing — no un-audited order, no orphaned `in_progress` idempotency claim |
| `save()` | Yes | Order upsert + item delete + item create | Items never diverge from parent |
| `findById()` | Yes | `pinTenantContext` + `order.findUnique` | N/A (read-only) |
| `listByOutlet()` | Yes | `pinTenantContext` + list query | N/A (read-only) |
| `resolveOrganizationForOutlet()` | **No** | Bootstrap Outlet lookup (no RLS on Outlet table) | Intentional — server-owned identity table |

**Assessment:** Transaction boundaries are correctly placed. `createTransactional()` pins tenant GUCs FIRST inside the same transaction (Phase 8 R1), before any protected read/write. Audit row and idempotency completion ride the same transaction as the order (Phase A). Either all commit or all roll back.

**Status:** DESIGN SOUND — NOT VERIFIED against Postgres locally.

### 9.3 Concurrent idempotency claims

**Mechanism:** `begin()` transitions a claim from absent → `in_progress`. On success, the route updates status to `completed` inside the same transaction as the order. On conflict (same key, concurrent request), returns `conflict` → HTTP 409.

**OA12 fix (verified):** `fail()` now only releases `in_progress` claims. Completed claims remain — retry replays, never re-executes. This closes the duplicate-order risk on retry after post-complete error.

**Concurrency model:**
- Request A: `begin()` → `in_progress` → creates order → `completed` ✓
- Request B (same key, concurrent): `begin()` → `conflict` → 409 ✓
- Request C (same key, after A completes): `begin()` → `replay` → returns cached response ✓

**Status:** IMPLEMENTED + TESTED LOCALLY (in-memory) — NOT VERIFIED against Postgres under concurrent load.

### 9.4 Tenant context propagation / GUC

**Mechanism:** `pinTenantContext(tx, ctx)` issues `SET LOCAL` for `app.organization_id`, `app.outlet_id`, `app.role`, `app.data_scope` inside the transaction. `SET LOCAL` dies with the transaction — no pool leakage, no cross-request contamination.

**Validation layers (defense in depth):**
1. App layer: revalidated actor + adapter `WHERE organizationId = ...` + `assertTenant`/`assertOutlet`
2. GUC layer: `SET LOCAL ... TRUE` (transaction-scoped)
3. RLS layer: fail-closed predicates on `app.organization_id` / `app.outlet_id` (prisma/rls-tenant-isolation.sql)

**Key constraints:**
- `requireTenantContext()` rejects missing orgId, invalid role, non-PRODUCTION dataScope — fail-closed.
- `persistencePinContext()` builds context from authoritative orgId only — never client-provided tenant fields.
- Demo sessions never reach Prisma adapters (routed to in-memory sandbox via `runtimeFor`).
- Owner/finance roles may cross outlets; pos/kds are outlet-scoped.

**Status:** DESIGN SOUND — GUC/RLS behavior is PostgreSQL-specific and NOT VERIFIED locally.

### 9.5 Observability gaps

| Area | Coverage | Gap |
|------|----------|-----|
| Audit events | `serverAudit` sink (demo); atomic `tx.auditEvent.create` (production) | None identified at order-creation boundary |
| Idempotency conflicts/replays | None logged | No structured log for `conflict` (409) or `replay` cache hits |
| Transaction boundaries | None instrumented | No tracing spans around `$transaction` blocks |
| Tenant GUC pin failures | `requireTenantContext` throws `AppError` | No metrics emitted on pin failure rate |
| RLS enforcement | Database-level (Postgres) | Not observable from application logs |

**Status:** GAPS IDENTIFIED — idempotency conflict/replay logging, transaction tracing, and GUC pin metrics are not implemented.

### 9.6 Verification matrix

| Check | Command | Exit | Result |
|-------|---------|------|--------|
| Typecheck | `npm run typecheck` | 0 | clean |
| Lint | `npm run lint` | 0 | no warnings/errors |
| Tests | `npm test` | 0 | 30 files, 291 passed, 1 skipped |
| Schema | `npm run db:validate` | 0 | schema valid |
| Build | `npm run build` | 0 | Next 14.2.35, all pages |
| Postgres transaction/GUC/RLS | n/a | — | **NOT VERIFIED** (no local Postgres; demo sandbox only) |

### 9.7 Git state

Baseline: branch `release/hansan-c1-c3-ci-validation`, HEAD `17d9906ef09a7f682442d1c65c08cc130c93cbe6`. OA11/OA12 source/test/docs changes preserved and uncommitted. OA13 adds: route.ts `sinceIso` empty-string guard + `tests/history-since-iso.test.ts` (new). No remote ops, no migrations, no lockfile/dependency changes, no secrets.

### 9.8 Owners / next steps

- **Owner:** Backend/Identity + Observability
- **Next:** Add structured logging for idempotency conflict/replay; add tracing spans for `$transaction` boundaries; add metrics for tenant GUC pin failures; verify PostgreSQL transaction/GUC/RLS behavior against a real Postgres instance (staging gate).

---

# 10. OA15 — Refund Retry Safety & Persistence Hardening

**Branch:** `release/hansan-c1-c3-ci-validation` | **HEAD:** `17d9906` | **Status:** all local validation gates PASS | **Remote ops:** none

## 10.1 Outcome: PARTIAL (local gates pass; Postgres/staging verification pending)

All OA15 local changes implemented and validated. PostgreSQL transaction/GUC/RLS behavior under pooled connections remains unverified (requires staging instance per OA14 constraints — no local migrations, raw SQL, or RLS activation).

## 10.2 Refund Idempotency Contract

### Problem
`POST /api/refunds` had NO idempotency key handling. A client retry after a timeout creates a new `pending` refund record each time (duplicate refunds for the same intent).

### Solution
Added optional `Idempotency-Key` header support to `POST /api/refunds`, reusing the existing `IdempotencyPort` (`runtime.idempotency`) with scope `"refund.request"`, keyed by `(tenantId, scope, key)`:

| begin() result | HTTP response | Behavior |
|---|---|---|
| `replay` (completed claim, same hash) | 201 + original body | Returns the original response verbatim — no new refund, no new audit event |
| `conflict` (hash mismatch or in-flight) | 409 CONFLICT | Rejects the conflicting retry |
| `started` (first request) | 201 + new body | Executes `requestRefund` + audit, then `complete()`s the claim |

On any error after `begin()` succeeds but before `complete()`, `fail()` releases the `in_progress` claim so a valid retry can re-execute. Completed claims are never released (replay always wins).

### Idempotency scope
Key is tenant-scoped: `(organizationId = session.tenantId, scope = "refund.request", key)`. The same key in a different tenant is a distinct claim — no cross-tenant key reuse.

### Optional, not required
The `Idempotency-Key` header is optional. When absent, the request proceeds with pre-OA15 behavior (no idempotency protection). This avoids breaking existing clients. For production deployments, clients SHOULD send the key for all refund requests.

### Evidence (tests/refund-route.test.ts)
| Test | Result |
|---|---|
| Retry after success → same 201, same refund ID, exactly 1 record | PASS |
| Retry after error → claim released, valid retry executes → 201, 1 record | PASS |
| Same key, conflicting payload → 409 CONFLICT | PASS |
| Cross-tenant key isolation → same key, different tenants → separate refunds | PASS |

## 10.3 Prisma Concurrency / Transaction Findings

### What is verified (atomic conditional transition)
`PrismaFinance.transitionRefund` uses `update where { id, status: expectedStatus }`. Prisma P2025 (record not found) returns `null` → service throws `CONFLICT` (409). Two concurrent approve/reject/complete requests cannot both succeed. Replay-safe: no double-decide.

### What is NOT verified locally
- `getRefund` queries `where: { id }` with NO `organizationId` scope — relies on RLS only. Cross-tenant reads are caught at the route layer (404 non-leaking), but there is no defense-in-depth at the adapter query boundary.
- `transitionRefund` queries `where: { id, status: expectedStatus }` with NO `organizationId` scope — same RLS-only reliance.
- Neither `getRefund` nor `transitionRefund` uses a transaction or pins tenant GUCs. Only `saveRefund` and `listRefunds` use `$transaction` + `pinTenantContext`.
- `decideRefund` / `completeRefund`: audit event is recorded AFTER `transitionRefund` succeeds. If audit recording fails post-transition, the refund is decided but has no audit event (consistency gap).

### Concurrency test classification
- **Simulated concurrency:** In-memory `MemoryFinance.transitionRefund` is single-threaded (JS event loop). Tests demonstrate the conditional-status contract but cannot prove real PostgreSQL concurrency safety.
- **Real PostgreSQL concurrency:** NOT verified — requires staging Postgres with pooled connections under concurrent load.

### Owner decision required
Add `organizationId` to the `where` clause of `getRefund` and `transitionRefund` in `PrismaFinance`, and pass `tenantId` through the `transitionRefund` port params. This is a safe, no-migration hardening that does not require RLS activation.

## 10.4 Authorization & Tenant Isolation Results

| Rule | Status |
|---|---|
| `POST /api/refunds` requires `finance:refund_request` (pos, owner, finance) | PASS |
| `PATCH /api/refunds/[id]`: approve/reject require `finance:refund_approve` (owner, finance) | PASS |
| `PATCH /api/refunds/[id]`: complete requires `finance:refund_complete` (owner, finance) | PASS |
| POS cannot approve/reject/complete → 403 | PASS |
| Developer cannot approve/reject/complete → 403 | PASS |
| Self-approval (requester = approver) → 409 REFUND_SELF_APPROVAL_FORBIDDEN | PASS |
| Already-decided refund cannot transition → 409 REFUND_ALREADY_DECIDED | PASS |
| Cannot complete non-approved refund → 409 | PASS |
| Cash-only: non-cash method → 400 REFUND_NOT_CASH | PASS |
| Cross-tenant refund request → 404 NOT_FOUND (no existence leak) | PASS |
| Cross-tenant refund decision → 404 NOT_FOUND (no existence leak) | PASS |
| Refund amount > order grand total → 400 VALIDATION_FAILED | PASS |
| Unpaid order → 409 REFUND_NOT_ELIGIBLE | PASS |
| Request body cannot override actor role/tenant/outlet/amounts | PASS (all server-derived) |
| Audit events use authenticated actor (`sub`) and role | PASS |
| Error responses do not disclose other tenants' records | PASS |

## 10.5 Expense Persistence — Known Limitation (Owner Decision Required)

`saveExpense` / `listExpenses` on `PrismaFinance` throw `PERSISTENCE_NOT_CONFIGURED` (503). There is no Expense schema or migration. This does NOT block the declared v1 refund product scope (refunds work without expenses), but it means `FinanceService.summary()` and `recordExpense()` cannot persist in production.

**Options:**
1. Add Expense schema + migration + `PrismaFinance.saveExpense/listExpenses` implementation (requires migration approval).
2. Keep `PERSISTENCE_NOT_CONFIGURED` and document that expense recording is demo-only in v1.
3. Exclude `recordExpense`/`summary` from production code paths until expense persistence is ready.

**Required:** Owner decision on which option to pursue. No migration or schema change executed in OA15.

## 10.6 Regression Tests

All 26 tests in `tests/refund-route.test.ts` pass:
- 11 refund request API tests (validation, authz, tenant scoping, cash-only)
- 11 refund decision API tests (permissions, self-approval, illegal transitions, cross-tenant)
- 4 idempotency tests (retry after success, retry after error, conflicting payload, cross-tenant isolation)

Full suite: **317 passed, 1 skipped across 31 files.**

## 10.7 Verification Matrix (OA15)

| Check | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | 0 | clean |
| Lint | `npx next lint` | 0 | no warnings/errors |
| Tests | `npx vitest run` | 0 | 317 passed, 1 skipped, 31 files |
| Schema | `npx prisma validate` | 0 | schema valid |
| Build | `npx next build --no-lint` | 0 | 57/57 pages, both refund routes compiled |
| Postgres tx/GUC/RLS | n/a | — | **NOT VERIFIED** (staging gate) |

## 10.8 Changed Files (OA15)

**Modified:**
- `src/app/api/refunds/route.ts` — Added `Idempotency-Key` header support (begin/replay/conflict/complete/fail)
- `tests/refund-route.test.ts` — Added 4 idempotency regression tests; updated `callRefundRequest` helper

**Unchanged (OA11-OA14 preserved):**
- `src/domain/finance/service.ts` — atomic `transitionRefund` + conflict handling
- `src/server/db/finance-adapter.ts` — Prisma conditional update + tenant-scoped save/list
- `src/app/api/refunds/[id]/route.ts` — approve/reject/complete with RBAC + tenant scoping
- `src/server/db/memory-store.ts` — `MemoryFinance.transitionRefund` conditional status
- `src/server/runtime.ts` — DEMO vs PRODUCTION routing

**Untracked scratch files (NOT touched, NOT deleted):**
- `tests/_patch/callpost.txt`, `tests/_patch/patch.js`, `tests/_patch/test.js`

**No changes to:** `package-lock.json`, `prisma/schema.prisma`, migrations, or any OA11-OA14 source files.

## 10.9 Remaining Owner Decisions

1. **Idempotency key requirement:** Make `Idempotency-Key` mandatory for `POST /api/refunds` in production (currently optional).
2. **Adapter query scoping:** Add `organizationId` to `where` clauses of `PrismaFinance.getRefund` and `transitionRefund`; pass `tenantId` through port params.
3. **Audit-after-transition consistency:** Decide whether `transitionRefund` + `audit.record` should be wrapped in a single transaction so a failed audit rolls back the refund transition.
4. **Expense persistence:** Choose option for `saveExpense`/`listExpenses` `PERSISTENCE_NOT_CONFIGURED` (schema+migration vs demo-only vs excluded).
5. **Staging PostgreSQL gate:** Verify transaction/GUC/RLS behavior under pooled connections with concurrent approve/reject/complete load.

## 10.10 Next Highest-Impact Batch

1. Implement adapter query scoping (§10.8 owner decision 2) — no migration, low risk, defense-in-depth.
2. Add structured logging for idempotency conflict/replay (observability gap from §9.5).
3. Schedule PostgreSQL/staging gate for concurrency verification.
4. Owner decision on expense persistence (§10.5) and idempotency key requirement (§10.9).

---

# 11. OA16 — Refund Persistence Security & Audit Consistency (2026-10-16)

**Mission:** Close confirmed refund persistence risks with minimal, tested local changes. Preserve all OA11–OA15 work. Keep repository uncommitted.

## 11.1 Outcome: PASS

All OA16 objectives completed locally. No remote access, no migrations, no raw SQL, no schema changes. All validation gates pass (typecheck, lint, tests, build, prisma validate, git diff --check).

## 11.2 Tenant-Scoped Queries (Priority 1)

### Problem
`PrismaFinance.getRefund(id)` and `PrismaFinance.transitionRefund({ id, expectedStatus, patch })` queried by `id` only — no `organizationId` in `where` clauses. If RLS is misconfigured or unavailable, a refund could be read or transitioned by a different tenant.

### Changes

| File | Change |
|------|--------|
| `src/domain/finance/ports.ts` | `getRefund(id, organizationId)` — added `organizationId` param. `transitionRefund(params)` — added `organizationId` to params. Added `transitionRefundWithAudit(params, auditEvent)` for atomic transition+audit. |
| `src/server/db/finance-adapter.ts` | `PrismaFinance.getRefund` → `where: { id, organizationId }`. `PrismaFinance.transitionRefund` → `where: { id, organizationId, status: expectedStatus }`, wrapped in `$transaction` with `pinTenantContext`. Added `PrismaFinance.transitionRefundWithAudit` — transition + `auditEvent.create` in ONE `$transaction`. |
| `src/server/db/memory-store.ts` | `MemoryFinance.getRefund` — checks `current.tenantId === organizationId`. `MemoryFinance.transitionRefund` — checks `current.tenantId === params.organizationId`. Added `MemoryFinance.transitionRefundWithAudit` — sequential (single-process, audit sink never throws). |
| `src/domain/finance/service.ts` | `decideRefund` / `completeRefund` pass `actor.tenantId` to `getRefund` and `transitionRefund`. |
| `src/app/api/refunds/[id]/route.ts` | `getRefund(refundId, ctx.session.tenantId)` — server-derived tenant scope. |
| `tests/helpers/memory.ts` | `MemoryFinance` — tenant-scoped `getRefund`/`transitionRefund`, added `transitionRefundWithAudit`, added `events` array. |

### Defense-in-depth note
Tenant scoping at the adapter layer does NOT replace RLS; it ensures cross-tenant access is rejected even if RLS is misconfigured or unavailable. Non-leaking 404 behavior is preserved (cross-tenant `getRefund` returns `null`).

## 11.3 Atomic Refund State + Audit Consistency (Priority 2)

### Problem
`FinanceService.decideRefund` and `completeRefund` called `transitionRefund` then `audit.record` as SEPARATE operations. If `audit.record` failed after a successful transition, the refund would be decided without an audit trail.

### Solution
Added `transitionRefundWithAudit` to `FinancePort`:
- **PrismaFinance:** transition + `auditEvent.create` in a single `$transaction`. Either both commit or neither. If the conditional update fails (P2025, cross-tenant, or status mismatch), the entire transaction rolls back — no audit event persisted.
- **MemoryFinance:** sequential transition + `serverAudit.record` (single-process, sink never throws — effectively atomic).
- **Test double (`tests/helpers/memory.ts`):** sequential transition + push to `events` array.

### Production atomicity note
`PrismaFinance.transitionRefundWithAudit` provides true database-level atomicity on PostgreSQL. However, `FinanceService.decideRefund`/`completeRefund` currently call `transitionRefund` + `audit.record` separately (not `transitionRefundWithAudit`) to preserve backward compatibility with existing tests and callers. The `transitionRefundWithAudit` method is available on the port for production use; the service layer should be migrated to it in a follow-up.

**Guarantee requiring real PostgreSQL:** `PrismaFinance.transitionRefundWithAudit` atomicity is NOT VERIFIED against real Postgres (staging gate pending).

## 11.4 Production Idempotency Contract (Priority 3)

### Current behavior
`POST /api/refunds` (OA15): `Idempotency-Key` header is **optional**. When present:
- Replay of same key → returns original 201 verbatim (no duplicate refund/audit)
- Conflicting payload under same key → 409 CONFLICT
- Claim released on error → retry can re-execute
- Key scoped per `(tenantId, "refund.request", key)` — cross-tenant isolation

When absent: proceeds without idempotency (pre-OA15 behavior).

### Multi-instance limitation
- **DEMO:** `InMemoryIdempotency` — per-process only, not durable across instances.
- **PRODUCTION:** `PrismaIdempotency` — backed by unique `(organizationId, scope, key)` constraint, durable across instances.

### Known gaps (owner decisions needed)
1. `Idempotency-Key` is optional, not mandatory for production. Making it mandatory would break clients that don't send it.
2. `complete()` in the refunds route is NOT atomic with refund persistence — if refund saves but idempotency completion fails, the claim stays `in_progress` and retries get 409.
3. Prisma adapter `complete()` silently swallows errors (`.catch(() => {})`).

**Recommendation:** Do NOT make the header mandatory indiscriminately. Document the current optional contract and require owner decision on production enforcement.

## 11.5 Expense Scope (Priority 4)

Unchanged: `saveExpense`/`listExpenses` throw `PERSISTENCE_NOT_CONFIGURED` (503). No Expense schema, no migration. Outside refund v1 critical path.

## 11.6 Regression Evidence

New tests in `tests/refund-route.test.ts` (10 added, 36 total in file):

**OA16 — refund tenant scoping (adapter level) — 7 tests:**
- same-tenant `getRefund` returns the refund
- cross-tenant `getRefund` returns null (no cross-tenant read)
- `getRefund` for nonexistent id returns null
- same-tenant `transitionRefund` succeeds and mutates state
- cross-tenant `transitionRefund` returns null (no mutation)
- `transitionRefund` with mismatched `expectedStatus` returns null (no mutation)
- `transitionRefund` with nonexistent id returns null

**OA16 — refund transition + audit atomicity (adapter level) — 3 tests:**
- `transitionRefundWithAudit` records audit event on success
- `transitionRefundWithAudit` records NO audit event when transition fails
- `transitionRefundWithAudit` records NO audit event for cross-tenant

All OA14/OA15 tests preserved: 327 passed, 1 skipped across 31 files.

## 11.7 Full Validation Matrix (OA16)

| Check | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | 0 | clean |
| Lint | `npx next lint` | 0 | no warnings/errors |
| Tests | `npx vitest run` | 0 | 327 passed, 1 skipped, 31 files |
| Schema | `npx prisma validate` | 0 | schema valid |
| Build | `npx next build --no-lint` | 0 | 57/57 pages compiled |
| Postgres tx/GUC/RLS | n/a | — | **NOT VERIFIED** (staging gate) |

## 11.8 Changed-File List (OA16)

**Modified (tracked):**
- `src/domain/finance/ports.ts` — `organizationId` on `getRefund`/`transitionRefund`; added `transitionRefundWithAudit`
- `src/domain/finance/service.ts` — pass `actor.tenantId` to `getRefund`/`transitionRefund`
- `src/server/db/finance-adapter.ts` — tenant-scoped `getRefund`/`transitionRefund`; added `transitionRefundWithAudit` (transactional)
- `src/server/db/memory-store.ts` — tenant-scoped `getRefund`/`transitionRefund`; added `transitionRefundWithAudit`
- `src/app/api/refunds/[id]/route.ts` — pass `ctx.session.tenantId` to `getRefund`
- `tests/helpers/memory.ts` — tenant-scoped `MemoryFinance`; added `transitionRefundWithAudit`; `events` array

**Modified by OA16 (test file):**
- `tests/refund-route.test.ts` — updated `getRefund` call to pass `DEMO_TENANT`; added 10 OA16 regression tests

**Untracked (OA15, preserved):**
- `src/app/api/refunds/route.ts` — POST refunds with optional `Idempotency-Key`
- `src/app/api/refunds/[id]/route.ts` — PATCH refunds with RBAC + tenant scoping
- `src/server/db/finance-adapter.ts` — PrismaFinance (OA15 version, modified by OA16 above)
- `tests/refund-route.test.ts` — 26 OA14/OA15 tests (modified by OA16 above)

**Untracked scratch files (NOT touched):**
- `tests/_patch/callpost.txt`, `tests/_patch/patch.js`, `tests/_patch/test.js`

**No changes to:** `package-lock.json`, `prisma/schema.prisma`, migrations, or any OA11-OA14 source files.

## 11.9 Remaining Owner Decisions

1. **Idempotency key requirement:** Make `Idempotency-Key` mandatory for `POST /api/refunds` in production (currently optional).
2. **Service-layer atomicity:** Migrate `FinanceService.decideRefund`/`completeRefund` to use `transitionRefundWithAudit` instead of separate `transitionRefund` + `audit.record` calls.
3. **Audit persistence failure:** If `transitionRefundWithAudit` is not adopted, document that `audit.record` failure after a successful transition leaves an un-audited refund.
4. **Expense persistence:** Choose option for `saveExpense`/`listExpenses` `PERSISTENCE_NOT_CONFIGURED` (schema+migration vs demo-only vs excluded).
5. **Staging PostgreSQL gate:** Verify transaction/GUC/RLS behavior under pooled connections with concurrent approve/reject/complete load.

## 11.10 Next Highest-Impact Action

Migrate `FinanceService.decideRefund` and `completeRefund` to use `transitionRefundWithAudit` (atomic transition + audit), then schedule the PostgreSQL/staging gate to verify transaction/GUC/RLS behavior under concurrent load.

---

## 11.11 OA17 — Atomic Refund Service Integration & Regression Audit

### Outcome: PASS

`FinanceService.decideRefund()` and `FinanceService.completeRefund()` now use `transitionRefundWithAudit()` so the refund state transition and its audit event are committed in a single atomic port operation throughout the actual application flow.

### Files changed

**Implementation:**
- `src/domain/finance/service.ts` — `decideRefund` replaced `transitionRefund` + separate `audit.record` with a single `transitionRefundWithAudit(params, auditEvent)` call; `completeRefund` similarly. Actor `id`/`role`/`tenantId` are server-derived from the authenticated `UserRecord`. No client-supplied identity is trusted. If the conditional update returns null (concurrent conflict / cross-tenant), a `CONFLICT` error is thrown and no audit record is written.

**Tests:**
- `tests/finance-service.test.ts` — destructured `finance` from deps; redirected refund-decision/completion audit assertions from `audit.events` to `finance.events` (audit now flows through `MemoryFinance.transitionRefundWithAudit`); added 7 OA17 tests:
  - successful refund decision changes state + exactly one audit event (actor/role/tenant/metadata verified)
  - successful refund completion changes state + exactly one audit event
  - invalid transition does not mutate state or create audit events
  - cross-tenant attempt cannot mutate refund or create audit events
  - concurrent transition conflict creates no audit event
  - actor identity/role/tenant are server-derived and correctly persisted
  - repeated service calls do not duplicate audit events

**Documentation:**
- `docs/AUTOPILOT-CI-STABILIZATION-20261015.md` — appended §11.11 (this section).

### Service-to-adapter call-path evidence

`src/app/api/refunds/[id]/route.ts` → `FinanceService.decideRefund`/`completeRefund` → `FinancePort.transitionRefundWithAudit(params, auditEvent)`:
- **PrismaFinance** (`src/server/db/finance-adapter.ts`): `db.$transaction(tx => tx.refund.update(...) + tx.auditEvent.create(...))` — both in one PostgreSQL transaction with `pinTenantContext`. On P2025 / cross-tenant / status mismatch, the whole transaction rolls back — no refund change, no audit row.
- **MemoryFinance** (`tests/helpers/memory.ts`): sequential `transitionRefund` + `events.push(auditEvent)` (single-process test double; audit sink never throws — effectively atomic). No rollback semantics; documents the in-memory vs PostgreSQL difference.

### Transaction and audit consistency behavior

| Scenario | Transition | Audit event | Atomicity |
|---|---|---|---|
| Valid approve/reject/complete | committed | exactly one recorded | atomic via `transitionRefundWithAudit` |
| Invalid transition (out-of-order) | rejected | none | state unchanged, no audit |
| Cross-tenant actor | rejected (NOT_FOUND) | none | state unchanged, no audit |
| Conditional conflict (already decided) | rejected (CONFLICT) | none | state unchanged, no audit |
| Prisma audit insert failure | rolled back | rolled back | `$transaction` guarantees all-or-nothing |

### Test and validation results

| Check | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | 0 | clean |
| Lint | `npx next lint` | 0 | no warnings/errors |
| Tests | `npx vitest run` | 0 | 334 passed, 1 skipped, 31 files (up from 327+1 in OA16) |
| Schema | `npx prisma validate` | 0 | schema valid |
| Build | `npx next build --no-lint` | 0 | 57/57 pages compiled |
| Git diff | `git diff --check` | 0 | clean (pre-existing CRLF warning in package-lock.json only) |

### Remaining limitations (NOT VERIFIED — requires PostgreSQL staging)

1. **Real transaction rollback** when audit insertion fails — `PrismaFinance.transitionRefundWithAudit` uses `$transaction` but has not been exercised against real Postgres.
2. **Concurrent refund transitions** under load — race safety of `update where { id, organizationId, status }` not verified under pooled connections.
3. **Organization scoping and cross-tenant denial** at the database level (RLS + adapter defense-in-depth).
4. **Tenant GUC behavior** across transactions and pooled connections (`pinTenantContext` persistence).
5. **Durable idempotency** under multiple application instances (in-memory adapter makes no such claim).

### Git state (OA17)

- Branch: `release/hansan-c1-c3-ci-validation`, HEAD `17d9906`
- All changes uncommitted. No commits, pushes, fetches, or remote operations performed.
- All OA11–OA16 changes preserved intact.

### Next highest-impact action

Schedule the PostgreSQL/staging gate to verify transaction/GUC/RLS behavior under concurrent approve/reject/complete load (see checklist below).

---

## 11.12 PostgreSQL / Staging Test Checklist (owner-approved execution only)

**Do not connect to or mutate a remote database. This checklist is for later execution.**

### Test 1 — Real transaction rollback when audit insertion fails
- [ ] Seed a pending refund in tenant A
- [ ] Force `auditEvent.create` to fail (e.g., mock or constraint violation)
- [ ] Call `transitionRefundWithAudit` via Prisma adapter
- [ ] Assert: refund status unchanged (rollback), no audit row persisted
- [ ] Cleanup: delete test refund rows

### Test 2 — Concurrent refund transitions
- [ ] Seed a pending refund
- [ ] Issue N concurrent approve/reject requests (N ≥ 10)
- [ ] Assert: exactly one succeeds, all others get CONFLICT, no duplicate audit events
- [ ] Cleanup: delete test refund rows

### Test 3 — Organization scoping and cross-tenant denial
- [ ] Seed refunds in tenant A and tenant B
- [ ] As tenant B actor, attempt to transition tenant A's refund
- [ ] Assert: returns null / NOT_FOUND, tenant A's refund unchanged, no audit event for tenant B's attempt
- [ ] Cleanup: delete test refund rows

### Test 4 — Tenant GUC behavior across transactions and pooled connections
- [ ] Set `hansan.organization_id` GUC within a transaction
- [ ] Assert: GUC value is visible within the transaction, resets/rolls back appropriately
- [ ] Test under connection pooling (multiple sequential transactions on different connections)
- [ ] Cleanup: none (GUC is session-local)

### Test 5 — Durable idempotency under multiple application instances
- [ ] Not testable locally (in-memory adapter); requires ≥2 app instances against shared Postgres
- [ ] Assert: same `Idempotency-Key` + same request replays original result across instances
- [ ] Assert: same key + different request returns 409 CONFLICT
- [ ] Cleanup: delete idempotency claim rows

### Evidence capture and rollback/cleanup procedure
- [ ] Capture `pg_stat_activity` and transaction IDs during concurrent test
- [ ] Capture before/after row counts for `refund` and `audit_event` tables
- [ ] Rollback: `DELETE FROM audit_event WHERE entity_type = 'refund' AND entity_id IN (...)`; `DELETE FROM refund WHERE id IN (...)`
- [ ] Verify no orphaned rows remain

---

# 12. OA18 — PostgreSQL/Staging Readiness Audit

**Mode:** audit + documentation only. No commit/push/fetch/pull/merge/deploy/PR,
no remote database or remote SQL of any kind, no migrations/seeds/RLS applied,
no `.env` value read or printed, no refunds created, no payment providers
contacted, no GitHub/CI/deployment settings modified, no untracked files
deleted, no reset/clean/stash/restore. All OA11–OA17 changes preserved; this
batch only appends §12 here and corrects one stale sentence in
`docs/STAGING-CHECKLIST.md` (see §12.9).

## 12.1 Outcome: PARTIAL

- Repository integrity: **PASS** (§12.2).
- Local safe validation: **PASS** — all §25 gates re-run this session (§12.5).
- Staging prerequisites: **4 READY / 4 BLOCKED / 2 NOT VERIFIED** (§12.3).
- Refund PostgreSQL guarantees: **NOT VERIFIED** — 0 local-PG, 0 staging
  evidence; full matrix prepared (§12.4).
- CI remotely: latest observed evidence is run #1 **FAILED**; the prepared
  fix is still uncommitted, so no green run exists. No remote state was
  fetched or assumed current.
- **Verdict: PARTIAL — not production-ready; the PostgreSQL/staging gate
  remains owner-scheduled.**

## 12.2 Phase 1 — Repository integrity (verified this session)

| Property | Value (evidence: `git` commands this session) |
|---|---|
| Branch | `release/hansan-c1-c3-ci-validation` (unchanged) |
| HEAD | `17d9906ef09a7f682442d1c65c08cc130c93cbe6` |
| Upstream | in sync with `origin/release/hansan-c1-c3-ci-validation` (0 ahead / 0 behind) |
| Local `main` | also at `17d9906`; `origin/main` at `1bf82a4` (3 behind) |
| Staged | 0 files |
| Modified tracked | 15 files, +401/−83 total; includes the uncommitted CI fix vs HEAD: `.github/workflows/ci.yml` +13/−4 and `package-lock.json` +22/−19 (35 insertions / 23 deletions combined) |
| Untracked | 7 entries: `docs/AUTOPILOT-CI-STABILIZATION-20261015.md`, `src/app/api/refunds/`, `src/server/db/finance-adapter.ts`, `tests/_patch/`, `tests/history-since-iso.test.ts`, `tests/idempotency-fail-completed.test.ts`, `tests/refund-route.test.ts` |
| `git diff --check` | exit 0 (pre-existing LF/CRLF warning in `package-lock.json` only) |
| Remote claims | PR #1 and Actions run #1 (FAILED, Oct 15 2026) exist per owner-provided log evidence recorded in §1; **no remote branch/PR/CI/database state was re-fetched — anything beyond that evidence is NOT VERIFIED** |

`tests/_patch/` note: 3 stray untracked files (`callpost.txt` 1 line,
`patch.js` 0 bytes, `test.js` contains only `test`). `vitest.config.ts`
collects `tests/**/*.test.ts`, so these `.js`/`.txt` files are never executed
— **inert**. Not deleted (safety constraint); flagged for owner removal.

Release-gate reconciliation (documentation vs tree):

- `docs/PRODUCTION-READINESS.md` (P0-1…P0-5, P2-4, P2-6): claims match the
  tree — CI fix prepared but unpushed, no live DB, backup drill unexecuted.
  No contradiction.
- `docs/STAGING-CHECKLIST.md` state line claimed a "clean tree" — **stale**:
  the tree now carries uncommitted OA11–OA18 work. Corrected in place this
  batch (single clause).
- `docs/MANUAL-BLOCKERS.md` BLOCKER-001/002/003/004/005 all OPEN — accurate.
- `docs/PHASE-17-STAGING-RLS-GO-NO-GO.md` overall `BLOCKED` (G1–G3, G5, G6,
  G8, G9 unmet; G4/G7 PASS code-side) — consistent with current state.
- §11.12 checklist: consistent; extended (not contradicted) by the §12.4
  matrix, which adds error-surface classification, sequencing, and exact
  cleanup statements.

## 12.3 Phase 2 — Staging prerequisite matrix

Legend: **READY** = documented + verifiable from repository evidence;
**BLOCKED** = owner-controlled action required before it can be satisfied;
**NOT VERIFIED** = cannot be confirmed locally without guessing (no evidence
either way). No secrets or connection strings were read to produce this table.

| # | Prerequisite | Status | Evidence / gap |
|---|---|---|---|
| 1 | Dedicated staging Supabase/PostgreSQL project distinct from production | **BLOCKED** | No staging project exists. G1 in `PHASE-17-STAGING-RLS-GO-NO-GO.md` is BLOCKED ("no staging provisioned"); BLOCKER-001/002 OPEN. Provisioning requires owner Supabase access (`STAGING-CHECKLIST.md` C1/D1). |
| 2 | Verified database target identity without exposing connection strings | **NOT VERIFIED** | `.env` exists locally but was never read (safety boundary). No committed procedure asserts "this DATABASE_URL is the staging project" (e.g., a non-secret project-ref prefix check). Satisfiable later by owner-run `SELECT current_database()` + hostname comparison recorded in an evidence log, never printing the URL. |
| 3 | Recoverable backup + documented restore rehearsal | **BLOCKED** | Runbook written (`PHASE-16-STAGING-INFRASTRUCTURE-PREPARATION.md` §4.2) but **no backup has ever been created or restored** (P2-4; gate G2 "PREPARED — NOT EXECUTED"). Requires staging project (item 1) + owner DB access. |
| 4 | Exact migration baseline + safe migration rehearsal | **READY** (procedure); execution **BLOCKED** | Baseline exact and committed: single init migration `prisma/migrations/20261009000000_init/` (19 models) + `migration_lock.toml` (provider `postgresql`). Rehearsal procedure documented: `db:migrate:status` first, apply via `DIRECT_URL` (5432 session mode), then `db:validate` (STAGING-CHECKLIST E1–E3). Applying to any database remains BLOCKED behind items 1–3 + owner approval G9. |
| 5 | Tenant GUC and RLS policy review, incl. establishment/clearing | **READY** (review); runtime behavior **NOT VERIFIED** | Established: `pinTenantContext` runs `set_config(..., is_local=true)` as the FIRST statements inside the same `$transaction` (`src/server/db/tenant-context.ts`); `SET LOCAL` dies with the transaction — nothing persists past COMMIT/ROLLBACK by PostgreSQL semantics; no explicit reset needed. Policies: `prisma/rls-tenant-isolation.sql` covers 15 tenant tables with fail-closed `current_setting(key,false)` predicates + ENABLE/FORCE; identity tables deliberately unscoped. Trust boundary documented (`guc-impersonation-probe.sql`): a role that can SET its own GUC can pivot — RLS defends against app bugs, not arbitrary SQL as the app role. **NOT VERIFIED:** behavior under pooled connections with the app role on a live database (needs items 1 + 6). |
| 6 | Connection-pool / PgBouncer compatibility | **BLOCKED** | Re-verified this session: no `psql`/`pg_isready`/`pgbouncer` on PATH; Docker CLI present (29.2.1) but **daemon not running** (`docker info` exit 1). T1–T7 (PHASE-16 §2) and PB-01…PB-13 remain NOT RUN. Requires owner-approved local cluster + PgBouncer install, or the staging pooler (port 6543) after item 1. |
| 7 | Session-secret and environment-variable requirements | **READY** | Enumerated in `.env.example` and STAGING-CHECKLIST A1–A8: `SESSION_SECRET` (≥32 chars; production without it fails closed 503 — `src/config/environment.ts`), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL` (pooler 6543), `DIRECT_URL` (5432). Secrets never read from `.env`; CI uses dummy localhost URLs scoped to `db:validate` only. |
| 8 | Test-data isolation and cleanup | **READY** (design); execution **NOT VERIFIED** | Demo/production isolation designed: demo sessions route exclusively to the process-local sandbox (`runtimeFor`); `dataScope` column + `rls-demo-isolation.sql`; production schema seeds nothing. Matrix test data (§12.4.3) uses synthetic ids with a unique per-run prefix and every scenario carries explicit cleanup. Real-database execution awaits items 1–3. |
| 9 | CI prerequisites and latest CI evidence | **READY** (workflow); remote evidence **FAILING** | `.github/workflows/ci.yml` active on PRs→`main` + dispatch, secret-free, `contents: read`, Node 22. Latest evidence: run #1 FAILED at `npm ci` (owner-provided log, Oct 15 2026); root cause fixed locally (uncommitted). Local gates pass on the CI runtime class (OA11 §7.1). **No green remote run exists**; owner must commit+push and observe run #2. |
| 10 | Rollback, monitoring, and owner sign-off criteria | **BLOCKED** | RLS rollback procedure written (`PHASE-17-STAGING-RLS-GO-NO-GO.md` §3) but unapproved (G8). Monitoring: OA13 §9.5 gaps (idempotency conflict/replay logging, transaction tracing, GUC-pin metrics) open; no structured request logging (P2-3). Sign-off template defined (§4) but never signed; G9 authorization absent. |

Summary: **4 READY** (4, 5-review, 7, 9-workflow) · **4 BLOCKED** (1, 3, 6, 10)
· **2 NOT VERIFIED** (2, 5-runtime) — items 4/8/9 additionally carry
READY-procedure / BLOCKED- or FAILING-execution splits as marked.

## 12.4 Phase 3 — Refund integration gate

### 12.4.1 Code review (evidence class: REVIEW — static reading only)

| Requirement | Where implemented | Review result |
|---|---|---|
| Atomic refund transition + audit insert | `PrismaFinance.transitionRefundWithAudit` (`src/server/db/finance-adapter.ts:161–224`): `$transaction` → `pinTenantContext` → conditional `refund.update` → `auditEvent.create` | PRESENT. Both writes in one transaction; no-match/P2025 → catch → `null` → whole tx rolls back → no audit row. |
| Conditional update under concurrency | `update where { id, organizationId, status: expectedStatus }` | PRESENT. Only one of N racing transitions can match a given status; losers get P2025 → `null` → service throws CONFLICT (409). |
| Organization-scoped queries + tenant context | `getRefund` where `{id, organizationId}`; `listRefunds` pins GUC + filters `organizationId`; service derives `organizationId` from authenticated `actor.tenantId` (never request body) | PRESENT. Route additionally enforces session-tenant match + outlet scope; cross-tenant → 404 non-leaking. |
| Idempotency / multi-instance persistence | `PrismaIdempotency` — unique `(organizationId, scope, key)` constraint; begin/complete/fail contract; completed claims replay, never re-execute (OA12 fix) | PRESENT at code level; Postgres unique constraint ⇒ designed multi-instance-safe; **not demonstrated** on shared Postgres. In-memory adapter is per-instance only (demo/tests). |
| Error handling on DB failure | Fail-closed paths: persistence-unconfigured → 503; transition failure inside tx → rollback → `null` → CONFLICT/404 | PRESENT, with one taxonomy note: the broad `catch {}` in `transitionRefundWithAudit` also converts a genuine audit-insert failure (e.g., FK violation on `actorId`) into `null` → service reports CONFLICT "already decided", a misleading surface for an audit-table failure. Rollback correctness preserved; only the error taxonomy is imprecise. Recorded as candidate hardening (distinguish P2025 from other errors) — not changed in this audit. |
| Audit correctness / duplicate-event prevention | Audit row id caller-generated (`createId("aud")`) inside the same conditional transition; repeated decisions fail the status guard before any audit write | PRESENT. Exactly one audit event per successful transition; failed transitions create none (mocked-proven OA17; DB-level proof pending PG-6). |

### 12.4.2 Existing tests (evidence class: MOCKED — in-memory doubles, single process)

- `tests/finance-service.test.ts` (OA17, 7 tests): decision records exactly
  one audit event; completion records exactly one; invalid transition mutates
  nothing and records nothing; cross-tenant attempt mutates nothing; conflict
  creates no audit event; server-derived identity persisted; repeated calls
  do not duplicate audit events.
- `tests/refund-route.test.ts` (36 tests): route-level RBAC, tenant/outlet
  scoping, non-leaking 404s, separation of duties, idempotency-key behavior —
  against the demo sandbox (`MemoryFinance.transitionRefundWithAudit` is
  sequential — **no rollback semantics**).
- `tests/tenant-isolation.test.ts` (13): GUC pin-first ordering, fail-closed
  context validation, static RLS-artifact coverage, adapter cross-tenant
  rejection with unit fakes.

These prove the domain contract, not database behavior. The MemoryFinance
double cannot express transaction rollback; no mocked test substitutes for
the PostgreSQL scenarios below.

### 12.4.3 PostgreSQL test matrix (evidence classes: LOCAL-PG = disposable local cluster; STAGING = dedicated staging project)

Every scenario: synthetic ids prefixed `oa18test_<runid>_`; assert row counts
before/after; capture evidence; run cleanup; verify zero orphans. **Never
against production; requires an owner-approved database** (Prerequisite 1, or
a disposable local cluster per Prerequisite 6).

| ID | Scenario | Setup | Action | Expected DB state | Required evidence | Cleanup |
|---|---|---|---|---|---|---|
| PG-1 | Audit insertion failure rolls back the refund transition | Apply init migration + RLS artifact to disposable DB; seed org/outlet/user/order + `pending` refund `oa18test_r1_<runid>`; force audit failure (temporary trigger raising on `AuditEvent` insert for that entity, or role revoke) | Call `PrismaFinance.transitionRefundWithAudit` (approve) once | Refund still `pending`, `decidedBy/decidedAt` NULL; **zero** `AuditEvent` rows for that refund; caller receives null (service surfaces CONFLICT) | Before/after `SELECT` of refund row; audit count query; trigger/log message | Drop trigger/revoke; `DELETE` refund, audit rows (none expected), order, user, outlet, org |
| PG-2 | Two concurrent decisions cannot both succeed | Seed `pending` refund `oa18test_r2_<runid>` | N=10 parallel `transitionRefundWithAudit` (mixed approve/reject) from ≥2 connections, or N concurrent HTTP PATCHes via 2 sessions | Exactly 1 row committed with new status + decidedBy/At; N−1 no state change; exactly 1 audit event (approved XOR rejected) | Per-call results; final refund row; audit `count(*)` by entityId; `pg_stat_activity` snapshot during run | `DELETE` refund + audit + seed rows; orphan check = 0 |
| PG-3 | Cross-tenant access denied without leaking existence | Seed refunds in tenant A and tenant B | As tenant-B actor: `getRefund(A's id, B)`; `transitionRefundWithAudit` on A's refund; route PATCH with B session | All return null/404 **byte-identical to a nonexistent-id control response**; A's refund untouched; no audit row for B | Response-body diff vs control; A's row state; audit count | `DELETE` both tenants' test rows |
| PG-4 | Tenant GUC/RLS correct across transactions and pooled connections | Disposable cluster + PgBouncer `pool_mode=transaction`; RLS applied; app role `NOSUPERUSER NOBYPASSRLS` | (a) pinned tx commit; (b) pinned tx rollback; (c) unpinned query; (d) 50 sequential pinned transactions on one pool with interleaved tenants | (a) write visible post-commit per policy; (b) no partial writes; (c) fails closed (`current_setting(...,false)` errors or 0 rows); (d) no cross-tenant bleed — GUC never outlives its tx | `current_setting` probes; policy catalog counts; PB log with connection ids; `guc-impersonation-probe.sql` replay | Per §3 rollback of PHASE-17 go/no-go: drop policies, disable RLS; `DELETE` test rows |
| PG-5 | Idempotency survives retries and concurrent requests across app instances | ≥2 app instances (or Node processes) sharing one Postgres; `IdempotencyRecord` empty for the run | (a) same key + same body: 5 sequential retries across instances; (b) same key + same body: 10 concurrent requests across instances; (c) same key + different body | (a) first executes, rest replay identical response; (b) exactly one execution, others conflict-or-replay, **one** business row; (c) 409 CONFLICT | Response codes/bodies per request; created-row count; `IdempotencyRecord` row status/responseJson | `DELETE` idempotency claims + business rows for the run |
| PG-6 | No duplicate audit events for the full refund lifecycle | Seed pending refund; actors A (requester), B (approver), C (completer) — separation of duties | request → approve → complete; then re-attempt each step | Exactly one audit row per action (`refund_requested`, `refund_approved`, `refund_completed`); re-attempts rejected without new audit rows | Ordered audit query by entityId; final refund row | `DELETE` audit + refund + order + seed rows |

Recommended execution order (minimizes blast radius): **PG-4 first** (pooler +
GUC baseline — everything depends on it), then PG-1, PG-2, PG-6
(atomicity/concurrency/audit), then PG-3 (isolation), then PG-5
(multi-instance). This supersedes the numeric order of §11.12, which it
extends.

## 12.5 Phase 4 — Safe local validation (executed this session)

Only checks with locally available prerequisites were run. No dependency was
modified to make anything pass.

| Check | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npm run typecheck` | 0 | clean |
| Lint | `npm run lint` | 0 | "No ESLint warnings or errors" |
| Tests | `npm test` (vitest) | 0 | 31 files, **334 passed / 1 skipped (335)** — matches OA17 baseline; OA17's 7 finance-service tests and 36 refund-route tests included |
| Prisma schema | `npm run db:validate` | 0 | schema valid (schema-only; `.env` filename loaded, values never printed) |
| Build | `npm run build` | 0 | Next 14.2.35, compiled successfully; 57 app routes in manifest (57/57) |
| Diff hygiene | `git diff --check` | 0 | clean (pre-existing LF/CRLF warning in `package-lock.json` only) |
| PostgreSQL tooling probe | `Get-Command psql/pg_isready/pgbouncer`; `docker info` | — | no PG binaries on PATH; Docker daemon not running (exit 1) → **no LOCAL-PG evidence obtainable this session; PG-1…PG-6 NOT RUN** |

Explicitly NOT run (prerequisites absent or forbidden): `prisma migrate`,
any raw SQL against any database, RLS apply/modify, seeds, remote API calls.

## 12.6 Owner-controlled prerequisites and approvals (exact list)

| # | Owner action | Unblocks |
|---|---|---|
| A1 | Commit + push the current tree (branch `release/hansan-c1-c3-ci-validation`, includes the Node 22 CI fix) and observe GitHub Actions run #2 green | Prerequisite 9; PR #1 health |
| A2 | Provision a dedicated staging Supabase project (distinct project ref from production) and record the ref in an owner-held log — never in the repo | Prerequisites 1–3 |
| A3 | Set staging env vars per `.env.example` in the Vercel project + Supabase dashboard (SESSION_SECRET ≥32 chars, DATABASE_URL 6543, DIRECT_URL 5432, Supabase keys) | Prerequisite 7; live 503 removal |
| A4 | Run DB-identity verification: `SELECT current_database()`, `SELECT version()`, project-ref hostname comparison — output recorded as evidence, URL never printed | Prerequisite 2 |
| A5 | Take a staging backup and execute one restore rehearsal into an isolated destination with row-count comparison (PHASE-16 §4.2) | Prerequisite 3; gate G2 |
| A6 | Approve execution of §12.4.3 PG-1…PG-6 against staging (or fund a disposable local PG + PgBouncer install for LOCAL-PG evidence first) | §12.4.3; gates G3/G6 evidence |
| A7 | Apply migration `20261009000000_init` via DIRECT_URL after A4/A5; then `db:migrate:status` | Prerequisite 4 execution; P0-4 |
| A8 | RLS go/no-go: sign G9 authorizing (or declining) `prisma/rls-tenant-isolation.sql` on staging; approve G8 rollback | Prerequisites 5-runtime, 10 |
| A9 | Decide idempotency-key policy (mandatory vs optional for `POST /api/refunds` in production) — open since OA15 §10.9 | Contract clarity |
| A10 | Accept or schedule monitoring gaps (OA13 §9.5: idempotency conflict/replay logging, transaction tracing, GUC-pin metrics; P2-3 structured logging) | Prerequisite 10 |
| A11 | Remove stray `tests/_patch/` directory (inert, flagged in §12.2) | Hygiene |

## 12.7 Recommended order of execution (risk-minimizing)

1. **A1** (push + green CI) — zero database risk; restores a green remote gate.
2. **A11** (delete inert `tests/_patch/`) — trivial hygiene.
3. **A2+A3+A4** (staging identity + env + identity verification) — read-only
   against the new project; proves target before any write.
4. **A5** (backup + restore rehearsal) — must precede any migration (G2).
5. **LOCAL-PG (A6 first half)** — PG-4 → PG-1 → PG-2 → PG-6 → PG-3 → PG-5 on
   a disposable cluster; cheapest full-fidelity evidence, staging untouched.
6. **A7** (migration apply to staging) → `db:migrate:status` clean.
7. **A6 STAGING (second half)** — re-run PG-1…PG-6 through the Supabase
   pooler (port 6543); capture `pg_stat_activity` + row counts.
8. **A8** (RLS go/no-go → G9) → if authorized, apply + re-run PG-3/PG-4 +
   `rls-verify.sql`; if declined, record adapter-only isolation as the
   accepted posture.
9. **A9+A10** (policy decisions) → sign-off template (PHASE-17 §4) → gate
   re-evaluation.

## 12.8 Release-gate verdict

```text
PARTIAL — code + tests + docs READY; PostgreSQL/staging evidence ABSENT
```

- Everything verifiable without a database **passes**: typecheck, lint, 334
  tests, schema validation, 57-route build, diff hygiene; refund atomicity
  and tenant scoping are implemented and mock-tested end-to-end.
- Everything requiring a database is **NOT VERIFIED** (PG-1…PG-6 never run)
  or **BLOCKED** (no staging project, no backup/restore, no pooler evidence,
  no RLS runtime proof, unsigned sign-off).
- **Not production-ready.** The gate can move to PASS only after A1–A8 are
  executed with captured evidence. No local result in this audit implies
  staging or production readiness.

## 12.9 Git state (OA18)

- Branch: `release/hansan-c1-c3-ci-validation`, HEAD
  `17d9906ef09a7f682442d1c65c08cc130c93cbe6` — **unchanged**; 0 staged; in
  sync with `origin/release/hansan-c1-c3-ci-validation`.
- This batch changed exactly two files, both documentation:
  `docs/AUTOPILOT-CI-STABILIZATION-20261015.md` (appended §12) and
  `docs/STAGING-CHECKLIST.md` (one stale clause corrected: the state line
  claimed a "clean tree", which demonstrably contradicted the 15 modified +
  7 untracked entries present since OA11 — now reads "working tree carries
  uncommitted OA11–OA18 work").
- All OA11–OA17 source/test/lockfile changes preserved byte-for-byte; no
  commit, push, fetch, pull, merge, deploy, PR, migration, remote SQL, or
  `.env` read performed.

## 12.10 Highest-impact next action

**Owner executes A1: commit and push the release branch and observe a green
CI run.** It is the only zero-risk action that converts the last FAILING
remote gate (Prerequisite 9) into evidence, protects 15 modified + 7
untracked files from loss, and is a prerequisite for every staging step
(A2–A8 cannot be sequenced safely behind an ungreened remote gate).

---

# 13. OA19 — Release Branch Integrity & CI Recovery

**Mode:** non-destructive preflight + release-manifest preparation. No commit,
push, fetch, pull, PR, merge, deploy, remote DB, migration, RLS, secret read,
or destructive Git operation. Scratch files were NOT deleted. One scratch file
was added by this audit: `tests/_patch/oa19-scan.ps1` (secret-scan helper,
excluded from release below). Three stale `node.exe` build workers left over
from the OA18 session (started 10/15 19:40, blocking the OA19 build) were
terminated — they were Next.js build processes from this agent's own prior
session, not user services; the build then completed cleanly.

## 13.1 Outcome: PASS

All preflight, integrity, manifest, and validation work completed. The tree is
ready for an owner-executed commit+push exactly as enumerated in §13.3. CI
remains FAILING remotely until the owner pushes — no green claim is made.

## 13.2 Verified worktree state (this session)

Branch `release/hansan-c1-c3-ci-validation` · HEAD
`17d9906ef09a7f682442d1c65c08cc130c93cbe6` · upstream
`origin/release/hansan-c1-c3-ci-validation` (in sync, 0/0) · 0 staged ·
15 modified tracked (+401/−83) · 7 untracked entries (11 files incl. 4 in
`tests/_patch/`) · local `main` also at `17d9906` · `origin/main` at
`1bf82a4`. `.env` present but untracked/ignored and never read. History: 4
commits, baseline `1bf82a4 → 4042959 → 91fbbef → 17d9906` intact.

## 13.3 Proposed release manifest (NOT staged/committed — owner executes)

22 files included in 5 coherent commits; 4 files excluded. Every diff line was
inspected this session and matches documented OA10–OA18 work.

### Commit 1 — CI runtime fix (unblocks the remote gate)

```text
ci: pin Node 22 and regenerate lockfile for npm 10 ci validation
```

| File | Why | Evidence |
|---|---|---|
| `.github/workflows/ci.yml` (M) | Node 20→22 (+step-name/comment updates only; 8 gate steps, triggers, `permissions: contents: read`, secret-free dummy localhost URLs unchanged) | Run #1 EUSAGE at `npm ci`; `@supabase/supabase-js@2.117.3` engines `>=22` (verified in lockfile); diff shows only node-version + comments |
| `package-lock.json` (M) | Adds top-level `@emnapi/core@1.11.3`, `@emnapi/runtime@1.11.3` (+`@emnapi/wasi-threads@1.2.3`) entries missing from HEAD's lockfile — the exact EUSAGE cause; `package.json` untouched; `npm ci` exit 0 on Node 22.23.3/npm 10.9.9 (OA11 §7.1) | Failure log §1/§2 of this doc; lockfile introspection this session |

### Commit 2 — Refund idempotency claim fix (OA12)

```text
fix(idempotency): fail() releases only in_progress claims
```

| File | Why | Evidence |
|---|---|---|
| `src/server/idempotency.ts` (M) | In-memory `fail()` guards `status !== 'completed'` — completed claims must replay, not re-execute | §8.4; `tests/idempotency.test.ts` updated expectation |
| `src/server/db/idempotency-adapter.ts` (M) | Same guard in Prisma adapter (check-then-delete) | §8.4 |
| `tests/idempotency.test.ts` (M) | Expects `replay` (not `started`) after `fail()` on completed claim | green in 334-test run |
| `tests/idempotency-fail-completed.test.ts` (new, 2 tests) | Dedicated regression: completed claim survives `fail()` | green |

### Commit 3 — Refund API + tenant-scoped finance persistence (OA13–OA16)

```text
feat(finance): refund API with tenant scoping and idempotency
```

| File | Why | Evidence |
|---|---|---|
| `src/domain/finance/ports.ts` (M) | `getRefund(id, organizationId)`; adds `transitionRefund` + `transitionRefundWithAudit` contracts | §11.2/§11.3 |
| `src/domain/finance/service.ts` (M) | `decideRefund`/`completeRefund` tenant-scoped reads; atomic port call; CONFLICT on null | §11.11; OA17 tests |
| `src/server/db/finance-adapter.ts` (new) | `PrismaFinance`: `$transaction` + `pinTenantContext` + conditional update + audit create | §11.3; code review §12.4.1 |
| `src/server/db/memory-store.ts` (M) | Demo-sandbox `MemoryFinance` implementing the port | §11.2 |
| `src/server/runtime.ts` (M) | Wires `finance` into `Runtime` (demo + Prisma paths) | diff inspected |
| `src/app/api/refunds/route.ts` (new) | POST refund request, optional `Idempotency-Key`, RBAC | §10.6; 36 route tests |
| `src/app/api/refunds/[id]/route.ts` (new) | PATCH approve/reject/complete, server-derived identity | §11.6 |
| `src/app/api/orders/route.ts` (M) | `sinceIso` ISO-8601 validation guard (OA13) | §9.7; `history-since-iso` |
| `tests/history-since-iso.test.ts` (new, 5 tests) | Route-level regression for the guard | green |
| `tests/refund-route.test.ts` (new, 36 tests) | Full refund API regression suite | green |
| `tests/finance-service.test.ts` (M, +7 OA17 tests) | Atomic-transition/audit mocked regression | §11.11 |
| `tests/helpers/memory.ts` (M) | Test-double port updates + OA17 helpers | diff inspected |

### Commit 4 — Audit trail documentation (OA10–OA18)

```text
docs: add CI stabilization and OA11-OA18 audit trail
```

| File | Why |
|---|---|
| `docs/AUTOPILOT-CI-STABILIZATION-20261015.md` (new) | Full OA10–OA19 evidence log incl. matrices and owner actions |
| `docs/PRODUCTION-READINESS.md` (M) | Baseline/P0/P2-6 reconciliation |
| `docs/STAGING-CHECKLIST.md` (M) | B1/B2/gap/gate-note + OA18 stale-tree correction |
| `docs/MANUAL-BLOCKERS.md` (M) | Publishable-key wording, CI note |

### Commit 5 (optional, recommended) — hygiene

```text
chore: exclude audit scratch from release
```

No files committed; instead the owner deletes `tests/_patch/` locally after
Commit 4 (it stays untracked; never staged). See exclusions below.

### Excluded from release (retained on disk, never staged)

| Path | Reason |
|---|---|
| `tests/_patch/callpost.txt` (55 B) | Inert scratch fragment; not collected by vitest (`tests/**/*.test.ts`) |
| `tests/_patch/patch.js` (0 B) | Empty scratch |
| `tests/_patch/test.js` (5 B) | Scratch literal "test"; not a vitest match |
| `tests/_patch/oa19-scan.ps1` (new this audit) | Secret-scan helper; replaced by permanent CI practices; owner may delete with the directory |

### Integrity confirmation

- 22 included + 4 excluded = 26 files = 15 modified + 11 untracked — full
  accounting, nothing unaccounted.
- No generated artifacts (`.next/`, `node_modules/` ignored; build artifacts
  never staged), no duplicate test files (31 unique names), no missing refund
  files (both routes + adapter + service + ports + tests present).
- Baseline history preserved: commits apply on top of `17d9906` via plain
  `git add <paths> && git commit` — no rebase, no history rewrite, upstream
  branch name unchanged so PR #1 continues from the same ref.

## 13.4 CI evidence review (local evidence only — no remote calls)

| Element | Evidence | Verdict |
|---|---|---|
| Failure cause | Run #1 (17 s, Oct 15 2026) failed at `npm ci` with EUSAGE: missing lockfile entries `@emnapi/core@1.11.3`, `@emnapi/runtime@1.11.3` (owner-provided log, §1) | Root cause documented |
| Mechanism | HEAD's `package-lock.json` kept `@emnapi/*` only nested under `@unrs/resolver-binding-wasm32-wasi/`; npm 10 lockfile validation rejects that layout; npm 11 accepts it (local `npm ci` exit 0 under npm 11.6.2 on the same lockfile — OA10) | Consistent |
| Fix justification | Working-tree lockfile now contains TOP-LEVEL `node_modules/@emnapi/core@1.11.3` + `@emnapi/runtime@1.11.3` (verified by introspection this session); regenerated under Node 22.23.3/npm 10.9.9 = the CI runtime class | Fix targets the actual failure, not a desired result |
| Node 22 pin | `@supabase/supabase-js@2.117.3` (locked) declares `engines: {node: ">=22.0.0"}` (verified); Node 20 could trip engine checks after the lockfile issue is fixed | Fix prevents the next failure |
| Scope | Diff = `node-version: 20→22` + step name + comment rationale ONLY; no step added/removed; `permissions: contents: read` unchanged; no secrets introduced (dummy `localhost:5432` URLs are pre-existing in HEAD) | Minimal, gate-preserving |
| Dry-run proof | `npm ci` exit 0 under Node 22.23.3/npm 10.9.9 (OA11 §7.1, recorded); full local gate suite re-run green this session on Node 24 (see §13.5) | Local parity with CI class |

**Unresolved concerns (honest):** (1) CI is still FAILING remotely — only a
push + observed run can prove the fix (no green claim made). (2) The Node 22
CI image differs from the dev machine's Node 24; both pass locally, but the
first green CI run is the only remote-class evidence. (3) `npm ci` itself was
not re-run this session (would replace `node_modules`; OA11 evidence stands
and the lockfile is unchanged since).

## 13.5 Validation results (this session)

| Gate | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npx tsc --noEmit` | 0 | clean |
| Lint | `npx next lint` | 0 | no warnings/errors |
| Tests | `npx vitest run` | 0 | 31 files, **334 passed / 1 skipped** |
| Schema | `npx prisma validate` | 0 | valid |
| Build | `npx next build` | 0 | Compiled successfully; 57/57 routes; fresh BUILD_ID |
| Diff hygiene | `git diff --check` | 0 | clean (pre-existing package-lock CRLF warning only) |
| Secret scan | pattern scan of all 26 changed files (AWS/GitHub/Slack/private-key/JWT/credentialed-URL) | — | 2 hits, both the documented `localhost:5432` dummy placeholders in `ci.yml` (pre-existing in HEAD); **no secrets** |

No dependency changed by this audit; no test or gate weakened; the only
filesystem changes were the appended §13 (this doc) and the scratch scan
script in `tests/_patch/`.

## 13.6 Exact owner action (commit → push → CI evidence)

Run from the repo root on the owner's machine, in order:

```powershell
# 1. Commit (or use the 5-commit split from §13.3; paths below = the full 22-file set)
git add .github/workflows/ci.yml package-lock.json
git add src/server/idempotency.ts src/server/db/idempotency-adapter.ts tests/idempotency.test.ts tests/idempotency-fail-completed.test.ts
git add src/domain/finance/ports.ts src/domain/finance/service.ts src/server/db/finance-adapter.ts src/server/db/memory-store.ts src/server/runtime.ts
git add src/app/api/refunds src/app/api/orders/route.ts
git add tests/history-since-iso.test.ts tests/refund-route.test.ts tests/finance-service.test.ts tests/helpers/memory.ts
git add docs/AUTOPILOT-CI-STABILIZATION-20261015.md docs/PRODUCTION-READINESS.md docs/STAGING-CHECKLIST.md docs/MANUAL-BLOCKERS.md
git commit -m "feat(finance): refund API, idempotency hardening, Node 22 CI fix"
# NOTE: git add src/app/api/refunds stages the directory; tests/_patch is NEVER added.

# 2. Verify nothing was missed
git status --short   # expect ONLY tests/_patch/ entries remaining as ??

# 3. Push (updates PR #1 automatically — same branch ref)
git push origin release/hansan-c1-c3-ci-validation

# 4. Obtain CI evidence (browser): PR #1 → Checks → newest run of
#    "CI — Pull Request Gate" → confirm all 8 steps green, esp.
#    npm ci exit 0 and "Test Files 31 passed".
```

Optional hygiene after push: delete `tests/_patch/` locally (owner-decided;
it is untracked, so deleting it has no Git effect).

**Do not merge PR #1** until the run observed green; PostgreSQL/staging gates
(A2–A8) remain open regardless — see OA18 §12.3/§12.6 and `MANUAL-BLOCKERS.md`.

## 13.7 PostgreSQL/staging gates still BLOCKED after OA19

Unchanged by this audit and requiring owner infrastructure: dedicated staging
project (G1), DB-identity verification, backup/restore drill (G2), migration
baseline apply, PG-1…PG-6 refund matrix execution, PgBouncer/pooler tests
(T1–T7 / PB-01…13), RLS runtime proof + G9 authorization, multi-instance
idempotency demonstration, monitoring acceptance, sign-off (G8/G9). Full
matrix: OA18 §12.3–§12.7.

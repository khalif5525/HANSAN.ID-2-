# PHASE 12 — SCOPED CALLERS MIGRATION REPORT

**Date:** 2026-10-12
**Branch:** `main`
**HEAD:** `1bf82a404fb6a02a12db3d2eb73349403538b934` (= `origin/main`, unchanged)
**Git operations performed this phase:** none (no stage, commit, push, merge, stash, checkout, reset, clean, deploy).

---

## 1. Scope and baseline Git state

Phase 12 resumes the partially-completed work found in the working tree: the
required-scope contracts had already been introduced in
`src/domain/shared/ports.ts` (`OrderPort.findById`, `PaymentPort.listByOrder`,
`CatalogPort.findById` all REQUIRE `scope`), and the Prisma adapters
(`orders-adapter.ts`, `catalog-adapter.ts`, `payment-adapter.ts`), the demo
`memory-store.ts`, and the adapter-level tests (`tenant-isolation.test.ts`,
`tenant-scope-stores.test.ts`) had been updated. No validation had been run
after those edits, and this report did not exist.

**Baseline inspection (before any edit):**

- `git status --short`: 100+ modified/untracked paths preserved as-is (prior
  phase work, docs, prisma artifacts, API routes, tests). Nothing staged
  (`git diff --cached` empty).
- Phase 11 report read: `docs/PHASE-11-RLS-ACTIVATION-READINESS.md` §4 listed
  blocker 1 — "unscoped legacy reads" in `pos/lifecycle.requireOrder`,
  `pos/service.getOrderById`, `finance/service.requestRefund`, plus unscoped
  branches of `catalog.findById` / `payments.listByOrder`.

**RULE 2 — baseline `npm run typecheck` (before additional edits): FAIL, exit 1, 8 errors in 6 files:**

| # | File:line | Error |
|---|---|---|
| 1 | `src/domain/finance/service.ts:77` | `orders.findById(params.orderId)` missing required `scope` |
| 2 | `src/domain/pos/lifecycle.ts:36` | `orders.findById(orderId)` missing required `scope` |
| 3 | `src/domain/pos/service.ts:46` | `catalog.findById(line.productId)` missing required `scope` |
| 4 | `src/domain/pos/service.ts:139` | `orders.findById(orderId)` missing required `scope` |
| 5 | `tests/payment-lifecycle.test.ts:72` | `payments.listByOrder(...)` missing required `scope` |
| 6 | `tests/payment-lifecycle.test.ts:138` | `payments.listByOrder(...)` missing required `scope` |
| 7 | `tests/phase-a-persistence.test.ts:351` | `orders.findById("ord_demo")` missing required `scope` |
| 8 | `tests/pos-order.test.ts:328` | `sandboxOrders().findById(orderId)` missing required `scope` |

All 8 errors were caused by the Phase 12 required-scope contract change; zero
pre-existing/unrelated type errors were present. No types were weakened and no
optional-scope fallback was restored.

---

## 2. Caller/port migration completed

A repository-wide search (`findById(`, `listByOrder(`) classified every caller
as production, demo, or test. Migration results:

### Production / domain callers (fixed)

| Caller | Migration |
|---|---|
| `src/domain/pos/lifecycle.ts` — `requireOrder()` | Now `requireOrder(orders, orderId, scope: TenantScope)`; scope is a REQUIRED parameter threaded into `orders.findById(orderId, scope)`. Doc comment: scope must come from the revalidated actor/session, never request-body ids. |
| `src/domain/pos/lifecycle.ts` — `transitionOrder`, `capturePayment`, `cancelOrder`, `requestRefund` | Each now takes `scope: TenantScope` immediately after `orderId` and passes it to `requireOrder`. Cross-tenant/wrong-outlet reads throw `NOT_FOUND` **before** any state flip, Payment row, or audit event (fail closed, no side effects). |
| `src/domain/pos/service.ts` — `priceRequest()` | `catalog.findById(line.productId, { organizationId: tenantId })`; `tenantId` is supplied by `createOrder()` from the route's verified actor (`authCtx.actor.tenantId`), never the request body. |
| `src/domain/pos/service.ts` — `transition/pay/cancel/requestRefund/getOrderById` | All now take `scope: TenantScope` as a required parameter. `getOrderById(orderId, scope)` delegates to the scoped port. |
| `src/domain/kds/service.ts` — `performAction`, `setItemStatus` | Now take `scope: TenantScope` and pass it to `requireOrder`/`transitionOrder`. (No production route currently instantiates `KdsService`; the contract is fail-closed for any future caller.) |
| `src/domain/finance/service.ts` — `requestRefund()` | `orders.findById(params.orderId, { organizationId: params.tenantId })`. Scope is org-only (NOT outlet) deliberately: same-tenant/wrong-outlet requests keep returning `OUTLET_MISMATCH` via the existing app-level guard, while cross-tenant requests resolve to `null` → `NOT_FOUND` (non-leaking). Doc comment mandates `params.tenantId` be the verified actor's tenant. |

### Production route callers (verified already compliant)

| Caller | Status |
|---|---|
| `GET /api/orders/[id]` (`src/app/api/orders/[id]/route.ts:45`) | Already scoped: `runtime.orders.findById(id, { organizationId: authCtx.actor.tenantId })` with revalidated live actor; cross-tenant → 404 (covered by `tests/pos-order.test.ts`). No change needed. |
| `POST/GET /api/orders` | Production writes go through `createProductionOrder` (actor-scoped, GUC-pinned — unchanged); reads go through `PosService.history` → `listByOutlet` (Phase 11 resolves org from the authoritative `Outlet` row). `priceRequest` fixed as above. |
| Any other production caller of `orders.findById` / `payments.listByOrder` / `catalog.findById` | **None found.** Post-change re-search: the only `findById()` occurrence without a scope argument anywhere in the repo is prose in `docs/PHASE-11-RLS-ACTIVATION-READINESS.md` (documentation of the old blocker). |

### Test doubles (fixed — removed unscoped fallback)

| Caller | Migration |
|---|---|
| `tests/helpers/memory.ts` — `MemoryOrders.findById` | Was a 1-arity unscoped lookup (TS-assignable to the port, i.e., a hidden unscoped fallback). Now requires `scope` and enforces org + optional outlet, mirroring `memory-store.ts`. |
| `tests/helpers/memory.ts` — `MemoryCatalog.findById` | Was `scope?` with `if (scope && …)` — allowed unscoped reads. Scope is now required and unconditionally enforced. |
| `tests/payment-lifecycle.test.ts` | Added `SCOPE = { organizationId: "ten_test" }`; threaded into 12 call sites (7 `capturePayment`, 2 `listByOrder`, 1 `orders.findById`, 2 `pos.pay`). |
| `tests/phase-a-persistence.test.ts:351` | Demo read now `findById("ord_demo", { organizationId: "ten_demo" })`. |
| `tests/pos-order.test.ts` | `pos.pay(...)` ×2 and `sandboxOrders().findById(...)` now pass `{ organizationId: session.tenantId }` (the verified demo session tenant). |

**Demo/in-memory compatibility:** the demo sandbox (`src/server/db/memory-store.ts`)
enforces the same required-scope contract as production, so demo traffic
exercises the scoped path end-to-end without any production weakening.

**Post-change re-search confirmation (RULE 3.9):** every production and test
caller of `orders.findById`, `payments.listByOrder`, and `catalog.findById`
passes an explicit `{ organizationId, outletId? }` scope; strict TypeScript
makes any unscoped call a compile error — no runtime unscoped fallback exists.

---

## 3. Files changed this phase (and why)

**Production/domain (bounded Phase 12 fixes only):**

| File | Why |
|---|---|
| `src/domain/pos/lifecycle.ts` | `requireOrder` + all four lifecycle operations now require/propagate `TenantScope` (this was the root of baseline errors 1–2 and every KDS/lifecycle caller). |
| `src/domain/pos/service.ts` | Scoped catalog pricing in `priceRequest`; required `scope` on `transition/pay/cancel/requestRefund/getOrderById` (baseline errors 3–4). |
| `src/domain/kds/service.ts` | `performAction`/`setItemStatus` propagate scope through `requireOrder`/`transitionOrder` (consequence of the lifecycle contract change). |
| `src/domain/finance/service.ts` | `requestRefund` performs a scoped, non-leaking order read (baseline error 1). |

**Tests:**

| File | Why |
|---|---|
| `tests/helpers/memory.ts` | Removed the hidden unscoped fallback in `MemoryOrders.findById`/`MemoryCatalog.findById`; test doubles now enforce the same contract as production adapters. |
| `tests/payment-lifecycle.test.ts` | Scope threaded through `capturePayment`, `pos.pay`, `payments.listByOrder`, `orders.findById` (baseline errors 5–6). No assertion deleted or weakened. |
| `tests/phase-a-persistence.test.ts` | Demo sandbox read passes the demo tenant scope (baseline error 7). |
| `tests/pos-order.test.ts` | Demo `pos.pay`/`findById` calls pass the verified session tenant scope (baseline error 8). |
| `tests/phase12-scoped-callers.test.ts` | **NEW** — focused Phase 12 security matrix (13 tests, section 4). |

No other files were touched. No Supabase/Vercel/external configuration, no
secrets, no remote database objects, and no unrelated working-tree changes were
modified. No `.env` value was read or printed (`prisma validate` only reports
"Environment variables loaded from .env").

---

## 4. Security test matrix and results

Focused run: `npx vitest run tests/phase12-scoped-callers.test.ts
tests/tenant-scope-stores.test.ts tests/tenant-isolation.test.ts
tests/payment-lifecycle.test.ts tests/finance-service.test.ts
tests/refund-rules.test.ts` → **6 files, 48 tests, all PASS (exit 0)**.

| # | Requirement (RULE 4) | Test(s) exercising it | Result |
|---|---|---|---|
| 1 | Valid same-tenant reads | `phase12-scoped-callers.test.ts` → "resolves a same-tenant order…", "priceRequest prices a same-tenant product…", "getOrderById returns the record same-tenant…", "allows same-tenant scoped operations"; `tenant-scope-stores.test.ts`; `tenant-isolation.test.ts` (Prisma adapters) | **PASS** |
| 2 | Cross-tenant reads → established non-leaking result | `phase12-scoped-callers` → "rejects a cross-tenant order as NOT_FOUND (no existence leak)", "getOrderById … null cross-tenant", "payments.listByOrder … [] for foreign scope"; `tenant-isolation.test.ts`; route-level 404 in `pos-order.test.ts` → "reads one order by id and denies cross-tenant reads" | **PASS** |
| 3 | Owner/Finance tenant-wide access only where RBAC allows | `phase12-scoped-callers` → "tenant-wide reads (Owner/Finance) return ONLY the caller's tenant rows across outlets" (both tenant-A outlets visible, tenant-B rows invisible); RBAC permission gates in `authz.test.ts` + `pos-order.test.ts` (role denied → 403) | **PASS** |
| 4 | Cross-tenant refund denied without leakage | `phase12-scoped-callers` → "denies a cross-tenant refund without persisting a Refund row"; `payment-lifecycle.test.ts` → "rejects a cross-tenant refund as NOT_FOUND (no existence leak)" (pre-existing, kept) | **PASS** |
| 5 | Missing/ambiguous org/outlet scope fails closed | `phase12-scoped-callers` → "rejects an empty/ambiguous organizationId (missing scope fails closed)", "rejects a same-tenant order under the wrong outlet scope", `getOrderById` with `organizationId: ""` → null | **PASS** |
| 6 | Every affected production caller uses a scoped contract | Repo-wide re-search (section 2) + `npm run typecheck` (strict TS makes unscoped calls compile errors) + `pos-order.test.ts` route tests | **PASS** (type-level + route tests) |
| 7 | No fallback to unscoped queries | `tests/helpers/memory.ts` fallback removed; `phase12-scoped-callers` asserts `findById(..., { organizationId: "" })` → null and `listByOrder(..., { organizationId: "" })` → `[]`; `tenant-scope-stores.test.ts`/`tenant-isolation.test.ts` for both adapter families | **PASS** |
| 8 | Demo/in-memory workflows keep working | `phase12-scoped-callers` → "keeps the demo/in-memory createOrder workflow working…"; full `pos-order.test.ts` demo API suite (11 tests) | **PASS** |
| 9 | Existing authorization + segregation of duties intact | `finance-service.test.ts` (requester cannot approve own refund → `REFUND_APPROVAL_REQUIRED`; manager/finance gate), `refund-rules.test.ts`, `authz.test.ts`, `audit-rate-limit.test.ts` — all still green in the full run; nothing skipped or deleted | **PASS** |
| 10 | Lifecycle/KDS mutations denied cross-tenant, no side effects | `phase12-scoped-callers` → "denies transition/pay/cancel/refund cross-tenant with NO side effects" (row unchanged, 0 Payment rows, 0 audit events), "KdsService … fails closed cross-tenant" | **PASS** |

**Skipped test disclosure:** the suite reports `1 skipped` — `tests/pos-order.test.ts`
→ "fails closed (503) for a live session when persistence is not configured",
guarded by the pre-existing `it.runIf(!DB_CONFIGURED)`. It is skipped because a
`DATABASE_URL`/`POSTGRES_URL`/`PRISMA_DATABASE_URL` value exists in the local
environment, so the "no DB configured" branch cannot be exercised here. This
skip is unchanged from the Phase 8–11 baselines (`271 passed | 1 skipped`); it
was not introduced, and no test was converted into a skip this phase.


---

## 5. Final validation command results (RULE 6)

Script names verified in `package.json` before running. Each result below is
from the run against the FINAL code state (all edits complete).

| # | Command | Result | Exit | Evidence |
|---|---|---|---|---|
| 1 | `npm run typecheck` | **PASS** | 0 | `tsc --noEmit`, zero errors (baseline was 8 errors) |
| 2 | `npm run lint` | **PASS** | 0 | `next lint` → "No ESLint warnings or errors" |
| 3 | `npm test` | **PASS** | 0 | `vitest run` → **28 files, 284 passed, 1 skipped** (skipped test disclosed in §4; files = Phase 11's 27 + new `phase12-scoped-callers.test.ts`) |
| 4 | `npm run db:validate` | **PASS** | 0 | Script exists (`prisma validate`); output: "The schema at prisma\schema.prisma is valid" |
| 5 | `npm run build` | **PASS** | 0 | `next build` production build compiled; middleware 27.8 kB |
| — | Focused security tests (`npx vitest run` on the 6 files in §4) | **PASS** | 0 | 6 files, **48/48 tests passed** |

No command failed in the final state; no result is carried over from an earlier
run. No test was skipped, deleted, or weakened as part of this phase (the one
disclosed skip is pre-existing and environment-conditional).

---

## 6. PostgreSQL / RLS / PgBouncer evidence — tested vs untested

**Tested this phase: NOTHING at the database level.** Phase 12 is a
compile-time + in-memory/domain-test phase only. Explicitly:

| Item | Status | Evidence |
|---|---|---|
| Remote Supabase/Postgres schema or data changes | **NOT RUN — not performed** | No migrations applied, no `psql`/`prisma migrate` against any remote DB, no RLS enabled anywhere, no secrets/env config touched (RULE 5 honored). |
| RLS activation anywhere | **NOT RUN — not performed** | No `ENABLE ROW LEVEL SECURITY` issued this phase. |
| Disposable local PostgreSQL harness | **NOT RUN** | No disposable cluster exists in the tree; the Phase 9/10 clusters were torn down (`pg_ctl stop`, data dirs removed) and were not recreated. A fresh harness was not set up this phase. |
| PgBouncer transaction-pooling test (Prisma interactive tx + `SET LOCAL`) | **UNVERIFIED** | Never performed in any phase; Phase 11 blocker 2 remains open. **No passing claim is made.** |
| Parent-join `EXPLAIN (ANALYZE)` at volume | **UNVERIFIED this phase** | Phase 10 historical evidence only; not re-run. **No passing claim is made.** |
| `CREATE INDEX CONCURRENTLY` rollout | **NOT RUN** | Proposed follow-up migration, not part of this phase. **No passing claim is made.** |
| Prisma schema validity (local, static) | **PASS** | `npm run db:validate` (§5) — schema-file validation only; it does not touch any database. |

Adapter-level RLS *compatibility* (GUC pinning inside the same transaction as
the scoped query) is covered only by mocked/unit tests
(`tenant-isolation.test.ts`) — that is code-shape evidence, NOT a live-RLS
proof. Real-RLS proof requires the disposable-PG re-run (§7, blocker B2).

---

## 7. Remaining blockers and required follow-up

**Phase 12 blockers: none.** No unscoped production caller remains, and no
Phase 12 security test is failing or skipped.

Carried-forward follow-ups (outside Phase 12 scope; from Phase 11 §4, updated):

1. ~~Unscoped legacy reads~~ — **RESOLVED this phase** (this report §2).
2. **B2 — Disposable-PG integration re-run (PgBouncer transaction pooling).**
   Prove Prisma interactive tx + `SET LOCAL` pinning under transaction pooling
   on a fresh disposable PostgreSQL using the Phase 9 procedure. Required
   before any RLS activation. *Status: NOT RUN.*
3. **B3 — Parent-join `EXPLAIN (ANALYZE)` sanity pass** for the RLS
   predicates on `OrderItem`/`Payment`/`RecipeItem` on a disposable PG.
   *Status: NOT RUN this phase.*
4. **B4 — `CREATE INDEX CONCURRENTLY` rollout** as a scheduled follow-up
   migration (no table rewrite / long lock). *Status: NOT RUN.*
5. **Production payment-capture route** still does not exist (BLOCKER-005,
   gateway); until it does, no production path marks an order `paid`, so the
   Payment-row/order-state invariant holds trivially (unchanged from Phase 5/10).

---

## 8. Final readiness decision

# ✅ READY FOR STAGING PREPARATION

**Justification (per RULE 7 criteria):** all relevant local Phase 12 checks
pass (`typecheck`, `lint`, `test`, `db:validate`, `build`, focused security
tests — all exit 0 against the final code); a post-change repository-wide
search confirms **no known unscoped production caller** of `orders.findById`,
`payments.listByOrder`, or `catalog.findById` remains; no Phase 12
security-test blocker remains; the non-leaking `NOT_FOUND`/404/`null`/`[]`
contract, RBAC gates, outlet restrictions, refund authorization, and
segregation of duties are all intact and exercised.

**Explicit limits of this decision:**

- This is **local readiness only** — it is NOT production readiness and does
  not authorize production release.
- This report does **NOT** activate RLS. RLS remains OFF everywhere; blockers
  B2–B4 (§7) must be cleared on a disposable PostgreSQL before any
  `ENABLE ROW LEVEL SECURITY`.
- PgBouncer transaction pooling, parent-join performance, and concurrent index
  deployment are **UNVERIFIED** (§6) and must not be cited as passing.
- No Git operations (stage/commit/push), no remote database changes, no
  external configuration changes were made.

**Next concrete blocker:** B2 — disposable-PG re-run proving pinned reads and
writes end-to-end under real RLS + transaction pooling. Stop here and await
instructions; Phase 13 is NOT started by this report.



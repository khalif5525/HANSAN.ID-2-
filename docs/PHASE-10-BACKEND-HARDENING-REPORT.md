# HANSAN — PHASE 10: BACKEND HARDENING REPORT

Status: LOCAL CODE + DISPOSABLE-PG REVIEW COMPLETE. No remote database, external
configuration, secret values, Git staging, commit, push, merge, or deploy touched.

Decision at end: **READY FOR STAGING PREPARATION** (not "READY FOR STAGING
VERIFICATION" — see §7/§8; PgBouncer transaction pooling + RLS activation can only
be proven against the real Supabase pooler in staging). NOT production-ready.

---

## 1. Git status (initial = final; no tracked files edited this phase)

- Branch: `main`
- HEAD: `1bf82a404fb6a02a12db3d2eb73349403538b934` — `1bf82a4 (HEAD -> main, origin/main, origin/HEAD) fix: resolve Next.js page export build error`
- Upstream: `origin/main`, **0 ahead / 0 behind** (`git rev-list --left-right --count HEAD...origin/main` → `0 0`)
- Modified tracked: **48** (unchanged baseline; preserved)
- Untracked: **77** (unchanged baseline incl. Phase 8/9 SQL artifacts + reports)
- Staged: **none** (`git diff --cached --name-only` empty)
- Only new file added this phase: `docs/PHASE-10-BACKEND-HARDENING-REPORT.md` (this file)

Disposable PostgreSQL cluster used for index/EXPLAIN review was created under
`%TEMP%`, run on `127.0.0.1:55433`, and **stopped + deleted** at the end. All
Phase-10 scratch files (`tmp_p10*.*`, `tmp_prisma_probe.cjs`) were removed. No
reset/clean/overwrite/discard of any user work.

---

## 2. Adapter / caller coverage matrix (production DB access paths)

Auth model: `runtimeFor(actor)` selects the Prisma path **only** for a
re-validated live session (`src/server/runtime.ts`); DEMO sessions use the
in-memory sandbox. Tenant scope is derived **only** from the server-verified
actor + DB membership — never from client-supplied tenant ids.

| # | Caller / endpoint | Session revalidation | Scope derivation | Scope in signature? | Tx context + RLS? | Child ownership checked? | Test coverage |
|---|---|---|---|---|---|---|---|
| 1 | `POST /api/orders` → `createProductionOrder` → `orders.createTransactional` | Yes (`requireAuth` + revalidate) | org/outlet from verified actor/draft | org+outlet required on draft | **GUC pinned FIRST in same `$transaction`**; catalog `organizationId` re-checked; audit+idempotency atomic | Yes (item→order, product→org) | `pos-order.test.ts`, `phase-a-persistence.test.ts`, `tenant-isolation.test.ts` |
| 2 | `GET /api/orders/[id]` → `orders.findById({id, organizationId})` + `authorizeRecord` | Yes | org from actor, passed to `where` | org passed at call site | App-level `WHERE` (RLS not yet enabled in applied migration) → fails closed cross-tenant (**404**) | n/a (single row) | `pos-order.test.ts` (cross-tenant → 404) |
| 3 | `orders.listByOutlet` | Yes | org+outlet from actor | org+outlet required | App-level `WHERE` | n/a | `phase-a-persistence.test.ts` |
| 4 | `orders.listByTenant` | Yes | org from actor (owner/finance) | org required | App-level `WHERE` | n/a | `phase-a-persistence.test.ts` |
| 5 | `orders.nextOrderNumber` | Yes | outlet from actor | outlet required | App-level `WHERE` (per-outlet counter) | n/a | `phase-a-persistence.test.ts` |
| 6 | `orders.save` (legacy) | Yes | org re-checked on existing row before write | org verified pre-write | **App-level check only — does NOT pin GUCs.** Reachable ONLY via DEMO in-memory sandbox + tests; no production route calls it | Yes (existing-row org match) | `pos-order*.test.ts` |
| 7 | `payments.*` (record/list) | Yes | org+outlet from actor / order | scoped args on live path | App-level `WHERE` on live path | order→org verified | `phase-a-persistence.test.ts` |
| 8 | `catalog.findById` | Yes | org from actor (optional scope) | scope optional → hardened in Phase 8 (live path supplies org; store enforces) | App-level `WHERE` | category→org | `tenant-scope-stores.test.ts` |
| 9 | `idempotency.*` | Yes | org+scope+key | org required | App-level `WHERE` (unique `[organizationId, scope, key]`) | n/a | `idempotency.test.ts` |
| 10 | Bootstrap: `admin/provision-owner`, `staff/invite` | Platform secret / owner-only gate | n/a (identity) | n/a | Identity tables **intentionally NO RLS** (bootstrap precedes tenant context); privileged by explicit app gate | membership→org on grant | `phase-a-persistence.test.ts` |

Forward-compatibility note (NOT a live bypass): rows 3–6, 8 run on the pooled
`this.db` client **without** `pinTenantContext`. They are safe today because the
applied migration has **no RLS enabled** (verified: 0 `ROW LEVEL SECURITY` /
`CREATE POLICY` statements in `20261009000000_init`) and each uses app-level
`organizationId`/`outletId` `WHERE`. Once RLS is enabled in staging (per §8),
these reads would fail closed until wrapped in `withTenantTransaction`. Only the
write path (row 1) is already RLS-ready. See §7 risk P2.

---

## 3. Confirmed defects and minimal fixes

**No new production cross-tenant bypass was found.** Two items were investigated
and resolved:

- **`orders.findById` uses `findUnique` with non-unique `where` fields — RESOLVED
  AS NON-DEFECT.** Verified against the real Prisma client (5.22) on the disposable
  DB via a dedicated probe:
  - `findUnique({ id, organizationId })` correct org → **returns the row**.
  - `findUnique({ id })` with **wrong** org → **returns `null`** (fails closed).
  - Conclusion: Prisma 5.22 DOES apply the extra non-unique filters in
    `findUnique`; scoping works and fails closed cross-tenant. No code change.

- **`catalog.findById` optional scope — already hardened in Phase 8.** Scope is
  optional at the type level for compatibility, but the live path supplies org and
  the memory store enforces it. No further change this phase to avoid destabilizing
  verified behavior.

No RLS policies were weakened. No tests were weakened. No tracked source file was
modified (nothing required a fix).

---

## 4. Supporting index review + query-plan findings

Source of truth: `prisma/schema.prisma` declared indexes (mapped to models) +
`20261009000000_init` FK definitions, cross-checked with `EXPLAIN` on the
disposable PG 16.15 seeded with synthetic rows.

| RLS predicate / join | Index used | Verdict |
|---|---|---|
| `Order` org (`organizationId`) + outlet | `@@index([organizationId, outletId, createdAt])`, `@@index([organizationId, state])` | Adequate — composite org-leading |
| `OrderItem` → `Order` (parent `EXISTS`) | `OrderItem @@index([orderId])` + `Order` PK | Adequate — join key indexed |
| `SequenceCounter` → `Outlet` (parent `EXISTS`) | `SequenceCounter @@id([outletId, kind])` + `Outlet` PK | Adequate — leading column indexed |
| `RecipeItem` → `Recipe` → `MenuItem` (2-level) | `RecipeItem @@unique([recipeId, ingredientId])` + `Recipe` PK + `MenuItem` PK | Adequate — `recipeId` leading |
| `Payment`/`Refund` org+outlet+time | `@@index([organizationId, outletId, capturedAt])`, `@@index([organizationId, status])` | Adequate |
| `InventoryMovement` org / ingredient | `@@index([ingredientId, occurredAt])`, `@@index([organizationId, occurredAt])` | Adequate |
| `AuditEvent` org+time / entity | `@@index([organizationId, occurredAt])`, `@@index([entityType, entityId])` | Adequate |
| `IdempotencyRecord` unique | `@@unique([organizationId, scope, key])` | Adequate |
| `Approval` org+entity | `@@index([organizationId, entityType, entityId])` | Adequate |
| `MenuCategory`/`MenuItem`/`Ingredient` org | `@@index([organizationId, ...])` each | Adequate |
| `Membership` org+role | `@@unique([userId, organizationId, role, outletId])`, `@@index([organizationId, role])` | Adequate |

**No missing index for any RLS predicate.** No duplicate/redundant index detected
(each declared index has a distinct predicate/leading column).

### Measured-plan caveat (honest scoping)
- EXPLAIN was inspected on a **small synthetic fixture** (dozens of rows, 2 orgs,
  2 outlets). This **confirms index selection** (index/nested-loop usage, no seq
  scan on the org predicate) but **does NOT establish load-scale performance**.
- **Load-scale performance is UNVERIFIED.** Concrete benchmark plan is in §8 (BENCH).

### New-index migration proposal (NOT applied, NOT staged)
Because **no RLS predicate lacks an index**, **no new indexes are required for
RLS correctness**. Therefore **no index migration is proposed** and none is
created. If future profiling under load shows a parent-join hot path needing a
covering index, it should be added as a **separate reviewed migration** using
`CREATE INDEX CONCURRENTLY` (appropriate for Supabase zero-downtime: it avoids
an `ACCESS EXCLUSIVE` lock on a live table; it cannot run inside a transaction
block, so it must be its own migration file, not bundled with DDL/policies).

---

## 5. Business-flow regression results

Verified by reading the production wiring + the green test suite (§6). No product
features or UI changes introduced.

| Flow | Result |
|---|---|
| POS order creation, idempotency, audit writes | ✅ `createTransactional` pins GUC first, re-checks catalog org, appends audit+idempotency in one tx; `idempotency.test.ts` green |
| Scoped order retrieval + cross-tenant 404 | ✅ `GET /api/orders/[id]` passes `{organizationId}` + `authorizeRecord`; wrong-tenant → `404`; `pos-order.test.ts` green |
| Payment recording + state transitions | ✅ scoped on live path; order→org verified; `phase-a-persistence.test.ts` green |
| Kitchen/Bar assignment + readiness aggregation | ✅ station derives from `OrderItem.station` + `prepStatus`; `kds-tickets.test.ts` green |
| Inventory mutations + concurrency | ✅ append-only movements, org-scoped; covered by persistence tests |
| Refund authorization, approval, separation of duties | ✅ refund path app-checks tenant + `decidedBy !== requestedBy`; `refund-rules.test.ts` green |
| Finance / settlement access | ✅ org+status indexed queries; persistence tests green |
| Live session revalidation + role/outlet change | ✅ `revalidate` reads DB membership each request; `runtimeFor` gates Prisma to live sessions |


## 6. Validation results and unexecuted tests

All five project checks were re-run on the final tree (after cleanup, no code changes this phase):

| Check | Command | Result | Exit |
|---|---|---|---|
| Typecheck | `npm run typecheck` | Clean, no errors | 0 |
| Lint | `npm run lint` | Clean, no warnings/errors | 0 |
| Unit + mocked/static | `npm test` | 27 files, **271 passed \| 1 skipped** (272) | 0 |
| Prisma schema validation | `npm run db:validate` | `schema valid` | 0 |
| Production build | `npm run build` | Next.js 14.2.35, compiled successfully | 0 |

### Database-level evidence (actual PostgreSQL vs mocks)

- **Phase 9 (recorded, still valid):** disposable PostgreSQL 16.15 integration — **38/38 RLS assertions passed** against the reviewed `prisma/rls-tenant-isolation.sql` applied to a real schema, run as the non-privileged `hansan_app` role (`NOSUPERUSER NOBYPASSRLS`). This is the only database-level security verification; it was **not** re-run this phase (the SQL artifact was unchanged).
- **This phase (Phase 10):** a **separate disposable PostgreSQL 16.15 cluster** (`initdb`, port 55433, localhost, throwaway) was used to load synthetic seed data (Orgs A/B, sibling Outlets A1/A2, menu/catalog/order/payment rows) sufficient for `EXPLAIN`, run `EXPLAIN (ANALYZE, BUFFERS)` on org/outlet/parent-join/payment queries to ground §4, and empirically probe Prisma 5.22 `findUnique({ id, organizationId })`.
- **Cluster lifecycle:** `pg_ctl stop` → port 55433 confirmed closed → data dir removed → scratch SQL/`.cjs` deleted. Tree returned to the exact pre-scratch baseline (**modified=48, untracked=77** before this report).

### Decisive non-defect: `findById` / `findUnique` with non-unique `where`

Concern: `findById` calls `prisma.order.findUnique({ where: { id, organizationId, outletId } })` where only `id` is unique. Empirically verified on disposable PG + Prisma 5.22:

- CASE1 `findUnique({ id: <a-order>, organizationId: org_a })` → returns the row (no throw).
- CASE3 `findUnique({ id: <a-order>, organizationId: org_b })` → returns `null`.

Conclusion: Prisma applies the full non-unique `where` and **fails closed on cross-tenant** (`null` → the `[id]` route returns 404). **Not a defect; no change made.**

### What was NOT verified (honest gaps)

- **Load/latency performance:** `EXPLAIN ANALYZE` at fixture scale only — **not** a load test. Missing-index need is grounded in plan shape (seq-scan vs index scan) but throughput must be benchmarked on staging.
- **PgBouncer transaction pooling:** remains **BLOCKED locally** (no Supabase pooler). Staging-only (see §8 T1).
- **RLS live enforcement on Prisma hot paths:** RLS is **not active** in any applied migration; Phase 9 proves the SQL artifact in isolation. End-to-end RLS-on-a-live-request is a staging gate.

## 7. Remaining blockers, ranked by release impact

**P0 — before any production traffic**
- None newly discovered. The Phase 9 Recipe/RecipeItem defect (D1) is fixed and re-verified (38/38).

**P1 — before enabling RLS as an enforcement layer in production**
1. **RLS is not applied anywhere.** `prisma/rls-tenant-isolation.sql` is reviewed + integration-proven but **unapplied**; the committed init migration contains zero `CREATE POLICY`. Until applied (after indexes), the DB layer is app-enforced only.
2. **Supporting indexes (§4) must precede RLS activation**, or parent-join policies and org/outlet predicates seq-scan at scale. Net-new needs are listed in §4 (notably a `MenuItem(organizationId)` supporting index for the Recipe/RecipeItem policy join).
3. **PgBouncer transaction-pooling pin correctness** is unverified locally and is the largest unknown for `set_config(...,true)` reliability under serverless. Staging-only (§8 T1).

**P2 — harden before scale, not blocking staging**
1. **Unpinned read/legacy paths** (`findById`, `listByOutlet`, `listByTenant`, `nextOrderNumber`, `save`) do not call `pinTenantContext`. Safe today (app-level `where` scoping + RLS inactive). Once RLS activates they **fail closed** (desired direction) but will break reads until migrated to the pinned transaction — forward-compatibility work, not a live bypass.
2. **Legacy `save()`/state-transition paths** (`PosService.transition/pay`, `KdsService.advance`, `FinanceService`) are reachable only via the DEMO in-memory sandbox and tests — no production route calls them. If ever promoted to a Prisma path they must be re-scoped + pinned.
3. **Supporting indexes for refund/audit/settlement reads** if plans at production scale show seq-scans.


## 8. Staging prerequisites and exact owner actions

Documented, **not executed**. No credentials requested/printed. No external configuration changed. No remote DB contacted.

### Required environment variables (fail-closed)
- `DATABASE_URL` (Supabase pooler, port 6543) and `DIRECT_URL` (session, 5432) — set in staging, never logged.
- `SESSION_SECRET` / dev-fallback rules already fail closed to 503 in production when missing.
- `app.organization_id / app.outlet_id / app.role / app.data_scope` are set **only** by `withTenantTransaction`/`pinTenantContext` inside a transaction — never accepted from client input.

### Ordered staging procedure
1. **Provision staging** Supabase project (separate from production); confirm `DATABASE_URL`/`DIRECT_URL`.
2. **Apply migrations in order:** existing additive migrations first; then **supporting indexes** (§4) via `CREATE INDEX CONCURRENTLY` (non-blocking; cannot run inside `prisma migrate`'s transaction — apply through a reviewed script, not a Prisma migration).
3. **Apply RLS last**, after indexes: run `prisma/rls-tenant-isolation.sql` as DB owner (idempotent — `DROP POLICY IF EXISTS` then `CREATE POLICY`). Verify catalog (`relrowsecurity=on, relforcerowsecurity=on`) matches the Phase 9 matrix.
4. **Run adversarial tests on staging:**
   - **T1 (PgBouncer) — the key unknown:** under the real Supabase transaction pooler, on one pooled connection: pin Org A in a transaction, COMMIT, then on a *reused* connection attempt a protected read with **no** re-pin → must see **0 rows** (fail closed). Repeat after ROLLBACK. Confirms `set_config(...,true)` does not leak across pooled transactions.
   - **T2 (cross-tenant):** Org A cannot read/mutate Org B order/payment/refund; Outlet A1 cannot read sibling A2; cross-org child inserts rejected; `__none__` tenant-wide Owner/Finance stays inside its own org.
   - **T3 (pool reuse):** interleaved Org A / Org B requests never observe each other's rows.
5. **Rollback:** `DROP POLICY` in reverse, then `DISABLE ROW LEVEL SECURITY` per table; drop net-new indexes if needed. Rollback removes the DB-layer guarantee (app checks remain) — safe but reduces defense-in-depth. Verify backup + PITR before step 3.
6. **Monitoring:** alert on `insufficient_privilege` spikes (indicates an unpinned path hit RLS — P2.1) and on audit-write failures.

### Owner decision required
- Approve applying the reviewed `prisma/rls-tenant-isolation.sql` + supporting indexes to staging, or keep RLS unapplied (app-enforced only) for now.
- Choose whether to migrate unpinned read/legacy paths to `withTenantTransaction` **before** RLS activation (recommended, to avoid fail-closed read errors surfacing to users) or after.

## 9. Explicit confirmation

**No remote database (Supabase/staging/production) was accessed or changed. No external configuration was modified. No secret values were read or printed. No migrations or RLS were applied to any live database. No users were provisioned. No financial operations were initiated. Nothing was staged, committed, pushed, merged, or deployed. No existing user work was reset, cleaned, discarded, or overwritten.** The only database used was a disposable local PostgreSQL 16.15 cluster that was stopped and its data directory deleted. Scratch verification files were removed; the working tree is at the pre-scratch baseline plus this report.

### Final decision

**READY FOR STAGING PREPARATION.**

Rationale: no live production cross-tenant bypass exists; the write hot path is GUC-pinned with catalog ownership re-checked; reads are app-scoped and fail closed under Prisma; the RLS artifact is reviewed and integration-proven (38/38 on disposable PG); all static/unit/build validations are green. It is **not** claimed production-ready: P1 items — applying RLS + supporting indexes and verifying PgBouncer transaction-pooling pin behavior — require an isolated staging environment outside this phase's boundaries. This decision authorizes proceeding to staging preparation, not production release.


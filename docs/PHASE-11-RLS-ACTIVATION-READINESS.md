# Phase 11 — RLS Activation Readiness Report

**Scope:** make every production database path RLS-compatible by pinning the
tenant transaction context (`SET LOCAL app.organization_id` / `app.outlet_id`)
inside the same transaction that runs the query. No remote database was touched,
no `.env` value was read, nothing was staged/committed/pushed. All §25 local
gates pass.

---

## 1. Confirmed defect (why this phase existed)

`src/server/runtime.ts` composes `PrismaOrders` / `PrismaCatalog` /
`PrismaPayments` for **every PRODUCTION session** (demo sessions go to the
in-memory sandbox). Until now, **only `PrismaOrders.createTransactional()`
pinned tenant GUCs.** Every other production Prisma query ran *unpinned*.

Under active RLS (`prisma/rls-tenant-isolation.sql` uses
`current_setting('app.organization_id', false)` in every predicate), an unpinned
query sees the GUC as `''`, so `organizationId = ''` is always FALSE. Result:
**legitimate reads return 0 rows and legitimate writes fail their `WITH CHECK`**
— a fail-closed break of real POS / KDS / Finance flows the moment RLS is
switched on.

RLS filters on **only** `app.organization_id` + `app.outlet_id`; `app.role`
appears in a comment only, and `Organization`/`Outlet`/`User`/`Membership` are
deliberately **NO RLS** bootstrap tables (readable without a pin).

Unpinned production methods (before this phase):
- `PrismaOrders`: `findById`, `save`, `listByOutlet`, `listByTenant`, `nextOrderNumber`
- `PrismaPayments`: `save`, `listByOrder`, `listByTenant`
- `PrismaCatalog`: `findById`, `listActive`

---

## 2. What changed (actual edits)

### 2.1 `src/server/db/tenant-context.ts`
Added `persistencePinContext(organizationId, outletId)` — builds a validated
`TenantContext` from an **authoritative** organizationId the adapter already
holds (persisted `tenantId`, explicit tenant argument, verified scope, or an
`Outlet -> organizationId` lookup). Role is pinned as `"pos"` **only** to satisfy
`requireTenantContext`'s whitelist — *no RLS predicate reads `app.role`*, and
real RBAC stays at the route/authz layer. DataScope is always `PRODUCTION`
(demo never reaches these adapters).

### 2.2 `src/server/db/orders-adapter.ts`
Every method now pins GUCs **first** inside its `$transaction` (exact
`createTransactional` pattern), deriving org from authoritative data:

| Method | Org source | Notes |
|---|---|---|
| `findById(id, scope?)` | `scope.organizationId` when supplied | Scoped path pins + reads in one tx. Unscoped path is left unpinned (fails closed under RLS) — see blockers. |
| `save(order)` | `order.tenantId` / `order.outletId` | Existing tenant-mismatch guard now runs under a pinned context. |
| `listByOutlet(outletId)` | **resolved from `Outlet` row** (NO-RLS bootstrap table) | New `resolveOrganizationForOutlet()`; missing outlet → `OUTLET_MISMATCH` (fail closed, never guesses a tenant). |
| `listByTenant(tenantId)` | `tenantId`, outlet pinned to `__none__` | Tenant-wide read uses the sentinel, never empty string. |
| `nextOrderNumber(outletId)` | resolved from `Outlet` row | Counter upsert is now RLS-compatible. |

`outletId` reaching `listByOutlet`/`history` is the **revalidated server-side
actor's** `outletIds[0]` (see `src/app/api/orders/route.ts:237`), never a client
field — so resolving the org from that trusted Outlet row is safe. KDS
`listQueue`/`getOrderById` are defined but not yet wired to any API route.

### 2.3 `src/server/db/payment-adapter.ts`
`save` pins `payment.tenantId`/`payment.outletId` before the insert (satisfies
RLS `WITH CHECK`). Scoped `listByOrder` runs the parent-tenant check + read in
one pinned transaction. `listByTenant` pins org with `__none__` outlet.

### 2.4 `src/server/db/catalog-adapter.ts`
Scoped `findById` pins then reads in one transaction (cross-tenant id still
resolves to `null`). `listActive(tenantId)` pins org with `__none__` outlet.

### 2.5 Test-fake updates (support the pin; no assertion weakened)
- `tests/phase-a-persistence.test.ts`: `FakeTx` gained a `seed` snapshot and its
  `order.findUnique` now reads `seed + writes` and returns the full enriched row
  shape (`toOrderRecord` needs money/state/createdAt). `$transaction` seeds
  `shadow.seed` from committed orders (models READ COMMITTED). No tenant filter
  or RBAC was relaxed — scoped `findById` still denies cross-tenant ids.
- `tests/tenant-isolation.test.ts`: the two adapter fakes (`PrismaCatalog`,
  `PrismaPayments`) gained a `$transaction` shim so the scoped read runs inside
  a (no-op-pinned) transaction. Cross-tenant assertions unchanged.

**Nothing else was edited.** Ports, memory-store, demo sandbox, and all callers
keep their existing signatures.

---

## 3. Validation results (all §25 gates pass)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | **pass** (exit 0) |
| Lint | `npm run lint` | **pass** (0 warnings/errors) |
| Tests | `npm test` | **27 files, 271 passed / 1 skipped** (exact baseline) |
| Schema | `npx prisma validate` | **valid** |
| Build | `npm run build` | **pass** (exit 0) |

Git: HEAD unchanged (`1bf82a4`), nothing staged, prior modified/untracked work
preserved. No remote DB, no deploy.

---

## 4. Remaining blockers before flipping RLS on

1. **Unscoped legacy reads are still unpinned.** `orders.findById()` without
   `scope` (called by `pos/lifecycle.requireOrder`, `pos/service.getOrderById`,
   `finance/service.requestRefund`) and the unscoped branches of
   `catalog.findById` / `payments.listByOrder` intentionally do **not** pin
   (no organizationId is available) and therefore fail closed under RLS. These
   production callers must be moved to the scoped variants (pass the verified
   tenant) before RLS activation. This is the precise next code step.
2. **PgBouncer transaction-pooling test.** Prisma interactive tx + `SET LOCAL`
   must be proven against a disposable PostgreSQL under transaction pooling
   (Phase 9 validated on a direct connection). No prod creds; reuse the
   disposable-cluster procedure from `docs/PHASE-9-POSTGRES-SECURITY-REPORT.md`.
3. **Parent-join `EXPLAIN` performance.** The RLS parent-join predicates on
   `OrderItem`/`Payment`/`RecipeItem` need an `EXPLAIN (ANALYZE)` sanity pass on
   a disposable PG to confirm the org predicate is index-supported at volume.
4. **`CREATE INDEX CONCURRENTLY` rollout.** Tenant-prefix indexes referenced by
   the RLS artifact should be created with `CONCURRENTLY` in a scheduled
   migration (no table rewrite / no long lock) — proposed as a follow-up
   migration, not part of this phase.

---

## 5. Precise next step

Move the three unscoped production `orders.findById` callers (and the two
unscoped port branches) onto the scoped/pinned variants — threading the
revalidated tenant into `requireOrder` / `getOrderById` / `requestRefund` — then
re-run the disposable-PG integration (blocker 2) to prove the pinned reads/writes
end-to-end under real RLS before any `ENABLE ROW LEVEL SECURITY`.


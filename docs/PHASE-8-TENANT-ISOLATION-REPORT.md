# HANSAN — Phase 8: Tenant Isolation & RLS Hardening Report

Date UTC: 2026-10-11. Branch main @ 1bf82a4. Local-code only.
No real database contacted, no migration/RLS applied, no secrets read,
no stage/commit/push/deploy. All work preserved as found + new files below.

## 1. Verified findings R1-R4 (against current tree, not prior report)

R1 CONFIRMED: no SET LOCAL writer. rls-demo-isolation.sql:9-10 claims the
R2 CONFIRMED: demo RLS predicates are dataScope-only; no organizationId or
outletId predicate anywhere. App tenancy = authz.ts + revalidateLiveSession +
adapter WHERE only. PROD Org A can R/W PROD Org B at DB layer today.
R3 CONFIRMED: Payment/Refund/SettlementBatch lack UPDATE (legit writes denied
under RLS); InventoryMovement/AuditEvent lack SELECT (reads denied under
FORCE); AuditEvent ENABLE without FORCE (owner bypasses); 13 tables
(Organization, Outlet, User, Membership, MenuCategory, MenuItem, Ingredient,
Recipe, RecipeItem, OrderItem, SequenceCounter, IdempotencyRecord, Approval)
have zero RLS coverage.
R4 CONFIRMED (then hardened): Catalog.findById unscoped; Payments.listByOrder
orderId-only; PrismaOrders.save omitted dataScope + upserted without tenant
re-check; findById scope optional and [id] route called it unscoped.
listByOutlet outlet-only is INTENTIONAL (unguessable ids + route outlet auth);
org check now added at DB layer via RLS.

## 2. Architecture + transaction-context design

File: src/server/db/tenant-context.ts (new).
- requireTenantContext: fail-closed validator (org required, outlet concrete
  or null, role allow-list, dataScope PRODUCTION-only on Prisma path).
  Throws TENANT_MISMATCH/OUTLET_MISMATCH/FORBIDDEN before any SQL.
- tenantContextForActor: builds context from REVALIDATED live actor only
  (resolveLiveActor/revalidateLiveSession DB truth). Never cookie claims or
  request-body tenant fields. Non-owner outlet must be in granted set.
- pinTenantContext: 4x set_config(...,true)==SET LOCAL as FIRST statements
  of the SAME transaction, before any protected read/write. Tenant-wide
  owner/finance reads pin outlet sentinel '__none__' (never ''/NULL).
- withTenantTransaction: wraps db.$transaction with pin-first; callbacks MUST
  use tx client. SET LOCAL dies with commit/rollback: no pool leak.
- Threat model (documented in code): GUCs are convenience, not boundary.
  Layer 1 app checks, layer 2 tx GUCs, layer 3 RLS fail-closed predicates.
  RLS catches app bugs; arbitrary SQL as app role can SET GUCs (out of scope;
  role never exposed). Jobs/admin use same pinned path, no bypass.

## 3. Table-by-table RLS coverage matrix

Artifact: prisma/rls-tenant-isolation.sql (new, REVIEWABLE NOT APPLIED).
Supersedes rls-demo-isolation.sql (left untouched). Additive only:
ENABLE/FORCE + DROP IF EXISTS + CREATE POLICY. No seed, no destructive DDL.
All predicates use current_setting(key,false): absent GUC THROWS (fail-closed).

Direct organizationId: Order, Payment, Refund, SettlementBatch (SELECT org+
scope+outlet-or-none; INSERT org+concrete-outlet+scope; UPDATE org+scope;
no DELETE); MenuCategory/MenuItem/Ingredient/Recipe (FOR ALL org);
InventoryMovement (SELECT+INSERT org; no UPDATE/DELETE append-only);
IdempotencyRecord (FOR ALL org); Approval (SELECT+INSERT org);
AuditEvent (SELECT+INSERT org-or-null; no UPDATE/DELETE; FORCE added).
Parent-derived (no redundant column): OrderItem via Order.orderId EXISTS-join
(SELECT/INSERT/UPDATE); RecipeItem via Recipe.recipeId (FOR ALL join);
SequenceCounter via Outlet.outletId EXISTS-join (FOR ALL).
Identity NO RLS by design: Organization/Outlet/User/Membership (bootstrap +
session issuance precede any context; secret-gated + app-gated).
FORCE: every RLS table incl. AuditEvent (demo file lacked it there).
Required indexes (additive CONCURRENTLY on disposable PG before staging):
(Order/Payment/Refund/Settlement)(organizationId,outletId);
(MenuItem/Category/Ingredient/Recipe)(organizationId);
Movement/Audit(organizationId,occurredAt).
Rollback: DROP each policy reverse + DISABLE RLS per table (commented).
Rollback removes DB guarantee (app checks remain).

## 4. Files changed + migration review

New (8): src/server/db/tenant-context.ts, tenant-isolation-design.ts,
rls-coverage-matrix.ts, src/domain/shared/tenant-scope.ts,
prisma/rls-tenant-isolation.sql, tests/tenant-isolation.test.ts,
tests/tenant-scope-stores.test.ts, docs/PHASE-8-TENANT-ISOLATION-REPORT.md.
Modified (8): domain/shared/ports.ts (optional scope on Catalog/Payment find),
server/db/catalog-adapter.ts + payment-adapter.ts + memory-store.ts +
tests/helpers/memory.ts (scoped paths), server/db/orders-adapter.ts
(GUC pin + save tenant check + PRODUCTION default), app/api/orders/[id]/
route.ts (scoped findById), tests/prisma-schema.test.ts (tenant artifact
guards), tests/pos-order.test.ts (2 cross-tenant expectations 403->404:
scoped adapter hides foreign rows pre-authorize = no existence leak),
tests/phase-a-persistence.test.ts (FakeTx $executeRawUnsafe no-op).
No existing migration touched. New SQL is a standalone artifact, not a
prisma/migrations/ entry (no migration_lock change, no schema.prisma change):
deliberate — RLS grants/policies are review-gated staging operations, and a
## 5. Adversarial test coverage + results

New unit (no DB): tests/tenant-isolation.test.ts (13) — missing/invalid org,
empty outlet, unknown role, DEMO-on-prod-path, ungranted outlet; GUC pin
order/payloads + __none__ sentinel + withTenantTransaction pin-first;
PrismaCatalog/PrismaPayments cross-tenant fakes; RLS static (15 tables,
no missing_ok fallback, identity exclusion documented, append-only kept).
tests/tenant-scope-stores.test.ts (3) — MemoryOrders/Catalog/Payments scope.
Extended: prisma-schema.test.ts tenant-artifact guards (9 total).
Updated: pos-order cross-tenant 403->404 (hide existence); phase-a FakeTx.
Coverage: missing/invalid context, OrgA-vs-OrgB read/mutate (adapter null/[]
+ save TENANT_MISMATCH), outlet-A-vs-B, cross-tenant child insert (catalog
check + RLS parent-join), parent/child mismatch, payment/refund scope,
pool isolation (SET LOCAL semantics + pin-first ordering), legit allowed ops
(same-tenant reads/writes pass), all protected tables (static matrix).

## 6. Exact validation commands/results (current tree)

- npm run typecheck: CLEAN exit 0.
- npm run lint: CLEAN No ESLint warnings or errors.
- npm test: 27 files passed, 271 passed | 1 skipped (was 25/254+1).
- npm run db:validate: schema at prisma\schema.prisma is valid.
- npm run build: CLEAN Next 14.2.35.
- Static policy checks: prisma-schema.test.ts tenant-artifact guards pass
  (fail-closed GUCs, FORCE incl. audit, no destructive DDL/seed).
- Mocked/unit vs integration: ALL of the above is mocked/unit + static.
  NO PostgreSQL integration was run (no disposable PG, no prod creds).

## 7. Remaining risks — require isolated disposable-PG integration

U1: Prisma interactive tx + SET LOCAL under pgbouncer transaction pooling:
prove pin-first ordering + no cross-tx leak on real PG (unit proves payloads).
U2: '__none__' tenant-wide read rules: prove owner/finance see own org only,
no silent fail-open, on real PG.
U3: AuditEvent FORCE + legacy writers: confirm loud break (desired) on disp PG.
U4: Parent-join RLS perf (OrderItem/RecipeItem/SequenceCounter EXISTS): EXPLAIN
on realistic volumes; add CONCURRENTLY indexes before staging.
U5: Optional-scope legacy callers (lifecycle/finance unscoped findById):
migrate to required scope once call sites carry actor scope.
Do NOT claim DB-level security verified until U1-U4 pass on disposable PG.
Never use production credentials; never apply to staging/prod before that.

## 8. External-access confirmation

No external database accessed or changed: no DATABASE_URL/DIRECT_URL read for
values, no prisma migrate/prisma db push/psql, no RLS/grant applied, no
Supabase project touched, no users provisioned, no financial ops, no secrets
printed, no stage/commit/push/merge/deploy. Validation-only commands above.

half-reviewed migration entry would imply readiness. Promote to a real
migration directory only after disposable-PG integration proves U1-U3.

Wiring: PrismaOrders.createTransactional pins (org/outlet from verified
draft); save() verifies existing row tenant + defaults dataScope PRODUCTION.
Route GET /api/orders/[id] passes { organizationId } scope (404 hide).

adapter sets app.data_scope; grep SET LOCAL finds only that comment.
PrismaOrders.createTransactional + save + nextOrderNumber use plain
db.$transaction with zero GUC pinning. Reads fail OPEN when GUC unset.

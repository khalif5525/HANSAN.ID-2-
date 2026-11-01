/**
 * Phase 8 design note — tenant isolation + RLS hardening.
 * Local-code design only. No database contacted or changed.
 *
 * Verified findings (against current tree):
 *  R1 CONFIRMED: no SET LOCAL writer. RLS comment claims the adapter sets
 *     app.data_scope; grep finds only the comment. Adapters use plain
 *     db.$transaction with no GUC pinning.
 *  R2 CONFIRMED: RLS predicates are dataScope-only; no org/outlet predicate
 *     anywhere. App tenancy = authz.ts + revalidate + adapter WHERE only.
 *  R3 CONFIRMED: Payment/Refund/SettlementBatch lack UPDATE (legit writes
 *     denied); movement/audit lack SELECT (reads denied under FORCE);
 *     AuditEvent ENABLE without FORCE (owner bypass); 13 tables uncovered.
 *  R4 CONFIRMED: Catalog.findById unscoped; Payments.listByOrder orderId-only;
 *     PrismaOrders.save omits dataScope + upserts without tenant re-check;
 *     findById scope optional and [id] route calls without scope.
 *     (listByOutlet outlet-only is intentional — outlet ids are unguessable
 *     and routes authorize outlet; RLS adds the org check at DB layer.)
 *
 * Architecture (3 layers):
 *  1. App: requireAuth -> requireRevalidatedLiveContext -> authorizeRecord ->
 *     adapter WHERE clauses (tenantContextForActor pins which outlet).
 *  2. Tx GUCs: withTenantTransaction sets app.organization_id/outlet_id/role/
 *     data_scope via SET LOCAL FIRST in SAME tx (see tenant-context.ts).
 *  3. RLS: prisma/rls-tenant-isolation.sql fail-closed predicates
 *     (current_setting(...,false), no missing_ok) + FORCE everywhere except
 *     bootstrap identity tables. RLS catches app bugs; not arbitrary-SQL role.
 *
 * Unresolved (needs isolated PG integration test, NOT prod):
 *  U1: Prisma interactive tx + SET LOCAL under pgbouncer transaction pooling
 *     must be proven with a disposable PG (no prod creds). Unit tests prove
 *     ordering/payloads only.
 *  U2: Owner/finance tenant-wide reads pin outlet '__none__'; RLS tenant-wide
 *     read rules must be proven against real PG (no silent fail-open).
 *  U3: AuditEvent FORCE vs ENABLE: created with FORCE in new matrix; if a
 *     legacy superuser writer exists it breaks loudly (desired) — confirm on
 *     disposable PG before staging.
 */
export {};

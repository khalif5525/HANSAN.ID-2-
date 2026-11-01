/**
 * Phase 8 coverage matrix — table-by-table RLS design (local review).
 * Additive artifact: prisma/rls-tenant-isolation.sql (NOT applied).
 *
 * Ownership derivation:
 *  - Direct organizationId: Order, Payment, Refund, SettlementBatch,
 *    MenuCategory, MenuItem, Ingredient, Recipe, InventoryMovement,
 *    IdempotencyRecord, Approval, AuditEvent (nullable org).
 *  - Parent-derived (no redundant column): OrderItem via Order.orderId;
 *    RecipeItem via Recipe.recipeId; SequenceCounter via Outlet.outletId.
 *  - Identity (no RLS by design): Organization, Outlet, User, Membership —
 *    bootstrap + session issuance precede any tenant context; app-gated.
 *
 * Policy summary (all fail-closed via current_setting(...,false)):
 *  Order/Payment/Refund/Settlement: SELECT(org+scope+outlet-or-none),
 *    INSERT(org+concrete-outlet+scope), UPDATE(org+scope, no scope change),
 *    no DELETE (lifecycle, not hard delete).
 *  MenuCategory/MenuItem/Ingredient/Recipe: FOR ALL org match.
 *  OrderItem/RecipeItem/SequenceCounter: parent-join org match.
 *  InventoryMovement: SELECT+INSERT org match; no UPDATE/DELETE (append-only).
 *  IdempotencyRecord: FOR ALL org match (reclaim path deletes own rows).
 *  Approval: SELECT+INSERT org match; no UPDATE/DELETE (decision trail).
 *  AuditEvent: SELECT+INSERT org-or-null; no UPDATE/DELETE; FORCE added.
 *
 * FORCE: every RLS table incl. AuditEvent (new). Demo file lacked FORCE on
 * audit; legacy superuser writers break loudly (desired, confirm on disp PG).
 * Indexes required (verify on disposable PG, additive CONCURRENTLY):
 *  Order/Payment/Refund/Settlement (organizationId,outletId),
 *  MenuItem/Category/Ingredient/Recipe (organizationId),
 *  Movement (organizationId,occurredAt), Audit (organizationId,occurredAt).
 * Child verification: FK RESTRICT on parent ids (already in init migration)
 *  + EXISTS-join predicates above; parent/child mismatch fails closed.
 *
 * Background jobs: build TenantContext from verified job payload (org/outlet
 * re-read from DB at run time), run via withTenantTransaction. No ambient key.
 * Platform/admin: provisionOwner runs BEFORE context exists (secret-gated,
 * no RLS on identity tables); staff invite uses actor org (already scoped).
 */
export {};

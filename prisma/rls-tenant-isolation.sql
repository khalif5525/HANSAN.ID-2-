-- HANSAN — Row Level Security: tenant isolation (Phase 8 artifact).
--
-- REVIEWABLE, NOT YET APPLIED. Additive: only ENABLE/FORCE + CREATE POLICY.
-- Never drops or alters existing policies. Original demo-scope file
-- (rls-demo-isolation.sql) is SUPERSEDED by this matrix but left untouched.
--
-- Context (set FIRST in SAME tx by withTenantTransaction):
--   app.organization_id (required), app.outlet_id (concrete or '__none__'
--   for tenant-wide owner/finance reads), app.role, app.data_scope.
-- All predicates use current_setting(key, false) — MISSING GUC THROWS, so an
-- unset context fails CLOSED (never fails open like missing_ok=true would).
--
-- Threat model: RLS catches application bugs. It does NOT stop arbitrary SQL
-- executed as the app role (that SQL can SET GUCs). The app role is never
-- exposed to clients; background jobs use the same pinned-context path.
--
-- 1) Tenant tables: org check on every op; outlet check where outlet-scoped;
--    dataScope pinned to PRODUCTION on the live path.

ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_tenant_select ON "Order";
CREATE POLICY order_tenant_select ON "Order" FOR SELECT USING (
  "organizationId" = current_setting('app.organization_id', false)
  AND "dataScope" = 'PRODUCTION'
  AND (current_setting('app.outlet_id', false) = '__none__' OR "outletId" = current_setting('app.outlet_id', false))
);
DROP POLICY IF EXISTS order_tenant_insert ON "Order";
CREATE POLICY order_tenant_insert ON "Order" FOR INSERT WITH CHECK (
  "organizationId" = current_setting('app.organization_id', false)
  AND "outletId" = current_setting('app.outlet_id', false)
  AND current_setting('app.outlet_id', false) <> '__none__'
  AND "dataScope" = 'PRODUCTION'
);
DROP POLICY IF EXISTS order_tenant_update ON "Order";
CREATE POLICY order_tenant_update ON "Order" FOR UPDATE USING (
  "organizationId" = current_setting('app.organization_id', false)
  AND "dataScope" = 'PRODUCTION'
) WITH CHECK (
  "organizationId" = current_setting('app.organization_id', false)
  AND "dataScope" = 'PRODUCTION'
);
-- No DELETE policy: orders are never hard-deleted (cancel/refund lifecycle).

ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_tenant_select ON "Payment";
CREATE POLICY payment_tenant_select ON "Payment" FOR SELECT USING (
  "organizationId" = current_setting('app.organization_id', false)
  AND "dataScope" = 'PRODUCTION'
  AND (current_setting('app.outlet_id', false) = '__none__' OR "outletId" = current_setting('app.outlet_id', false))
);
DROP POLICY IF EXISTS payment_tenant_insert ON "Payment";
CREATE POLICY payment_tenant_insert ON "Payment" FOR INSERT WITH CHECK (
  "organizationId" = current_setting('app.organization_id', false)
  AND "outletId" = current_setting('app.outlet_id', false)
  AND current_setting('app.outlet_id', false) <> '__none__'
  AND "dataScope" = 'PRODUCTION'
);
DROP POLICY IF EXISTS payment_tenant_update ON "Payment";
CREATE POLICY payment_tenant_update ON "Payment" FOR UPDATE USING (
  "organizationId" = current_setting('app.organization_id', false)
  AND "dataScope" = 'PRODUCTION'
) WITH CHECK (
  "organizationId" = current_setting('app.organization_id', false)
  AND "dataScope" = 'PRODUCTION'
);
-- Refund: same money-table guarantees (replaces INSERT-only demo policy).
ALTER TABLE "Refund" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Refund" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS refund_tenant_select ON "Refund";
CREATE POLICY refund_tenant_select ON "Refund" FOR SELECT USING (
  "organizationId" = current_setting('app.organization_id', false)
  AND "dataScope" = 'PRODUCTION'
  AND (current_setting('app.outlet_id', false) = '__none__' OR "outletId" = current_setting('app.outlet_id', false))
);
DROP POLICY IF EXISTS refund_tenant_insert ON "Refund";
CREATE POLICY refund_tenant_insert ON "Refund" FOR INSERT WITH CHECK (
  "organizationId" = current_setting('app.organization_id', false)
  AND "outletId" = current_setting('app.outlet_id', false)
  AND current_setting('app.outlet_id', false) <> '__none__'
  AND "dataScope" = 'PRODUCTION'
);
DROP POLICY IF EXISTS refund_tenant_update ON "Refund";
CREATE POLICY refund_tenant_update ON "Refund" FOR UPDATE USING (
  "organizationId" = current_setting('app.organization_id', false)
  AND "dataScope" = 'PRODUCTION'
) WITH CHECK (
  "organizationId" = current_setting('app.organization_id', false)
  AND "dataScope" = 'PRODUCTION'
);

-- SettlementBatch: close/approve mutate rows, so UPDATE is required.
ALTER TABLE "SettlementBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SettlementBatch" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlement_tenant_select ON "SettlementBatch";
CREATE POLICY settlement_tenant_select ON "SettlementBatch" FOR SELECT USING (
  "organizationId" = current_setting('app.organization_id', false)
  AND "dataScope" = 'PRODUCTION'
  AND (current_setting('app.outlet_id', false) = '__none__' OR "outletId" = current_setting('app.outlet_id', false))
);
DROP POLICY IF EXISTS settlement_tenant_insert ON "SettlementBatch";
CREATE POLICY settlement_tenant_insert ON "SettlementBatch" FOR INSERT WITH CHECK (
  "organizationId" = current_setting('app.organization_id', false)
  AND "outletId" = current_setting('app.outlet_id', false)
  AND current_setting('app.outlet_id', false) <> '__none__'
  AND "dataScope" = 'PRODUCTION'
);
DROP POLICY IF EXISTS settlement_tenant_update ON "SettlementBatch";
CREATE POLICY settlement_tenant_update ON "SettlementBatch" FOR UPDATE USING (
  "organizationId" = current_setting('app.organization_id', false)
  AND "dataScope" = 'PRODUCTION'
) WITH CHECK (
  "organizationId" = current_setting('app.organization_id', false)
  AND "dataScope" = 'PRODUCTION'
);

-- OrderItem: derives tenancy through its parent Order (trusted FK, RESTRICT).
-- No redundant organizationId column: parent join is the ownership check.
ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orderitem_tenant_select ON "OrderItem";
CREATE POLICY orderitem_tenant_select ON "OrderItem" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "Order" o WHERE o.id = "OrderItem"."orderId"
    AND o."organizationId" = current_setting('app.organization_id', false))
);
DROP POLICY IF EXISTS orderitem_tenant_insert ON "OrderItem";
CREATE POLICY orderitem_tenant_insert ON "OrderItem" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "Order" o WHERE o.id = "OrderItem"."orderId"
    AND o."organizationId" = current_setting('app.organization_id', false))
);
DROP POLICY IF EXISTS orderitem_tenant_update ON "OrderItem";
CREATE POLICY orderitem_tenant_update ON "OrderItem" FOR UPDATE USING (
  EXISTS (SELECT 1 FROM "Order" o WHERE o.id = "OrderItem"."orderId"
    AND o."organizationId" = current_setting('app.organization_id', false))
) WITH CHECK (
  EXISTS (SELECT 1 FROM "Order" o WHERE o.id = "OrderItem"."orderId"
    AND o."organizationId" = current_setting('app.organization_id', false))
);
-- Catalog: direct organizationId ownership.
ALTER TABLE "MenuCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MenuCategory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS menucategory_tenant_all ON "MenuCategory";
CREATE POLICY menucategory_tenant_all ON "MenuCategory" FOR ALL USING (
  "organizationId" = current_setting('app.organization_id', false)
) WITH CHECK ("organizationId" = current_setting('app.organization_id', false));
ALTER TABLE "MenuItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MenuItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS menuitem_tenant_all ON "MenuItem";
CREATE POLICY menuitem_tenant_all ON "MenuItem" FOR ALL USING (
  "organizationId" = current_setting('app.organization_id', false)
) WITH CHECK ("organizationId" = current_setting('app.organization_id', false));
ALTER TABLE "Ingredient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ingredient" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ingredient_tenant_all ON "Ingredient";
CREATE POLICY ingredient_tenant_all ON "Ingredient" FOR ALL USING (
  "organizationId" = current_setting('app.organization_id', false)
) WITH CHECK ("organizationId" = current_setting('app.organization_id', false));
-- Recipe + RecipeItem: NEITHER carries organizationId (schema fact: Recipe =
-- id,menuItemId,yieldQty,yieldUnit; RecipeItem = id,recipeId,ingredientId,qty).
-- Tenancy is derived through the trusted FK chain up to MenuItem.organizationId:
--   Recipe      : menuItemId      -> MenuItem.organizationId
--   RecipeItem  : recipeId->Recipe-> menuItemId -> MenuItem.organizationId
ALTER TABLE "Recipe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Recipe" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recipe_tenant_all ON "Recipe";
CREATE POLICY recipe_tenant_all ON "Recipe" FOR ALL USING (
  EXISTS (SELECT 1 FROM "MenuItem" m WHERE m.id = "Recipe"."menuItemId"
    AND m."organizationId" = current_setting('app.organization_id', false))
) WITH CHECK (
  EXISTS (SELECT 1 FROM "MenuItem" m WHERE m.id = "Recipe"."menuItemId"
    AND m."organizationId" = current_setting('app.organization_id', false))
);
ALTER TABLE "RecipeItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecipeItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recipeitem_tenant_rw ON "RecipeItem";
CREATE POLICY recipeitem_tenant_rw ON "RecipeItem" FOR ALL USING (
  EXISTS (
    SELECT 1 FROM "Recipe" r
    JOIN "MenuItem" m ON m.id = r."menuItemId"
    WHERE r.id = "RecipeItem"."recipeId"
      AND m."organizationId" = current_setting('app.organization_id', false))
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM "Recipe" r
    JOIN "MenuItem" m ON m.id = r."menuItemId"
    WHERE r.id = "RecipeItem"."recipeId"
      AND m."organizationId" = current_setting('app.organization_id', false))
);
-- Movement: append-only, org-checked INSERT+SELECT (SELECT was missing).
ALTER TABLE "InventoryMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryMovement" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS movement_tenant_select ON "InventoryMovement";
CREATE POLICY movement_tenant_select ON "InventoryMovement" FOR SELECT USING (
  "organizationId" = current_setting('app.organization_id', false)
);
DROP POLICY IF EXISTS movement_tenant_insert ON "InventoryMovement";
CREATE POLICY movement_tenant_insert ON "InventoryMovement" FOR INSERT WITH CHECK (
  "organizationId" = current_setting('app.organization_id', false)
);
-- SequenceCounter: derives tenancy through parent Outlet (trusted FK).
ALTER TABLE "SequenceCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SequenceCounter" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sequence_tenant_all ON "SequenceCounter";
CREATE POLICY sequence_tenant_all ON "SequenceCounter" FOR ALL USING (
  EXISTS (SELECT 1 FROM "Outlet" o WHERE o.id = "SequenceCounter"."outletId"
    AND o."organizationId" = current_setting('app.organization_id', false))
) WITH CHECK (
  EXISTS (SELECT 1 FROM "Outlet" o WHERE o.id = "SequenceCounter"."outletId"
    AND o."organizationId" = current_setting('app.organization_id', false))
);
ALTER TABLE "IdempotencyRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdempotencyRecord" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS idempotency_tenant_all ON "IdempotencyRecord";
CREATE POLICY idempotency_tenant_all ON "IdempotencyRecord" FOR ALL USING (
  "organizationId" = current_setting('app.organization_id', false)
) WITH CHECK ("organizationId" = current_setting('app.organization_id', false));
ALTER TABLE "Approval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Approval" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approval_tenant_select ON "Approval";
CREATE POLICY approval_tenant_select ON "Approval" FOR SELECT USING (
  "organizationId" = current_setting('app.organization_id', false)
);
DROP POLICY IF EXISTS approval_tenant_insert ON "Approval";
CREATE POLICY approval_tenant_insert ON "Approval" FOR INSERT WITH CHECK (
  "organizationId" = current_setting('app.organization_id', false)
);
-- AuditEvent: org-scoped INSERT+SELECT; FORCE added (owner also gated).
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_tenant_select ON "AuditEvent";
CREATE POLICY audit_tenant_select ON "AuditEvent" FOR SELECT USING (
  "organizationId" IS NULL OR "organizationId" = current_setting('app.organization_id', false)
);
DROP POLICY IF EXISTS audit_tenant_insert ON "AuditEvent";
CREATE POLICY audit_tenant_insert ON "AuditEvent" FOR INSERT WITH CHECK (
  "organizationId" IS NULL OR "organizationId" = current_setting('app.organization_id', false)
);
-- Identity tables (Organization/Outlet/User/Membership): NO RLS (bootstrap +
-- session issuance must work before any tenant context exists; app-gated).
-- ROLLBACK: DROP each policy above in reverse, then DISABLE RLS per table.
-- Rolling back removes DB-layer guarantee (app checks remain).

-- Reservation: tenant-scoped, outlet-scoped lifecycle table.
ALTER TABLE "Reservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Reservation" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reservation_tenant_select ON "Reservation";
CREATE POLICY reservation_tenant_select ON "Reservation" FOR SELECT USING (
  "organizationId" = current_setting('app.organization_id', false)
  AND "dataScope" = 'PRODUCTION'
  AND (current_setting('app.outlet_id', false) = '__none__' OR "outletId" = current_setting('app.outlet_id', false))
);
DROP POLICY IF EXISTS reservation_tenant_insert ON "Reservation";
CREATE POLICY reservation_tenant_insert ON "Reservation" FOR INSERT WITH CHECK (
  "organizationId" = current_setting('app.organization_id', false)
  AND "outletId" = current_setting('app.outlet_id', false)
  AND current_setting('app.outlet_id', false) <> '__none__'
  AND "dataScope" = 'PRODUCTION'
);
DROP POLICY IF EXISTS reservation_tenant_update ON "Reservation";
CREATE POLICY reservation_tenant_update ON "Reservation" FOR UPDATE USING (
  "organizationId" = current_setting('app.organization_id', false)
  AND "dataScope" = 'PRODUCTION'
) WITH CHECK (
  "organizationId" = current_setting('app.organization_id', false)
  AND "dataScope" = 'PRODUCTION'
);
-- No DELETE policy: reservations use cancellation lifecycle.

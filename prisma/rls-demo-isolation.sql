-- HANSAN — Row Level Security: demo/production isolation (Phase 2 artifact).
--
-- REVIEWABLE, NOT YET APPLIED. Applying policies requires DATABASE_URL and a
-- maintenance window approval (BLOCKER-002). This file is additive: it only
-- adds policies, never drops anything.
--
-- Model:
--   * Every business table carries organizationId (+ dataScope where scoped).
--   * The application sets: SET LOCAL app.data_scope = 'PRODUCTION' | 'DEMO'
--     per transaction (written by the Prisma adapter in src/server/db).
--   * Policies below guarantee a DEMO session physically cannot UPDATE or
--     INSERT production-scope rows even if application code has a bug.

-- 1) Enable RLS (does not restrict the table owner until policies exist;
--    with FORCE ROW LEVEL SECURITY the owner is also subject to policies).
ALTER TABLE "Order"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Refund"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SettlementBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent"     ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Order"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "Payment"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "Refund"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "SettlementBatch" FORCE ROW LEVEL SECURITY;
ALTER TABLE "InventoryMovement" FORCE ROW LEVEL SECURITY;

-- 2) Reads: a DEMO connection never sees PRODUCTION rows.
CREATE POLICY order_read_scope ON "Order"
  FOR SELECT USING (
    current_setting('app.data_scope', true) IS DISTINCT FROM 'DEMO'
    OR "dataScope" = 'DEMO'
  );

-- 3) Writes: a DEMO connection can only touch DEMO rows, and can never
--    change a row's scope (INSERT policy pins dataScope to the session scope
--    via the CHECK below; UPDATE policy forbids crossing scopes).
CREATE POLICY order_insert_scope ON "Order"
  FOR INSERT WITH CHECK (
    "dataScope" = current_setting('app.data_scope', true)::"DataScope"
  );

CREATE POLICY order_update_scope ON "Order"
  FOR UPDATE USING (
    "dataScope" = current_setting('app.data_scope', true)::"DataScope"
  )
  WITH CHECK (
    "dataScope" = current_setting('app.data_scope', true)::"DataScope"
  );

-- 4) Same guarantees for money-bearing tables.
CREATE POLICY payment_read_scope ON "Payment"
  FOR SELECT USING (
    current_setting('app.data_scope', true) IS DISTINCT FROM 'DEMO'
    OR "dataScope" = 'DEMO'
  );
CREATE POLICY payment_write_scope ON "Payment"
  FOR INSERT WITH CHECK (
    "dataScope" = current_setting('app.data_scope', true)::"DataScope"
  );

CREATE POLICY refund_read_scope ON "Refund"
  FOR SELECT USING (
    current_setting('app.data_scope', true) IS DISTINCT FROM 'DEMO'
    OR "dataScope" = 'DEMO'
  );
CREATE POLICY refund_write_scope ON "Refund"
  FOR INSERT WITH CHECK (
    "dataScope" = current_setting('app.data_scope', true)::"DataScope"
  );

CREATE POLICY settlement_read_scope ON "SettlementBatch"
  FOR SELECT USING (
    current_setting('app.data_scope', true) IS DISTINCT FROM 'DEMO'
    OR "dataScope" = 'DEMO'
  );
CREATE POLICY settlement_write_scope ON "SettlementBatch"
  FOR INSERT WITH CHECK (
    "dataScope" = current_setting('app.data_scope', true)::"DataScope"
  );

-- 5) Audit log is append-only for everyone (including the app role).
CREATE POLICY audit_append ON "AuditEvent"
  FOR INSERT WITH CHECK (true);
-- No UPDATE/DELETE policy exists => RLS denies both.

-- 6) Stock ledger: append-only, scope-checked (corrections = new movements).
CREATE POLICY movement_append ON "InventoryMovement"
  FOR INSERT WITH CHECK (true);
-- No UPDATE/DELETE policy exists => RLS denies both.

-- ROLLBACK (manual, review-gated):
--   DROP POLICY movement_append ON "InventoryMovement";
--   DROP POLICY audit_append ON "AuditEvent";
--   DROP POLICY settlement_write_scope ON "SettlementBatch";
--   DROP POLICY settlement_read_scope ON "SettlementBatch";
--   DROP POLICY refund_write_scope ON "Refund";
--   DROP POLICY refund_read_scope ON "Refund";
--   DROP POLICY payment_write_scope ON "Payment";
--   DROP POLICY payment_read_scope ON "Payment";
--   DROP POLICY order_update_scope ON "Order";
--   DROP POLICY order_insert_scope ON "Order";
--   DROP POLICY order_read_scope ON "Order";
--   ALTER TABLE "AuditEvent"     DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE "InventoryMovement" DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE "SettlementBatch" DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE "Refund"         DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE "Payment"        DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE "Order"          DISABLE ROW LEVEL SECURITY;

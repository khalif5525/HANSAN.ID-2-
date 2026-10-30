-- GUC self-impersonation probe (documents the trust boundary, not a pass/fail).
-- A role that can run set_config within its own session CAN pivot the org GUC.
-- This is the documented limit of custom-GUC RLS: RLS protects against app bugs
-- and cross-tenant mistakes, NOT against arbitrary SQL executed as the app role.
-- The app role must therefore never be exposed to untrusted SQL.
SET ROLE hansan_app;
BEGIN;
SELECT set_config('app.organization_id','org_a',true);
SELECT set_config('app.outlet_id','__none__',true);
SELECT set_config('app.data_scope','PRODUCTION',true);
SELECT set_config('app.role','OWNER',true);
-- App role attempts to pivot its own org GUC to org_b:
SELECT set_config('app.organization_id','org_b',true);
SELECT count(*) AS org_b_visible_orders FROM "Order";
COMMIT;

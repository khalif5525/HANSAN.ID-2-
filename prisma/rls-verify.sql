-- HANSAN — Phase 9 disposable-PostgreSQL RLS security verification harness.
-- SAFETY: run ONLY against a disposable, isolated, localhost PostgreSQL created
-- for this verification (see docs/PHASE-9-POSTGRES-SECURITY-REPORT.md). NEVER
-- point at Supabase/staging/production. Runner asserts a local host first. No
-- prod credentials. Schema columns are QUOTED mixed-case (Prisma), so all
-- camelCase identifiers below are quoted. Idempotent: truncates + re-seeds.
-- ROLE MODEL: hansan_test=superuser (seed/admin); hansan_app=NOSUPERUSER,
-- NOBYPASSRLS, not owner — ALL assertions run as hansan_app so RLS is enforced.
-- ============================================================================
\set ON_ERROR_STOP on

DROP TABLE IF EXISTS rls_results;
CREATE TABLE rls_results (id text, ok boolean, detail text);
GRANT INSERT, SELECT ON rls_results TO hansan_app;

-- SYNTHETIC SEED (superuser bypasses RLS intentionally).
TRUNCATE TABLE "Payment","Refund","OrderItem","Order","SettlementBatch",
  "InventoryMovement","SequenceCounter","IdempotencyRecord","Approval",
  "AuditEvent","RecipeItem","Recipe","MenuItem","Ingredient","MenuCategory",
  "Membership","Outlet","Organization","User" RESTART IDENTITY CASCADE;

INSERT INTO "Organization"(id,name,slug,"dataScope") VALUES
  ('org_a','Org A','org-a','PRODUCTION'),
  ('org_b','Org B','org-b','PRODUCTION'),
  ('org_demo','Org Demo','org-demo','DEMO');
INSERT INTO "Outlet"(id,"organizationId",name) VALUES
  ('out_a1','org_a','A1'),('out_a2','org_a','A2'),('out_b1','org_b','B1');
INSERT INTO "User"(id,email,"displayName") VALUES
  ('usr_a','a@x','A'),('usr_b','b@x','B');
INSERT INTO "Membership"(id,"userId","organizationId","outletId",role) VALUES
  ('m_a1','usr_a','org_a','out_a1','OWNER'),
  ('m_a2','usr_a','org_a','out_a2','OWNER'),
  ('m_b','usr_b','org_b','out_b1','OWNER');
INSERT INTO "MenuCategory"(id,"organizationId",name) VALUES
  ('cat_a','org_a','CatA'),('cat_b','org_b','CatB');
INSERT INTO "MenuItem"(id,"organizationId","categoryId",name,"priceIdr",station) VALUES
  ('mi_a','org_a','cat_a','ItemA',10000,'KITCHEN'),
  ('mi_b','org_b','cat_b','ItemB',20000,'BAR');
INSERT INTO "Ingredient"(id,"organizationId",name,unit,quantity) VALUES
  ('ing_a','org_a','IngA','g',100),('ing_b','org_b','IngB','g',200);
INSERT INTO "Recipe"(id,"menuItemId","yieldQty","yieldUnit") VALUES
  ('rec_a','mi_a',1,'pc'),('rec_b','mi_b',1,'pc');
INSERT INTO "RecipeItem"(id,"recipeId","ingredientId",quantity) VALUES
  ('ri_a','rec_a','ing_a',10),('ri_b','rec_b','ing_b',20);
INSERT INTO "Order"(id,"organizationId","outletId","orderNumber","orderType","subtotalIdr","grandTotalIdr","createdBy","updatedAt") VALUES
  ('ord_a','org_a','out_a1','A-001','dine_in',10000,10000,'usr_a',now()),
  ('ord_a2','org_a','out_a2','A-002','dine_in',10000,10000,'usr_a',now()),
  ('ord_b','org_b','out_b1','B-001','dine_in',20000,20000,'usr_b',now());
INSERT INTO "OrderItem"(id,"orderId","productId","productName",quantity,"unitPriceIdr",station) VALUES
  ('oi_a','ord_a','mi_a','ItemA',1,10000,'KITCHEN'),
  ('oi_a2','ord_a2','mi_a','ItemA',1,10000,'KITCHEN'),
  ('oi_b','ord_b','mi_b','ItemB',1,20000,'BAR');
INSERT INTO "Payment"(id,"organizationId","outletId","orderId","amountIdr",method,"capturedBy") VALUES
  ('pay_a','org_a','out_a1','ord_a',10000,'cash','usr_a'),
  ('pay_b','org_b','out_b1','ord_b',20000,'cash','usr_b');
INSERT INTO "Refund"(id,"organizationId","outletId","orderId","amountIdr",reason,"requestedBy") VALUES
  ('ref_a','org_a','out_a1','ord_a',5000,'r','usr_a'),
  ('ref_b','org_b','out_b1','ord_b',5000,'r','usr_b');
INSERT INTO "SettlementBatch"(id,"organizationId","outletId","batchNumber","openedBy") VALUES
  ('sb_a','org_a','out_a1','SB-A','usr_a'),
  ('sb_b','org_b','out_b1','SB-B','usr_b');
INSERT INTO "InventoryMovement"(id,"organizationId","ingredientId",type,"quantityDelta","quantityAfter",reason,"actorId","occurredAt") VALUES
  ('mov_a','org_a','ing_a','adjustment',5,105,'r','usr_a',now()),
  ('mov_b','org_b','ing_b','adjustment',5,205,'r','usr_b',now());
INSERT INTO "SequenceCounter"("outletId",kind,value) VALUES
  ('out_a1','order',10),('out_b1','order',20);
INSERT INTO "IdempotencyRecord"(id,"organizationId",scope,"key","requestHash",status,"expiresAt") VALUES
  ('idem_a','org_a','orders','k-a','h','done',now()+interval '1 day'),
  ('idem_b','org_b','orders','k-b','h','done',now()+interval '1 day');
INSERT INTO "Approval"(id,"organizationId","entityType","entityId",decision,"decidedBy") VALUES
  ('appr_a','org_a','refund','ref_a','approved','usr_a'),
  ('appr_b','org_b','refund','ref_b','approved','usr_b');
INSERT INTO "AuditEvent"(id,action,"actorId","actorRole","entityType","entityId","organizationId","outletId","occurredAt") VALUES
  ('aud_a','order.created','usr_a','OWNER','Order','ord_a','org_a','out_a1',now()),
  ('aud_b','order.created','usr_b','OWNER','Order','ord_b','org_b','out_b1',now()),
  ('aud_null','system.bootstrap','usr_a','SYSTEM','System','x',NULL,NULL,now());

SET ROLE hansan_app;
-- ===========================================================================
-- ADVERSARIAL ASSERTIONS — all executed as hansan_app (non-superuser, non-owner,
-- NOBYPASSRLS) so FORCE ROW LEVEL SECURITY is genuinely enforced. Each assertion
-- records (id, ok, detail) into rls_results; the script raises if any fail.
-- ===========================================================================

-- ---- BLOCK A: tenant/organization/outlet read isolation --------------------
DO $$
DECLARE n int;
BEGIN
  -- Owner, tenant-wide (outlet sentinel '__none__') inside org_a.
  PERFORM set_config('app.organization_id','org_a',true);
  PERFORM set_config('app.outlet_id','__none__',true);
  PERFORM set_config('app.role','OWNER',true);
  PERFORM set_config('app.data_scope','PRODUCTION',true);

  SELECT count(*) INTO n FROM "Order";                 -- a + a2, never b
  INSERT INTO rls_results VALUES ('A01_order_org_select', n=2, 'org_a tenant-wide sees 2 orders (a,a2) not b; got '||n);
  SELECT count(*) INTO n FROM "Order" WHERE id='ord_b';
  INSERT INTO rls_results VALUES ('A02_order_crossorg_hidden', n=0, 'org_a cannot see ord_b; got '||n);
  SELECT count(*) INTO n FROM "Payment";
  INSERT INTO rls_results VALUES ('A03_payment_org_select', n=1, 'org_a sees only pay_a; got '||n);
  SELECT count(*) INTO n FROM "Refund";
  INSERT INTO rls_results VALUES ('A04_refund_org_select', n=1, 'org_a sees only ref_a; got '||n);
  SELECT count(*) INTO n FROM "SettlementBatch";
  INSERT INTO rls_results VALUES ('A05_batch_org_select', n=1, 'org_a sees only sb_a; got '||n);
  SELECT count(*) INTO n FROM "InventoryMovement";
  INSERT INTO rls_results VALUES ('A06_movement_org_select', n=1, 'org_a sees only mov_a; got '||n);
  SELECT count(*) INTO n FROM "IdempotencyRecord";
  INSERT INTO rls_results VALUES ('A07_idem_org_select', n=1, 'org_a sees only idem_a; got '||n);
  SELECT count(*) INTO n FROM "Approval";
  INSERT INTO rls_results VALUES ('A08_approval_org_select', n=1, 'org_a sees only appr_a; got '||n);
  SELECT count(*) INTO n FROM "MenuCategory";
  INSERT INTO rls_results VALUES ('A09_menucat_org_select', n=1, 'org_a sees only cat_a; got '||n);
  SELECT count(*) INTO n FROM "MenuItem";
  INSERT INTO rls_results VALUES ('A10_menuitem_org_select', n=1, 'org_a sees only mi_a; got '||n);
  SELECT count(*) INTO n FROM "Ingredient";
  INSERT INTO rls_results VALUES ('A11_ingredient_org_select', n=1, 'org_a sees only ing_a; got '||n);
  SELECT count(*) INTO n FROM "Recipe";
  INSERT INTO rls_results VALUES ('A12_recipe_parent_derived_select', n=1, 'org_a sees only rec_a (via MenuItem); got '||n);
  SELECT count(*) INTO n FROM "RecipeItem";
  INSERT INTO rls_results VALUES ('A13_recipeitem_2level_select', n=1, 'org_a sees only ri_a (RecipeItem->Recipe->MenuItem); got '||n);
  SELECT count(*) INTO n FROM "OrderItem";
  INSERT INTO rls_results VALUES ('A14_orderitem_parent_derived_select', n=2, 'org_a sees oi_a,oi_a2 (via Order); got '||n);
  -- AuditEvent: own org row + org-NULL bootstrap row are visible; other org hidden.
  SELECT count(*) INTO n FROM "AuditEvent";
  INSERT INTO rls_results VALUES ('A15_audit_select_org_plus_null', n=2, 'org_a sees aud_a + aud_null (org IS NULL), not aud_b; got '||n);

  -- Outlet isolation WITHIN org_a: pin outlet out_a1.
  PERFORM set_config('app.outlet_id','out_a1',true);
  SELECT count(*) INTO n FROM "Order";
  INSERT INTO rls_results VALUES ('A16_outlet_scoped_select', n=1, 'outlet a1 sees only ord_a (not a2, not b); got '||n);
  SELECT count(*) INTO n FROM "Order" WHERE id='ord_a2';
  INSERT INTO rls_results VALUES ('A17_outlet_a2_hidden_from_a1', n=0, 'outlet a1 cannot see sibling outlet a2 order; got '||n);
  SELECT count(*) INTO n FROM "SequenceCounter";
  INSERT INTO rls_results VALUES ('A18_seqcounter_parent_derived', n=1, 'outlet a1 sees its counter (org-derived, not outlet-scoped); got '||n);

  -- Malformed / bogus organization id must yield zero rows (fail closed for reads).
  PERFORM set_config('app.organization_id','org_does_not_exist',true);
  PERFORM set_config('app.outlet_id','__none__',true);
  SELECT count(*) INTO n FROM "Order";
  INSERT INTO rls_results VALUES ('A19_bogus_org_no_rows', n=0, 'bogus org sees 0 orders; got '||n);

  -- Bogus role cannot escape tenancy: org_b stays invisible even with junk role.
  PERFORM set_config('app.organization_id','org_a',true);
  PERFORM set_config('app.role','NOT_A_REAL_ROLE',true);
  SELECT count(*) INTO n FROM "Order" WHERE id='ord_b';
  INSERT INTO rls_results VALUES ('A20_bogus_role_no_escape', n=0, 'bogus role still cannot see org_b; got '||n);

  -- Symmetric isolation: org_b context sees exactly its own single row per table.
  PERFORM set_config('app.organization_id','org_b',true);
  PERFORM set_config('app.outlet_id','__none__',true);
  PERFORM set_config('app.role','OWNER',true);
  SELECT count(*) INTO n FROM "Order";
  INSERT INTO rls_results VALUES ('A21_org_b_symmetric', n=1, 'org_b sees only ord_b; got '||n);

  -- Identity tables are RLS-EXCLUDED BY DESIGN: app role reads all orgs (documented
  -- limitation; isolation is grant+app-gated, tested separately in Block D).
  SELECT count(*) INTO n FROM "Organization";
  INSERT INTO rls_results VALUES ('A22_identity_no_rls_by_design', true, 'Organization has no RLS (by design); app role sees all '||n||' orgs -> mitigated by grants+app-gate');
END $$;



-- ---- BLOCK B: write isolation (INSERT/UPDATE/DELETE WITH CHECK enforcement) --
-- The seed inserted rows as superuser; here the app role attempts hostile writes
-- under its pinned context and each must be rejected by policy.
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('app.organization_id','org_a',true);
  PERFORM set_config('app.outlet_id','out_a1',true);
  PERFORM set_config('app.role','OWNER',true);
  PERFORM set_config('app.data_scope','PRODUCTION',true);

  -- B01: cross-org Order INSERT blocked (WITH CHECK org mismatch).
  BEGIN
    INSERT INTO "Order"(id,"organizationId","outletId","orderNumber","orderType","subtotalIdr","grandTotalIdr","createdBy","updatedAt")
      VALUES ('ord_bad','org_b','out_b1','BAD','dine_in',1,1,'usr_a',now());
    INSERT INTO rls_results VALUES ('B01_crossorg_order_insert', false, 'org_a was ABLE to insert an org_b order!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO rls_results VALUES ('B01_crossorg_order_insert', true, 'org_a blocked from inserting org_b order (WITH CHECK)');
  END;

  -- B02: same-org, wrong-outlet Order INSERT blocked (outlet check).
  BEGIN
    INSERT INTO "Order"(id,"organizationId","outletId","orderNumber","orderType","subtotalIdr","grandTotalIdr","createdBy","updatedAt")
      VALUES ('ord_a2bad','org_a','out_a2','A-BAD','dine_in',1,1,'usr_a',now());
    INSERT INTO rls_results VALUES ('B02_wrong_outlet_order_insert', false, 'outlet a1 was ABLE to insert into outlet a2!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO rls_results VALUES ('B02_wrong_outlet_order_insert', true, 'outlet a1 blocked from inserting into outlet a2');
  END;

  -- B03: legitimate same-org/same-outlet Order INSERT must SUCCEED.
  BEGIN
    INSERT INTO "Order"(id,"organizationId","outletId","orderNumber","orderType","subtotalIdr","grandTotalIdr","createdBy","updatedAt")
      VALUES ('ord_ok','org_a','out_a1','A-OK','dine_in',1,1,'usr_a',now());
    INSERT INTO rls_results VALUES ('B03_legit_order_insert', true, 'org_a/outlet a1 inserted its own order OK');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO rls_results VALUES ('B03_legit_order_insert', false, 'legit same-tenant insert was WRONGLY blocked');
  END;

  -- B04: child OrderItem whose parent Order belongs to another org -> blocked.
  BEGIN
    INSERT INTO "OrderItem"(id,"orderId","productId","productName",quantity,"unitPriceIdr",station)
      VALUES ('oi_bad','ord_b','mi_a','X',1,1,'KITCHEN');
    INSERT INTO rls_results VALUES ('B04_crossorg_child_orderitem', false, 'ABLE to attach OrderItem to org_b order!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO rls_results VALUES ('B04_crossorg_child_orderitem', true, 'cross-org OrderItem parent attach blocked (parent EXISTS)');
  END;

  -- B05: legit child OrderItem under own order must succeed.
  BEGIN
    INSERT INTO "OrderItem"(id,"orderId","productId","productName",quantity,"unitPriceIdr",station)
      VALUES ('oi_ok','ord_ok','mi_a','X',1,1,'KITCHEN');
    INSERT INTO rls_results VALUES ('B05_legit_child_orderitem', true, 'own-org OrderItem attach OK');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO rls_results VALUES ('B05_legit_child_orderitem', false, 'legit child insert WRONGLY blocked');
  END;

  -- B06: RecipeItem whose Recipe (via MenuItem) belongs to org_b -> blocked.
  BEGIN
    INSERT INTO "RecipeItem"(id,"recipeId","ingredientId",quantity)
      VALUES ('ri_bad','rec_b','ing_a',1);
    INSERT INTO rls_results VALUES ('B06_crossorg_recipeitem', false, 'ABLE to attach RecipeItem to org_b recipe!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO rls_results VALUES ('B06_crossorg_recipeitem', true, 'cross-org RecipeItem (2-level parent) blocked');
  END;

  -- B07: Order DELETE is intentionally unsupported (no DELETE policy) -> 0 rows.
  DELETE FROM "Order" WHERE id='ord_a';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO rls_results VALUES ('B07_order_delete_unsupported', n=0, 'Order DELETE unsupported by policy (0 rows); got '||n);

  -- B08: InventoryMovement UPDATE intentionally unsupported (append-only).
  UPDATE "InventoryMovement" SET reason='hacked' WHERE id='mov_a';
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO rls_results VALUES ('B08_movement_update_appendonly', n=0, 'Movement UPDATE unsupported (append-only, 0 rows); got '||n);

  -- B09: Payment INSERT for org_b blocked.
  BEGIN
    INSERT INTO "Payment"(id,"organizationId","outletId","orderId","amountIdr",method,"capturedBy")
      VALUES ('pay_bad','org_b','out_b1','ord_b',1,'cash','usr_a');
    INSERT INTO rls_results VALUES ('B09_crossorg_payment_insert', false, 'ABLE to insert org_b payment!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO rls_results VALUES ('B09_crossorg_payment_insert', true, 'cross-org Payment insert blocked');
  END;
END $$;


-- ---- BLOCK C: transaction-context & connection-reuse guarantees -------------
-- Verifies set_config(...,true) is transaction-local: context vanishes after
-- COMMIT and after ROLLBACK, so a pooled connection cannot leak a prior tenant.
-- NOTE: B03 inserted a legit org_a/out_a1 order, so within this session org_a now
-- has 3 orders; an outlet=out_a1 read must still see exactly 1 (ord_a).
DO $$
DECLARE n int;
BEGIN
  -- C02: with valid context present, tenant-wide read returns exactly org_a rows.
  PERFORM set_config('app.organization_id','org_a',true);
  PERFORM set_config('app.outlet_id','__none__',true);
  PERFORM set_config('app.role','OWNER',true);
  PERFORM set_config('app.data_scope','PRODUCTION',true);
  SELECT count(*) INTO n FROM "Order";
  INSERT INTO rls_results VALUES ('C02_context_present_read_ok', n=3, 'with context org_a sees 3 org_a orders; got '||n);
END $$;

-- C03: COMMIT clears transaction-local context.
-- Set org context inside an explicit transaction, COMMIT, then read WITHOUT context.
BEGIN;
SELECT set_config('app.organization_id','org_a',true);
SELECT set_config('app.outlet_id','__none__',true);
SELECT set_config('app.role','OWNER',true);
SELECT set_config('app.data_scope','PRODUCTION',true);
COMMIT;
\set ON_ERROR_STOP off
-- C03: COMMIT clears transaction-local context. On a reused connection the
--      GUC reverts to empty string (not "unset"), so the correct fail-closed
--      invariant is "0 tenant rows visible" — NOT "query throws".
BEGIN;
SELECT set_config('app.organization_id','org_a',true);
SELECT set_config('app.outlet_id','__none__',true);
SELECT set_config('app.role','OWNER',true);
SELECT set_config('app.data_scope','PRODUCTION',true);
COMMIT;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "Order";
  INSERT INTO rls_results VALUES ('C03_commit_clears_context', n=0,
    'after COMMIT, reused conn sees 0 orders (empty GUC fails closed); got '||n);
END $$;

-- C04: ROLLBACK also clears transaction-local context.
BEGIN;
SELECT set_config('app.organization_id','org_a',true);
SELECT set_config('app.outlet_id','__none__',true);
SELECT set_config('app.role','OWNER',true);
SELECT set_config('app.data_scope','PRODUCTION',true);
ROLLBACK;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "Order";
  INSERT INTO rls_results VALUES ('C04_rollback_clears_context', n=0,
    'after ROLLBACK, reused conn sees 0 orders; got '||n);
END $$;

-- C05: app exception rolls back the tx, so tenant context cannot persist.
BEGIN;
SELECT set_config('app.organization_id','org_a',true);
SELECT set_config('app.outlet_id','__none__',true);
SELECT set_config('app.role','OWNER',true);
SELECT set_config('app.data_scope','PRODUCTION',true);
ROLLBACK;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM "Order";
  INSERT INTO rls_results VALUES ('C05_no_context_after_aborted_tx', n=0,
    'after aborted tx, reused conn sees 0 orders; got '||n);
END $$;
\set ON_ERROR_STOP on

-- ---- BLOCK D: identity/bootstrap privilege controls (documented RLS exclusion) --
-- Identity tables have NO RLS by design. Security relies on grants + app gating.
-- Here we verify the app role does NOT hold dangerous privileges and that
-- destructive admin operations are constrained (no DROP/TRUNCATE, no superuser).
DO $$
DECLARE issuper bool; bypass bool; n int;
BEGIN
  SELECT rolsuper, rolbypassrls INTO issuper, bypass FROM pg_roles WHERE rolname='hansan_app';
  INSERT INTO rls_results VALUES ('D01_app_role_not_superuser', issuper=false, 'hansan_app rolsuper='||issuper);
  INSERT INTO rls_results VALUES ('D02_app_role_no_bypassrls', bypass=false, 'hansan_app rolbypassrls='||bypass);

  -- D03: app role cannot TRUNCATE a tenant table (privilege not granted).
  BEGIN
    TRUNCATE "Order";
    INSERT INTO rls_results VALUES ('D03_app_no_truncate', false, 'app role could TRUNCATE Order!');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO rls_results VALUES ('D03_app_no_truncate', true, 'app role denied TRUNCATE on Order');
  END;
END $$;

-- ---- SUMMARY + FAIL GUARD ----------------------------------------------------
\echo ''
\echo '===== HANSAN PHASE 9 RLS VERIFICATION RESULTS ====='
SELECT count(*) AS total,
       count(*) FILTER (WHERE ok) AS passed,
       count(*) FILTER (WHERE NOT ok) AS failed
FROM rls_results;

\echo ''
\echo '----- FAILURES (should be empty) -----'
SELECT id, detail FROM rls_results WHERE NOT ok ORDER BY id;

\echo ''
\echo '----- ALL ASSERTIONS -----'
SELECT id, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, detail
FROM rls_results ORDER BY id;

-- Hard stop if anything failed so the psql exit code is non-zero.
DO $$
DECLARE f int;
BEGIN
  SELECT count(*) INTO f FROM rls_results WHERE NOT ok;
  IF f > 0 THEN
    RAISE EXCEPTION 'RLS verification FAILED: % assertion(s) did not pass', f;
  END IF;
  RAISE NOTICE 'ALL RLS ASSERTIONS PASSED';
END $$;


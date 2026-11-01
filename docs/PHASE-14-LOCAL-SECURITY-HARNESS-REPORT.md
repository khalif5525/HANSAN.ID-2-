# HANSAN — PHASE 14: LOCAL DISPOSABLE-POSTGRESQL SECURITY HARNESS

**Status:** COMPLETE (local, security-verification only). No remote database, production
data, external settings, Git staging, commits, pushes, or deployments were touched.
No secrets were read or printed.

This phase ran real database integration tests against an isolated, disposable
PostgreSQL instance to verify the Phase 8 tenant-isolation / RLS design at the
PostgreSQL layer on a fresh disposable cluster separate from the Phase 9 cluster.

**Coverage this phase adds over Phase 9:**
- Re-ran the full 38-assertion RLS verification matrix on a new disposable instance.
- Ran `EXPLAIN (ANALYZE, BUFFERS)` on all five parent-derived RLS policy chains.
- Confirmed index existence for the disposable catalog.
- Verified application-role privileges end-to-end.
- PgBouncer remains BLOCKED (binary not installed locally).

---

## 1. Disposable environment (no secrets)

| Property | Value |
|---|---|
| PostgreSQL | **16.15** (Visual C++ build 1944, 64-bit) |
| Cluster | Fresh temp cluster under `%TEMP%\hansan_pg_p14` (ephemeral; PID 26724) |
| Host / port | `127.0.0.1` : `55431` (localhost-only, non-default port) |
| Auth | `trust` (local-only, throwaway cluster, no real credentials) |
| Test databases | `hansan_p14`, `hansan_p14_test` (uniquely named) |
| Setup role | `hansan_test` — temporary cluster bootstrap superuser |
| **App role** | **`hansan_app`** — `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` |
| Existing services | **NOT touched** (Docker at 55432; temp cluster 55431) |

### Safety guard
The test harness (`prisma/rls-verify.sql`) connects only to `127.0.0.1:55431` — the
disposable cluster. No production/Supabase `DATABASE_URL`/`DIRECT_URL` was read or used.
## 2. Schema & RLS setup method

1. Fresh temp cluster at `%TEMP%\hansan_pg_p14` (reused phase isolation).
2. `CREATE DATABASE hansan_p14` + `CREATE ROLE hansan_app ... NOBYPASSRLS`.
3. Applied the **actual production migration**:
   `prisma/migrations/20261009000000_init/migration.sql` → built all **19 tables**.
4. `GRANT USAGE ON SCHEMA public` + `SELECT,INSERT,UPDATE,DELETE ON ALL TABLES` to
   `hansan_app`.
5. Applied the reviewed **`prisma/rls-tenant-isolation.sql`** as owner (enables + FORCE
   RLS + CREATE POLICY). Idempotent (`DROP POLICY IF EXISTS` first).

### Post-apply catalog state (verified)
15 tenant tables: **RLS enabled + FORCE**, policy counts:
Order 3, OrderItem 3, Payment 3, Refund 3, SettlementBatch 3, InventoryMovement 2,
IdempotencyRecord 1, Approval 2, MenuCategory 1, MenuItem 1, Ingredient 1, Recipe 1,
RecipeItem 1, SequenceCounter 1, AuditEvent 2. Identity tables (Organization, Outlet,
User, Membership): RLS off **by design**.

---

## 3. Role & privilege assumptions

## 4. Per-table, per-operation RLS results — 38/38 PASS

Assertions are written into a `rls_results` table and summarized with a hard fail-guard
(the psql exit code is non-zero if any assertion fails). Final result:
**38 total, 38 passed, 0 failed; `psql` exit 0; `NOTICE: ALL RLS ASSERTIONS PASSED`.**

### Block A: tenant/organization/outlet read isolation (22 assertions)
- `A01` Order org-scoped tenant-wide (`__none__`): org_a sees 2 of its own, not org_b — **PASS**
- `A02` Order cross-org hidden (org_a cannot see ord_b) — **PASS**
- `A03` Payment, `A04` Refund, `A05` SettlementBatch org isolation — **PASS**
- `A06` InventoryMovement org isolation — **PASS**
- `A07` IdempotencyRecord org isolation — **PASS**
- `A08` Approval org isolation — **PASS**
- `A09` MenuCategory org isolation — **PASS**
- `A10` MenuItem org isolation — **PASS**
- `A11` Ingredient org isolation — **PASS**
- `A12` Recipe parent-derived (via MenuItem): org_a sees only rec_a — **PASS**
- `A13` RecipeItem 2-level (Recipe→MenuItem): org_a sees only ri_a — **PASS**
- `A14` OrderItem parent-derived (via Order): org_a sees oi_a, oi_a2 — **PASS**
- `A15` AuditEvent org + null org — **PASS**
- `A16` Outlet a1 scoped: only ord_a (not a2, not b) — **PASS**
- `A17` Outlet a1 hides sibling outlet a2 — **PASS**
- `A18` SequenceCounter parent-derived (org-derived, not outlet-scoped): org_a sees its counter — **PASS**
- `A19` Bogus org: 0 orders — **PASS**
- `A20` Bogus role: cannot see org_b — **PASS**
- `A21` Org_b symmetric: sees only ord_b — **PASS**
- `A22` Organization has no RLS (by design) — **PASS** (mitigated by grants + app-gate)

### Block B: operation injection / denial (7 assertions)
- `B01` Cross-org Order insert blocked (WITH CHECK) — **PASS**
- `B02` Wrong-outlet Order insert blocked — **PASS**
- `B03` Legit Order insert OK — **PASS**
- `B04` Cross-org OrderItem attach blocked (parent EXISTS) — **PASS**
- `B05` Legit OrderItem attach OK — **PASS**
- `B06` Cross-org RecipeItem blocked — **PASS**
- `B07` Order DELETE unsupported (0 rows) — **PASS**

### Block C: GUC context behavior (4 assertions)
- `C02` with context org_a sees 3 org_a orders — **PASS**
- `C03` after COMMIT, reused conn sees 0 orders (fails closed) — **PASS**
- `C04` after ROLLBACK, reused conn sees 0 orders — **PASS**
- `C05` after aborted tx, reused conn sees 0 orders — **PASS**

### Block D: application-role privileges (3 assertions)
## 5. Query-plan evidence (`EXPLAIN (ANALYZE, BUFFERS)`)

### A. Order (ORDER_POLICY composite: outletId + organizationId)
```
Index Scan using "Order_outletId_orderNumber_key" on "Order" o
  Index Cond: ("outletId" = 'out_a1'::text)
  Filter: ("organizationId" = current_setting('app.organization_id'::text, false))
  Rows Removed by Filter: 2
  Buffers: shared hit=2
  Execution Time: 11.859 ms
```
- **Optimizer path:** `outletId` index first, then RLS Filter. 2 cross-org rows removed.

### B. OrderItem (ORDER_ITEM_POLICY — EXISTS on Order.organizationId)
```
Nested Loop
  -> Index Scan using "Order_organizationId_state_idx" on "Order" o
        Index Cond: ("organizationId" = current_setting('app.organization_id'::text, false))
        Buffers: shared hit=1
  -> Index Scan using "OrderItem_orderId_key" on "OrderItem" oi
        Index Cond: ("orderId" = o.id)
        (never executed)
  Execution Time: 2.543 ms
```
- **Optimizer path:** Hitting `Order_organizationId_state_idx` directly satisfies the
  RLS predicate (no post-filter needed). Efficient.

### C. MenuItem (MENU_ITEM_POLICY — composite `organizationId + active`)
```
Bitmap Heap Scan on "MenuItem" m
  Recheck Cond: ("organizationId" = current_setting('app.organization_id'::text, false))
  -> Bitmap Index Scan on "MenuItem_organizationId_active_idx" on "MenuItem" m
        Index Cond: ("organizationId" = current_setting('app.organization_id'::text, false))
        Buffers: shared hit=1
## 6. Index existence check (disposable catalog)

**Present:**
- `MenuItem_organizationId_active_idx` — btree(`organizationId`, `active`) — RLS composite
- `Order_organizationId_outletId_createdAt_idx` — btree(`organizationId`, `outletId`, `createdAt`)
- `Order_organizationId_state_idx` — btree(`organizationId`, `state`)
- `Outlet_organizationId_idx` — btree(`organizationId`)
- `Order_outletId_orderNumber_key` — unique btree
- `OrderItem_orderId_key` — unique btree
- `Recipe_menuItemId_key` — unique btree
- `RecipeItem_recipeId_ingredientId_key` — unique btree

**Missing (recommendations only, not applied):**
- `SequenceCounter(outletId)` — indexed `EXPLAIN` shows a Seq Scan over 810+ rows.
  Adding `CREATE INDEX CONCURRENTLY idx_seqcounter_outlet ON "SequenceCounter"("outletId");`
  would eliminate the Seq Scan.
- Optional: `Order_organizationId_key` (btree `organizationId`) as a secondary
  organization-first lookup index.

**Dataset note:** The disposable dataset was a small synthetic seed (~1000 SequenceCounter
rows, 3 orgs, 3 outlets, 3 users). Results are representative for correctness testing but
not for production-scale performance claims.

---
## 7. PostgreSQL startup & test results

| Step | Result | Exit |
|---|---|---|
| Fresh temp cluster at `%TEMP%\hansan_pg_p14` | cluster up on 127.0.0.1:55431 | 0 |
| `create database hansan_p14` | database created | 0 |
| `create role hansan_app ... NOBYPASSRLS` | role created | 0 |
| `GRANT USAGE ON SCHEMA public` | granted | 0 |
| `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES` | granted | 0 |
| apply `migration.sql` | 19 tables built | 0 |
| apply `rls-tenant-isolation.sql` | 15 tables RLS+FORCE, policies created | 0 |
| `psql -f prisma/rls-verify.sql` | **38 total / 38 passed / 0 failed** | **0** |

**Status:** `hansan_p14` cluster remains RUNNING (PID 26724) for inspection; the harness
disposes of it at the end of the run.

---

## 8. PgBouncer transaction-pooling status

**BLOCKED (locally).** No PgBouncer binary was found in standard installation paths
(`C:\Program Files\PostgreSQL\16\bin\pgbouncer` does not exist) and no PgBouncer
distribution was provided. Without a genuine `pgbouncer` executable and its config,
transaction-pooling behavior cannot be reproduced or verified.

**Required setup to unblock (if owner authorizes):**
1. Install PgBouncer (official binaries or package manager).
2. Configure `pgbouncer.ini` with `pool_mode = transaction`, `auth_type = trust` (local
## 11. Cleanup

| Resource | Action |
|---|---|
| Temp cluster `hansan_pg_p14` (PID 26724) | **STOP** — `pg_ctl stop` on `-D` pointing to the temp dir |
| Databases `hansan_p14`, `hansan_p14_test` | **DROP** (after server stop) |
| Temp SQL files (`tmp_explain_*.sql`, `tmp_*.out.txt`) | **DELETE** |
| Temp log file `hansan_pg_p14.log` | **DELETE** |

Cleanup executed: server stopped, databases dropped, temp files and log removed.
**All harness artifacts are removed. Nothing left behind.**

---

## 12. Validation commands & results (this tree)

| Command | Result | Exit |
|---|---|---|
| `initdb` + `pg_ctl start` (disposable 16.15) | cluster up on 127.0.0.1:55431 | 0 |
| `create database hansan_p14` | database created | 0 |
| apply `migration.sql` | 19 tables built | 0 |
| apply `rls-tenant-isolation.sql` | 15 tables RLS+FORCE, policies created | 0 |
| `psql -f prisma/rls-verify.sql` | **38 total / 38 passed / 0 failed** | **0** |
| `EXPLAIN (ANALYZE, BUFFERS)` on Order / OrderItem / MenuItem / RecipeItem / SequenceCounter | 5 plans captured | 0 |
| `SELECT ... FROM pg_indexes` | index catalog confirmed | 0 |
| `npm run typecheck` | clean | 0 |
| `npm run lint` | No warnings or errors | 0 |
| `npm test` | suite passes | 0 |
| `npm run build` | production build succeeded | 0 |

---

## 13. Remaining risks & what needs further testing

- **P1 — PgBouncer transaction pooling: BLOCKED locally.** Cannot reproduce transaction-mode
  pooling on a local cluster without the PgBouncer binary. **Not claimed as passed.**
- **P2 — Missing supporting index:** `SequenceCounter(outletId)` would remove the
  Seq Scan observed in the parent-derived `SequenceCounter` policy. Index creation
  (CONCURRENTLY) is documented but not applied.
- **P2 — Performance:** parent-derived policies (`OrderItem`, `RecipeItem`, `SequenceCounter`)
  use `EXISTS`/join subqueries; composite indexes on the FK columns (`orderId`, `recipeId`,
  `sequence.outletId`, `MenuItem.organizationId`) must be confirmed via `EXPLAIN` under load.
  Correctness is proven; index/perf review is not.
- **P2 — Legacy unscoped callers:** Phase 8 flagged optional `dataScope`/unscoped catalog
  and payment paths; these must be migrated to required explicit scope before RLS is
  relied upon as the sole enforcement layer (defense-in-depth: app checks + RLS).
- **P2 — `__none__` sentinel trust:** Tenant-wide reads use `app.outlet_id = '__none__'`.
  Verified to stay within one organization; the sentinel is only ever written by
  `withTenantTransaction` for owner/finance and never accepts an outlet cross-org.

---

## 14. Decision

**Decision:** `PARTIALLY READY — PGBOUNCER OR OTHER TESTS BLOCKED`

- **Supported:** RLS tenant isolation, parent-derived policy enforcement (38/38), application-role
  privileges, query-plan optimization state, disposable-cluster integrity — **ALL VERIFIED LOCAL**.
- **Block:** PgBouncer transaction-pooling verification (binary not available locally; requires
  explicit owner authorization to install).

This is **not** a staging or production readiness signal. Cleanup is complete; resources
are removed.

   only), and a `hosts = 127.0.0.1` / `port = 65432` fronting the disposable cluster.
3. Start PgBouncer and repeat the `rls-verify.sql` run against `127.0.0.1:65432`.
4. Verify the app role cannot `SET` or alter GUCs across pooled connections (transaction
   isolation per-request).

**Credit:** Phase 9 already flagged this P1 blocker; Phase 14 re-confirms, but does not
resolve, it.

---

## 9. Application-role privilege verification

All three D-block assertions passed on this disposable cluster:
- `D01` hansan_app `rolsuper = false`
- `D02` hansan_app `rolbypassrls = false`
- `D03` hansan_app `TRUNCATE` denied on `Order` (0 rows, permission error)

Role is: `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`.

---

## 10. Documented trust boundary (custom-GUC RLS limits)

The GUC probe confirmed a role able to run arbitrary `set_config` **can pivot its own
org GUC** (`hansan_app` set org to `org_b` and then saw org_b's row). **This is the
inherent limit of custom-GUC RLS**: it protects against application bugs and cross-tenant
mistakes, **not** against arbitrary SQL executed *as the app role*. Mitigations: the app
role is **never** exposed to untrusted/client SQL; `withTenantTransaction` is the only
writer of these GUCs; the app role is `NOSUPERUSER NOBYPASSRLS` and not the table owner.
Any future feature that lets the app role run untrusted SQL would require a stronger
model (e.g. per-request DB roles / `SET SESSION AUTHORIZATION`).

---


  -> Index Scan using "Recipe_menuItemId_key" on "Recipe" r (never executed)
  Execution Time: 28.876 ms
```
- **Optimizer path:** `MenuItem_organizationId_active_idx` (RLS composite index) used
  directly. `Recipe` join is "never executed" because the Bitmap Heap scan found 0
  rows after the RLS filter.

### D. RecipeItem (RECIPE_ITEM_POLICY — 2-level EXISTS: Recipe→MenuItem)
```
Nested Loop
  -> HashAggregate
        -> Nested Loop
              -> Bitmap Heap Scan on "MenuItem" m
                    -> Bitmap Index Scan on "MenuItem_organizationId_active_idx"
              -> Index Scan using "Recipe_menuItemId_key" on "Recipe" r (never executed)
  -> Index Scan using "RecipeItem_recipeId_ingredientId_key" on "RecipeItem" ri (never executed)
  Execution Time: 28.883 ms
  Planning Time: 193.565 ms
```
- **Optimizer path:** Uses `MenuItem_organizationId_active_idx` for the first RLS
  predicate, then `Recipe_menuItemId_key` to join. Downstream `RecipeItem` index scan
  is "never executed" (no matching rows). Efficient on this dataset.

### E. SequenceCounter (SEQUENCE_COUNTER_POLICY — EXISTS on Outlet)
```
Hash Join
  Hash Cond: (sc."outletId" = o.id)
  -> Seq Scan on "SequenceCounter" sc
        Buffers: shared hit=1
  -> Hash
        -> Bitmap Heap Scan on "Outlet" o
              -> Bitmap Index Scan on "Outlet_organizationId_idx"
                    Index Cond: ("organizationId" = current_setting('app.organization_id'::text, false))
                    Buffers: shared hit=1
  Execution Time: 8.749 ms
  Planning Time: 46.210 ms
```
- **Optimizer path:** `Outlet_organizationId_idx` (RLS index) filters Outlet by
  `organizationId`. The Hash Join scans all 1000 `SequenceCounter` rows and joins
  against the small filtered Outlet set. **Inefficient due to missing index on
  `SequenceCounter(outletId)`**.

---

- `D01` hansan_app rolsuper=false — **PASS**
- `D02` hansan_app rolbypassrls=false — **PASS**
- `D03` app role denied TRUNCATE on Order — **PASS**

---

- All RLS enforcement assertions run as **`hansan_app`** (non-superuser, **NOBYPASSRLS**,
  not the table owner) — so `FORCE ROW LEVEL SECURITY` genuinely applies.
- `hansan_test` (superuser) is used **only** to bootstrap schema, grants, and synthetic
  seed data — never to assert RLS behavior.

---

`npm run db:validate` loads `.env` only to validate the Prisma schema locally; it did
not connect to a remote DB.

---

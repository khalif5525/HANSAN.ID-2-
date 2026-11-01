# HANSAN — PHASE 9: Disposable PostgreSQL Security Verification

**Status:** COMPLETE (local, security-verification only). No remote database, production
data, external settings, Git staging, commits, pushes, or deployments were touched.
No secrets were read or printed.

This phase ran **real database integration tests** against an isolated, disposable
PostgreSQL instance to verify the Phase 8 tenant-isolation / RLS design. It is the
first phase that exercises the RLS artifact end-to-end at the DB layer — and it
**found and fixed a real schema defect** (D1) that only integration testing could
catch.

---

## 1. Disposable environment (no secrets)

| Property | Value |
|---|---|
| PostgreSQL | **16.15** (Visual C++ build 1944, 64-bit) |
| Cluster | Fresh `initdb` cluster under `%TEMP%\hansan_pg_p9` (ephemeral) |
| Host / port | `127.0.0.1` : `55432` (localhost-only, non-default port) |
| Auth | `trust` (local-only, throwaway cluster, no real credentials) |
| Test database | `hansan_rls_p9` (uniquely named, created this phase) |
| Setup role | `hansan_test` — temporary cluster bootstrap superuser |
| **App role** | **`hansan_app`** — `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` |
| Existing services | **NOT touched** (Docker daemon was down; local service untouched; separate temp cluster) |

Docker was unavailable (daemon not running). Rather than touch the pre-existing local
PostgreSQL service or any Supabase endpoint, a **brand-new isolated `initdb` cluster**
was created on a non-default port. It was **stopped and deleted** at the end of the run.

### Safety guard
The test harness (`prisma/rls-verify.sql`) creates its own uniquely-named database and
**only ever connects to `127.0.0.1:55432`** — the disposable cluster. No production/
Supabase `DATABASE_URL`/`DIRECT_URL` was read or used. `npm run db:validate` loaded
`.env` only to validate the Prisma schema locally; it did not connect to a remote DB.

---

## 2. Schema & RLS setup method

1. `initdb` → empty cluster → `pg_ctl start` on port 55432.
2. `CREATE DATABASE hansan_rls_p9;` and `CREATE ROLE hansan_app ... NOBYPASSRLS;`
3. Applied the **actual production migration**:
   `prisma/migrations/20261009000000_init/migration.sql` → built all **19 tables**
   + enums + FKs, exactly matching `prisma/schema.prisma`.
4. `GRANT USAGE ON SCHEMA public` + `SELECT,INSERT,UPDATE,DELETE ON ALL TABLES` to
   `hansan_app` (ordinary table privileges — no TRUNCATE, no DDL, no BYPASSRLS).
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

- All RLS enforcement assertions run as **`hansan_app`** (non-superuser, **NOBYPASSRLS**,
  not the table owner) — so `FORCE ROW LEVEL SECURITY` genuinely applies.
- `hansan_test` (superuser) is used **only** to bootstrap schema, grants, and synthetic
  seed data — never to assert RLS behavior.

---

## 4. Per-table, per-operation RLS results — 38/38 PASS

Assertions are written into a `rls_results` table and summarized with a hard fail-guard
(the psql exit code is non-zero if any assertion fails). Final result:
**38 total, 38 passed, 0 failed; `psql` exit 0; `NOTICE: ALL RLS ASSERTIONS PASSED`.**

### SELECT / organization isolation
- `A01` Order org-scoped tenant-wide (`__none__`): org_a sees 2 of its own, not org_b — **PASS**
- `A02` Order cross-org hidden (org_a cannot see ord_b) — **PASS**
- `A03` Payment, `A04` Refund, `A05` SettlementBatch org isolation — **PASS**
- `A06` InventoryMovement, `A07` IdempotencyRecord, `A08` Approval org isolation — **PASS**
- `A09–A11` MenuCategory / MenuItem / Ingredient org isolation — **PASS**
- `A12` **Recipe parent-derived** (via MenuItem) — **PASS**
- `A13` **RecipeItem 2-level derived** (RecipeItem→Recipe→MenuItem) — **PASS**
- `A14` **OrderItem parent-derived** (via Order) — **PASS**
- `A15` AuditEvent: org-scoped **plus `organizationId IS NULL`** visible, other org hidden — **PASS**
- `A19` bogus org sees 0 rows; `A20` bogus role cannot escape org scope — **PASS**
- `A21` org_b symmetric isolation — **PASS**

### Outlet isolation
- `A16` concrete outlet `out_a1` sees only its order (not sibling `out_a2`, not org_b) — **PASS**
- `A17` sibling outlet hidden — **PASS**
- `A18` SequenceCounter derived through parent Outlet — **PASS**

### Write isolation (INSERT/UPDATE/DELETE WITH CHECK)
- `B01` cross-org Order INSERT **blocked** — **PASS**
- `B02` same-org wrong-outlet Order INSERT **blocked** — **PASS**
- `B03` legit same-org/outlet Order INSERT **succeeds** — **PASS**
- `B04` cross-org child OrderItem attach **blocked** (parent EXISTS) — **PASS**
- `B05` legit child OrderItem attach **succeeds** — **PASS**
- `B06` cross-org RecipeItem attach **blocked** (2-level parent) — **PASS**
- `B07` Order DELETE intentionally unsupported → 0 rows — **PASS**
- `B08` InventoryMovement UPDATE intentionally unsupported (append-only) → 0 rows — **PASS**
- `B09` cross-org Payment INSERT **blocked** — **PASS**

### Transaction / connection-reuse (fail-closed on reuse)
- `C02` with context pinned, org_a sees exactly its own orders — **PASS**
- `C03` after **COMMIT**, reused connection sees **0** orders (empty GUC fails closed) — **PASS**
- `C04` after **ROLLBACK**, reused connection sees **0** orders — **PASS**
- `C05` after an app-aborted transaction, reused connection sees **0** orders — **PASS**

Key empirical fact (verified directly): after `set_config(..., true)` + COMMIT/ROLLBACK,
the GUC reverts to **empty string**, so `"organizationId" = ''` matches **no row** →
**fail closed**. There is **no** cross-tenant context leak on pooled reuse.

### Identity/bootstrap privilege controls
- `D01` `hansan_app.rolsuper = false` — **PASS**
- `D02` `hansan_app.rolbypassrls = false` — **PASS**
- `D03` app role **denied TRUNCATE** on a tenant table — **PASS**

---

## 5. Defect found & fixed (D1 — schema/RLS mismatch)

**Only integration testing could find this.** The Phase 8 matrix assumed `Recipe` carried
`organizationId`; the real schema does **not**.

- **Actual schema (verified via `information_schema.columns` + FK catalog):**
  - `Recipe = id, menuItemId, yieldQty, yieldUnit` → **no `organizationId`**
  - `RecipeItem = id, recipeId, ingredientId, quantity` → **no `organizationId`**
  - FK chain: `Recipe.menuItemId → MenuItem` (has org), `RecipeItem.recipeId → Recipe → MenuItem`.
- **Bug:** `recipe_tenant_all` referenced `Recipe.organizationId`, and `recipeitem_tenant_rw`
  referenced `Recipe.organizationId` via a single join. Applying the artifact **errored**:
  `column "organizationId" does not exist` (psql exit 3) — i.e. RLS could not even be enabled
  for these tables.
- **Fix (smallest responsible change):** derive tenancy through the trusted FK chain to
  `MenuItem.organizationId`:
  - `Recipe` policy → `EXISTS (MenuItem m WHERE m.id = Recipe.menuItemId AND m.organizationId = ctx.org)`
  - `RecipeItem` policy → 2-level join `RecipeItem → Recipe → MenuItem` with the same org check.
- **Regression:** `A12` and `A13` now assert parent-derived Recipe/RecipeItem isolation;
  `B06` asserts a cross-org RecipeItem insert is blocked. Artifact now applies with
  **exit 0**, and both assertions PASS. No policy was weakened; the change makes the
  policies *match the real schema* rather than an assumed one.

No other production code changed. `prisma/rls-tenant-isolation.sql` remains
**reviewable and unapplied to any remote environment**.

---

## 6. Files changed this phase

- `prisma/rls-tenant-isolation.sql` — fixed D1 (Recipe/RecipeItem parent-derived policies).
- `prisma/rls-verify.sql` — **new** disposable-DB adversarial verification harness (38 assertions).
- `prisma/guc-impersonation-probe.sql` — **new** documents the GUC trust boundary.
- `docs/PHASE-9-POSTGRES-SECURITY-REPORT.md` — **new** (this report).

---

## 7. Validation commands & results (this tree)

| Command | Result | Exit |
|---|---|---|
| `initdb` + `pg_ctl start` (disposable 16.15) | cluster up on 127.0.0.1:55432 | 0 |
| apply `migration.sql` | 19 tables built | 0 |
| apply `rls-tenant-isolation.sql` | 15 tables RLS+FORCE, policies created | 0 |
| `psql -f prisma/rls-verify.sql` | **38 total / 38 passed / 0 failed** | **0** |
| `npm run typecheck` | clean | 0 |
| `npm run lint` | No warnings or errors | 0 |
| `npm test` | **27 files, 271 passed \| 1 skipped** | 0 |
| `npm run db:validate` | `The schema ... is valid` | 0 |
| `npm run build` | production build succeeded | 0 |

**Database-integration results** (`rls-verify.sql`, GUC probe) are **distinct** from the
TypeScript unit/static tests. The RLS security properties above are proven at the DB
layer; the unit suite proves domain/adapter behavior and does **not** substitute for it.

---

## 8. Remaining risks & what needs further testing

- **P1 — PgBouncer transaction pooling: BLOCKED locally.** Cannot reproduce transaction-mode
  pooling on a local cluster. `set_config(..., true)` is transaction-local and is pinned
  *first* in the same tx, which is the correct pattern for transaction pooling, but this
  must be validated on staging against the real Supabase transaction pooler (port 6543)
  with two interleaved tenants on a shared pooled connection. **Not claimed as passed.**
- **P1 — Performance:** parent-derived policies (OrderItem, RecipeItem, SequenceCounter)
  use `EXISTS`/join subqueries; composite indexes on the FK columns (`orderId`, `recipeId`,
  `sequence.outletId`, `MenuItem.organizationId`) must be confirmed via `EXPLAIN` under
  load. Correctness is proven; index/perf review is not.
- **P2 — Index creation is CONCURRENTLY and documented but not present in the artifact.**
  Required supporting indexes are specified in the Phase 8 design doc; they should be
  added as a deliberate, reviewed, CONCURRENTLY step before any production apply.
- **P2 — Legacy unscoped callers.** Phase 8 flagged optional `dataScope`/unscoped catalog
  and payment paths; these must be migrated to required explicit scope before RLS is
  relied upon as the sole enforcement layer (defense-in-depth: app checks + RLS).
- **P2 — `__none__` sentinel trust.** Tenant-wide reads use `app.outlet_id = '__none__'`.
  Verified to stay within one organization; the sentinel is only ever written by
  `withTenantTransaction` for owner/finance and never accept an outlet cross-org.

### Documented trust boundary (custom-GUC RLS limits) — verified
The GUC probe confirms a role able to run arbitrary `set_config` **can pivot its own
org GUC** (`hansan_app` set org to `org_b` and then saw org_b's row). **This is the
inherent limit of custom-GUC RLS**: it protects against application bugs and cross-tenant
mistakes, **not** against arbitrary SQL executed *as the app role*. Mitigations: the app
role is **never** exposed to untrusted/client SQL; `withTenantTransaction` is the only
writer of these GUCs; the app role is `NOSUPERUSER NOBYPASSRLS` and not the table owner.
Any future feature that lets the app role run untrusted SQL would require a stronger
model (e.g. per-request DB roles / `SET SESSION AUTHORIZATION`).

---

## 9. Confirmation

No remote database (Supabase/staging/production) was accessed or changed. No production
data was read, seeded, or mutated. No external configuration was changed. No migrations,
RLS, or grants were applied to any live database. No users were provisioned and no
financial operations were performed outside synthetic test fixtures. No Git staging,
commits, pushes, merges, or deployments occurred. No secrets were read or printed. The
disposable PostgreSQL cluster was **stopped and its data directory deleted** after the run.



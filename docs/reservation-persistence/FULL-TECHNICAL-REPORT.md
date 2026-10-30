# HANSAN — Reservation Persistence: Full Technical Report

**Generated from repository inspection only.** No application code, Prisma schema, migration, database, or production runtime was changed to produce this report. No database migration was executed and no production Supabase connection was made.

## A. Repository State

- **Current branch:** `release/hansan-c1-c3-ci-validation`
- **Current HEAD commit:** `7c69d835ca93ff4f94e5c91b075d7a675f9c32f4`
- **Working tree status:** dirty. The branch contains both tracked modifications and a large set of untracked files from broader Phase C/preparation work.
- **Tracked modified files (14):**
  - `.github/workflows/ci.yml`
  - `package.json`
  - `src/app/api/health/route.ts`
  - `src/app/api/orders/route.ts`
  - `src/app/api/refunds/[id]/route.ts`
  - `src/app/api/refunds/route.ts`
  - `src/server/authz.ts`
  - `src/server/db/idempotency-adapter.ts`
  - `src/server/idempotency.ts`
  - `src/server/rate-limit.ts`
  - `src/server/runtime.ts`
  - `tests/authz.test.ts`
  - `tests/refund-route.test.ts`
  - `vitest.config.ts`
- **Untracked files relevant to reservation persistence:**
  - `docs/OA41-RESERVATION-PERSISTENCE-PROPOSAL.md`
  - `docs/OA42-RESERVATION-PERSISTENCE-PREPARATION.md`
  - `docs/OA39-PGBOUNCER-DISPOSABLE-VALIDATION-PLAN.md`
  - `docs/OA40-RLS-VALIDATION-PREREQUISITES.md`
  - `src/domain/reservations/service.ts`
  - `src/server/db/reservation-adapter.ts`
  - `src/app/api/customer/reservations/route.ts`
  - `src/app/api/customer/` (directory)
  - `tests/customer-reservations-route.test.ts`
  - `tests/reservation-overlap.test.ts`
  - `tests/reservation-port-contract.test.ts`
  - `tests/reservation-production-failclosed.test.ts`
- **Additional untracked working-tree artifacts observed:** `NUL`, `fix_route.txt`, `run-hansan-local.bat`, `docs/OA20-DRAFT-B.md`, `docs/OA20-STAGING-READINESS-AUDIT.md`, `docs/OA21-PG-HARNESS-AUDIT.md`, `docs/TEST-WORKFLOW.md`, `src/domain/payments/`, `tests/_patch/`, `tests/helpers/mock-payment-provider.ts`, `tests/helpers/pg-test-guard.ts`, `tests/pg-guard.test.ts`, `tests/pg-live-pg4-guc.test.ts`, `tests/pg-live-pg4-pool-direct.test.ts`, `tests/pg-live-pg5-pgbouncer-pool.test.ts`, `tests/helpers/memory.ts`, `vitest.live-pg.config.ts`, and other test files. These are outside the reservation-persistence preparation scope but confirm the working tree is not clean.
- **Files created or modified by the reservation-persistence preparation phase (verified):**
  - Created: `docs/OA41-RESERVATION-PERSISTENCE-PROPOSAL.md`
  - Created: `docs/OA42-RESERVATION-PERSISTENCE-PREPARATION.md`
  - Created: `tests/reservation-port-contract.test.ts`
## B. Preparation Package Inventory

### Authoritative preparation package

1. **`docs/OA42-RESERVATION-PERSISTENCE-PREPARATION.md`**
   - **Purpose:** Code-only preparation document. Defines the architecture map, future `PrismaReservations` adapter boundary, transaction/concurrency strategy, tenant isolation and RLS expectations, idempotency/audit requirements, schema requirements, and contract-test baseline.
   - **Status:** Prepared; no Prisma schema, migration, database, or runtime production change included.
   - **Important decisions:** Production runtime remains fail-closed; demo remains in-memory; adapter implementation is deferred until a Prisma `Reservation` model exists; `listTables` must return `[]` until a `Table` model is approved; capacity enforcement remains disabled; audit/idempotency must be atomic in the future Prisma implementation.
   - **Dependencies:** `docs/OA41-RESERVATION-PERSISTENCE-PROPOSAL.md`, `src/domain/reservations/service.ts`, `src/server/db/reservation-adapter.ts`, `src/server/runtime.ts`, `src/server/db/tenant-context.ts`, `prisma/rls-tenant-isolation.sql`, `docs/OA39-PGBOUNCER-DISPOSABLE-VALIDATION-PLAN.md`, `docs/OA40-RLS-VALIDATION-PREREQUISITES.md`.
   - **Remaining work:** Owner approval for additive schema; Prisma model implementation; disposable PostgreSQL validation; RLS policy authoring/testing; concurrency tests; runtime replacement of `UnavailableReservations`.

2. **`docs/OA41-RESERVATION-PERSISTENCE-PROPOSAL.md`**
   - **Purpose:** Blocker and safe migration proposal. Defines the proposed additive `ReservationStatus` enum and `Reservation` model, adapter method mapping, concurrency/correctness requirements, migration safety, and runtime change sequence.
   - **Status:** Proposal only; no schema or migration applied.
   - **Important decisions:** Additive-only migration; `Reservation` carries `organizationId`, `outletId`, `dataScope`; RLS required before production use; overlap checks must run in a transaction or use a database constraint; `save` must be idempotent for retries with the same reservation id.
   - **Dependencies:** Existing `ReservationPort`, runtime behavior, disposable PostgreSQL validation docs.
   - **Remaining work:** Owner approval, schema implementation, RLS, concurrency validation.

3. **`tests/reservation-port-contract.test.ts`**
   - **Purpose:** Contract baseline for `MemoryReservations` against `ReservationPort`.
   - **Status:** Exists and is part of the reported 443 passed / 1 skipped verification baseline. It does not imply production persistence readiness.
   - **Important decisions:** Tests `findById`, `save`, `listByOutlet`, `listByTenant`, `countByOutletAndTime`, `listTables`, and status support. It uses `MemoryReservations` only.
   - **Dependencies:** `src/server/db/reservation-adapter.ts`, `src/domain/reservations/service.ts`, `src/domain/shared/tenant-scope.ts`.
   - **Remaining work:** Equivalent contract tests for a future `PrismaReservations` adapter, including tenant/outlet scoping, transaction behavior, and concurrency.

### Related validation documents

4. **`docs/OA39-PGBOUNCER-DISPOSABLE-VALIDATION-PLAN.md`**
   - **Purpose:** Plan for disposable local PgBouncer transaction-pooling validation.
   - **Status:** Plan prepared, not run. Contains an owner-decision conflict: prior owner decision forbids PgBouncer on the laptop; disposable local PgBouncer requires explicit override.
   - **Dependencies:** `tests/helpers/pg-test-guard.ts`, sentinel `HANSAN_PG_TEST_ALLOW=DISPOSABLE-LOCAL-PG`, `hansan_test_*` database naming.
### Conflicting / outdated / parallel artifacts

- **`src/domain/customers/ports.ts`** defines a different `ReservationRecord`/`ReservationPort` model from `src/domain/reservations/service.ts`. The Phase A7 model includes `customerId`, `floorId`, `startAt`, `endAt`, `guestCount`, lowercase statuses (`pending`, `confirmed`, `seated`, `completed`, `cancelled`, `no_show`), and `TableRecord`/`CustomerRecord`. The C2 service model uses `customerName`, `customerEmail`, `customerPhone`, `partySize`, `reservationAt`, `durationMinutes`, uppercase statuses (`PENDING`, `CONFIRMED`, `CANCELLED`, `EXPIRED`, `COMPLETED`), and no `floorId`/`customerId`. These are not aligned and must be reconciled before persistence implementation.
- **`src/domain/customers/reservations.ts`** defines a richer lifecycle transition matrix (`pending -> confirmed/cancelled`, `confirmed -> seated/cancelled/no_show`, `seated -> completed`) and table-level overlap validation. The C2 `ReservationService` only implements create, cancel, and complete (`CONFIRMED -> COMPLETED`); it does not implement check-in/seated, no-show, update, or table-level conflict validation.
- **`docs/OA41...`** proposes only a `Reservation` model. It does not propose Prisma `Table`, `Floor`, or `Customer` models, while `src/domain/customers/ports.ts` assumes those entities. This is an unresolved design decision, not an implemented schema.
- **No authoritative schema document exists** for `Table`, `Floor`, or `Customer`. Any claim that those Prisma models are designed would be unsupported. Status: NOT VERIFIED / requires owner decision.

## C. Existing Reservation Architecture

### Request flow

Customer UI -> `POST /api/customer/reservations` (`src/app/api/customer/reservations/route.ts`) -> `assertSameOrigin` -> `requireAuth` -> `runtimeFor(session)` -> optional `requireRevalidatedLiveContext` for production -> `authorize(authCtx, "pos:order_create", runtime.audit)` -> `rateLimit` -> body validation -> tenant/outlet resolution (`authCtx.actor.tenantId`, `authCtx.actor.outletIds[0]`) -> `runtime.idempotency.begin` -> `ReservationService.createReservation` -> `ReservationPort` (`MemoryReservations` demo / `UnavailableReservations` production) -> `AuditLogPort.record` -> `runtime.idempotency.complete` -> JSON response. Errors are converted by `jsonError`; idempotency claims are failed in the catch path.

### Existing reservation endpoints

- **`POST /api/customer/reservations`** in `src/app/api/customer/reservations/route.ts`: the only verified reservation endpoint. It creates a reservation and supports idempotent replay via `Idempotency-Key`.
- No verified GET/list/update/cancel/check-in/complete reservation HTTP endpoints were found in the inspected tree. `ReservationService` exposes `cancelReservation` and `completeReservation`, but no route wiring for those methods was verified in the inspected files. Status: NOT VERIFIED for additional endpoints beyond POST.

### Existing reservation services

- **`ReservationService`** in `src/domain/reservations/service.ts`:
  - `createReservation(params)`: validates party size 1-20, reservation time in the future, checks outlet capacity using `countByOutletAndTime` and `listTables`, assigns a table only if requested and available by capacity, generates `rsv_...` id, saves, records audit, returns record.
  - `cancelReservation(params)`: loads by `id` + `TenantScope`, rejects cancellation of `CANCELLED`, `COMPLETED`, `EXPIRED`, saves cancelled record, records `ORDER_CANCELLED` audit.
  - `completeReservation(params)`: loads by `id` + `TenantScope`, requires `CONFIRMED`, saves `COMPLETED`. It does not record audit.
- **Phase A7 domain helpers** in `src/domain/customers/reservations.ts`:
  - `RESERVATION_TRANSITIONS`, `canTransitionReservation`, `assertReservationTransition`
  - `OCCUPYING_STATUSES` = `pending`, `confirmed`, `seated`
### Existing validation

- Route-level schema validators in `src/app/api/customer/reservations/route.ts`:
  - `customerName`: non-empty string
  - `customerEmail`: string containing `@`, trimmed/lowercased
  - `customerPhone`: non-empty string
  - `partySize`: integer 1-20
  - `reservationAt`: ISO/date string, must parse and be in the future
  - `durationMinutes`: integer 15-240, default 60
  - `tableId`, `area`, `notes`: optional strings
- Service-level validation: party size 1-20; valid reservation time; future reservation; outlet capacity; table capacity if requested.
- Phase A7 helpers validate guest count 1-500, table active/capacity, time windows, overlap, and 24-hour max window, but are not integrated into C2.

### Existing authorization

- `requireAuth(req)` authenticates the request.
- Production sessions call `requireRevalidatedLiveContext(ctx.session)` and use the revalidated actor.
- `authorize(authCtx, "pos:order_create", runtime.audit)` enforces the `pos:order_create` permission. No reservation-specific permission was verified.
- Outlet assignment is taken from `authCtx.actor.outletIds[0]`; missing outlet returns 400 `VALIDATION_FAILED`.
- Tenant identity comes from the revalidated actor, not request body.

### Existing idempotency and rate-limiting behavior

- `Idempotency-Key` header is required; missing header returns 400.
- `requestHash(payload)` hashes the normalized payload.
- `runtime.idempotency.begin` returns `started`, `replay`, or conflict.
- Replay returns stored response with 200.
- Conflicting payload under the same key returns 409.
- On service failure, `runtime.idempotency.fail` releases in-progress claims but preserves completed claims.
- `rateLimit` uses key `reservations:${userId}:${clientIp}` with `RATE_LIMITS.mutation`.
- Rate-limit failure returns 429 `RATE_LIMITED`.

### Current persistence limitations

- `ReservationPort` interface in `src/domain/reservations/service.ts` has no tenant scope parameter on `save`, `listByOutlet`, `listByTenant`, or `countByOutletAndTime`.
- `MemoryReservations` stores process-local `Map`; data is lost on restart and is not shared.
- `MemoryReservations.findById` checks `tenantId` but not `outletId`.
- `MemoryReservations.save` does not validate tenant/outlet scope.
- `MemoryReservations.listByOutlet` and `listByTenant` do not pin tenant context.
- `UnavailableReservations` makes production reservation creation impossible.
- No Prisma `Reservation` model, no migration, no RLS policy, no database constraint, no transactional overlap protection.
- `listTables` returns `[]`, so capacity enforcement is effectively disabled.
- `completeReservation` does not record audit.
## D. Proposed Prisma Data Model

### 1. Existing schema

`prisma/schema.prisma` contains tenancy/identity, menu, inventory, order, payment, refund, settlement, approval, and audit models. It does **not** contain `Reservation`, `Table`, `Floor`, or `Customer`. The only reservation-related database artifact is the generic `AuditEvent` table, which can store `entityType = "reservation"` audit rows. No foreign key or unique constraint for reservations exists.

### 2. Proposed schema (from `docs/OA41-RESERVATION-PERSISTENCE-PROPOSAL.md`)

Proposed additive enum:

```prisma
enum ReservationStatus {
  PENDING
  CONFIRMED
  CANCELLED
  EXPIRED
  COMPLETED
}
```

Proposed additive model:

```prisma
model Reservation {
  id              String            @id // "rsv_..."
  organizationId  String
  outletId        String
  dataScope       DataScope         @default(PRODUCTION)
  customerName    String
  customerEmail   String
  customerPhone   String
  partySize       Int
  reservationAt   DateTime
  durationMinutes Int               @default(60)
  status          ReservationStatus @default(CONFIRMED)
  tableId         String?
  area            String?
  notes           String?
  createdBy       String
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])
  outlet       Outlet       @relation(fields: [outletId], references: [id])

  @@index([organizationId, outletId, reservationAt])
  @@index([outletId, status, reservationAt])
}
```

Also proposed: add `reservations Reservation[]` relations to `Organization` and `Outlet`.

#### Field analysis

- **Primary key:** `id String @id`, domain-generated prefix `rsv_...`.
- **Foreign keys:** `organizationId -> Organization.id`; `outletId -> Outlet.id`.
- **Tenant/outlet ownership:** `organizationId` and `outletId` are required. `dataScope` defaults to `PRODUCTION` and should remain pinned to production on live paths.
- **Required fields:** `id`, `organizationId`, `outletId`, `customerName`, `customerEmail`, `customerPhone`, `partySize`, `reservationAt`, `status`, `createdBy`, `createdAt`, `updatedAt`.
- **Optional fields:** `tableId`, `area`, `notes`; `dataScope` has a default.
- **Status lifecycle proposed by OA41:** `PENDING`, `CONFIRMED`, `CANCELLED`, `EXPIRED`, `COMPLETED`. Default `CONFIRMED`.
- **Timezone handling:** `reservationAt DateTime`; route/service normalize to ISO UTC. Date parsing and half-open interval overlap are performed in application time. Database `DateTime` stores an absolute timestamp; timezone display is not specified in the proposal.
- **Soft-delete:** None proposed. Reservation cancellation is a status transition, not deletion.
- **Indexes:** `@@index([organizationId, outletId, reservationAt])` and `@@index([outletId, status, reservationAt])`.
- **Unique constraints:** None proposed. Idempotency is handled by `IdempotencyRecord`, not by a reservation unique constraint.
- **Concurrency:** Proposal requires overlap checks in a transaction or a database constraint. No exclusion constraint or unique index is proposed. NOT VERIFIED whether PostgreSQL exclusion constraints will be used.

### 3. Table, Floor, Customer models

- **Table:** Not proposed in `docs/OA41...`. `src/domain/customers/ports.ts` defines a TypeScript `TableRecord` with `id`, `tenantId`, `outletId`, `floorId`, `name`, `capacity`, `positionX`, `positionY`, `minOrderIdr`, `active`. No Prisma `Table` model, migration, or authoritative schema decision exists. Status: NOT VERIFIED / requires owner decision.
- **Floor:** Not proposed in `docs/OA41...`. `floorId` appears only in the Phase A7 TypeScript ports. No Prisma `Floor` model or migration exists. Status: NOT VERIFIED / requires owner decision.
- **Customer:** Not proposed in `docs/OA41...`. `src/domain/customers/ports.ts` defines a TypeScript `CustomerRecord`. The C2 reservation flow stores customer contact fields directly on the reservation and does not link to a `Customer` model. No Prisma `Customer` model or migration exists. Status: NOT VERIFIED / requires owner decision.
## E. Multi-Tenant Security Review

### Current controls

- **Tenant identity:** `authCtx.actor.tenantId` from `requireAuth` and, in production, `requireRevalidatedLiveContext`. Request body is not used for tenant identity.
- **Outlet identity:** `authCtx.actor.outletIds[0]` is used for reservation creation. `tenantContextForActor` validates outlet grants for owners/finance.
- **Adapter scoping:** Future OA42 mapping requires `WHERE organizationId = scope.organizationId` and optional `outletId`. Current `MemoryReservations.findById` checks only `tenantId`, not `outletId`; `save` is unscoped; list methods filter by outlet/tenant but do not pin a tenant context.
- **RLS:** `prisma/rls-tenant-isolation.sql` contains policies for Order, Payment, Refund, Settlement, catalog, inventory, idempotency, approval, and audit tables. It contains no policy for `Reservation` because the table does not exist. RLS is authored but not applied.
- **Transaction GUCs:** `pinTenantContext` and `withTenantTransaction` set `app.organization_id`, `app.outlet_id`, `app.role`, and `app.data_scope` with `SET LOCAL`. This primitive exists and is used by other adapters.
- **Audit:** `AuditLogPort.record` stores `organizationId` and `outletId`. Production audit failures propagate.

### Security gaps

1. **No reservation RLS policy.** Until a policy is authored and applied, database-level tenant isolation for reservations does not exist.
2. **No outlet enforcement in `MemoryReservations.findById`.** A reservation from the same tenant but different outlet would be returned if only tenant scope is checked. Future adapter must enforce both organization and outlet.
3. **No tenant check in `MemoryReservations.save`.** A caller could overwrite a reservation record with a different tenant/outlet if the ID is known.
4. **No reservation-specific authorization permission.** The route uses `pos:order_create`, which may be broader or different than intended reservation access.
5. **No customer ownership model.** Customer contact fields are stored on the reservation; there is no verified customer identity, customer-scoped access, or customer ownership validation.
6. **No table/outlet relationship validation.** Proposed `tableId` is optional and unvalidated; a table from another outlet or tenant could be assigned if persisted.
7. **No FK constraints for reservations.** Until the migration adds FKs to `Organization` and `Outlet`, referential integrity is not enforced.
8. **No cross-tenant negative tests for reservations.** Existing contract tests verify `MemoryReservations` tenant filtering, but no DB-level RLS negative tests exist.
9. **IDOR risk on future ID-based endpoints.** Any future `GET/PATCH/DELETE /reservations/:id` must use `findById(id, scope)` with the revalidated actor's tenant/outlet. The current `ReservationPort.findById` accepts `TenantScope`, but the C2 service's `cancelReservation`/`completeReservation` rely on callers to pass scope correctly.
10. **Data scope risk.** Demo reservations must never reach production tables. Runtime isolation already separates demo and production; future adapter must preserve `dataScope` and RLS production pinning.

### Proposed mitigations

- Add `Reservation` RLS policy following the Order pattern: SELECT org + dataScope + outlet-or-tenant-wide; INSERT org + concrete outlet + dataScope; UPDATE org + dataScope; no DELETE.
- Make `PrismaReservations` tenant-pin GUCs first in every transaction using `persistencePinContext`.
- Enforce `organizationId` and `outletId` in every query.
- Add FKs from `Reservation.organizationId` and `Reservation.outletId` to parent tables.
- Add outlet validation for `tableId` if a `Table` model is introduced.
- Introduce or verify a reservation-specific permission instead of reusing `pos:order_create` if business rules require it.
- Link reservations to a verified customer model or explicitly document guest-only reservations.
- Add contract and integration tests for cross-tenant read/write/update attempts.
- Keep demo runtime isolated and ensure `dataScope` cannot be client-controlled.
- Require owner approval before applying RLS and before any production use.

### Database-level constraints that can prevent cross-tenant relations

## F. Reservation Lifecycle and Business Logic

### Expected lifecycle

1. **Create reservation:** Route validates body, resolves tenant/outlet, begins idempotency, service validates party size and future time, checks capacity, assigns table, saves, records audit, completes idempotency.
2. **Validate availability:** C2 service uses outlet-level capacity: `countByOutletAndTime` counts `PENDING`/`CONFIRMED` overlapping reservations; if tables exist and count >= table count, slot unavailable. Phase A7 provides per-table overlap validation but is not integrated.
3. **Assign table:** C2 assigns requested table only if it exists in `listTables` and has enough capacity. Since `listTables` returns `[]`, assignment never happens. Phase A7 validates table active/capacity/overlap.
4. **Update reservation:** Not implemented in C2 service or route.
5. **Confirm reservation:** C2 creates reservations as `CONFIRMED` by default. No separate confirm transition is implemented.
6. **Check in / seat:** Not implemented in C2 service. Phase A7 supports `confirmed -> seated`.
7. **Complete reservation:** `completeReservation` allows only `CONFIRMED -> COMPLETED`. It does not record audit.
8. **Cancel reservation:** `cancelReservation` allows cancellation unless status is `CANCELLED`, `COMPLETED`, or `EXPIRED`. It appends cancellation reason to notes and records audit.
9. **Handle no-show:** Not implemented in C2 service. Phase A7 supports `confirmed -> no_show`.
10. **Handle conflicting reservations:** C2 checks outlet capacity before save; Phase A7 checks per-table overlap. Neither is transactional today.

### Concurrency and race conditions

- **Double booking:** The check-then-save sequence in `createReservation` is not atomic. Concurrent requests can both pass `countByOutletAndTime` and save overlapping reservations. Future design requires transaction or DB constraint.
- **Duplicate reservation creation:** Route-level idempotency prevents duplicate execution for the same key and payload. Service-generated `rsv_...` IDs reduce collision, but direct adapter use or retries without idempotency are not protected. `save` is an upsert-like overwrite in memory.
- **Invalid status transitions:** C2 service enforces limited transitions. Phase A7 has a more complete matrix. Neither is persisted or DB-enforced.
- **Cross-outlet table assignment:** Not validated in C2 because `listTables` returns `[]`. Future Table model must enforce outlet/tenant.
- **Time overlap conflicts:** C2 counts overlapping outlet reservations; Phase A7 validates per-table windows. Timezone offsets are parsed consistently in memory tests.

### Design prevention assessment

- **Double booking:** NOT prevented today. Future transaction/advisory lock/exclusion constraint required.
- **Duplicate reservation creation:** Partially prevented at route idempotency layer for same key/payload. Not prevented at adapter level.
- **Invalid status transitions:** Partially prevented in C2 service for cancel/complete. Not enforced by DB or in Phase A7 integration.
- **Cross-outlet table assignment:** Not applicable today because table assignment is disabled. Future requires validation.
- **Time overlap conflicts:** Partially prevented by capacity count, but not transactional and not per-table.

### Unimplemented functionality

- `PrismaReservations` adapter.
- Production reservation persistence.
- Check-in/seated transition.
- No-show transition.
- Update reservation endpoint/service.
- List/get reservation endpoints.
- Customer linkage.
## G. Disposable PostgreSQL Validation Plan

### Safe validation environment

- Use a disposable PostgreSQL instance only, with database names prefixed `hansan_test_` (for example `hansan_test_reservation`).
- Use loopback only (`127.0.0.1` or `localhost`).
- Set `HANSAN_PG_TEST_ALLOW=DISPOSABLE-LOCAL-PG` as the explicit sentinel.
- Use `HANSAN_PG_TEST_URL` only for test connections; never read `DATABASE_URL` or `DIRECT_URL` in the validation workflow.
- Keep application runtime variables untouched. Production Supabase endpoints remain reserved for staging and are not used.
- Do not expose credentials or secret values in docs, logs, or commits. Build connection URLs in-command from a local password file if needed.
- Use `tests/helpers/pg-test-guard.ts` and update `tests/pg-guard.test.ts` only through an approved guard change.

### Validation sequence

1. **Database isolation:** Create a disposable local PostgreSQL database with synthetic data only. No production data, no production credentials.
2. **Connection configuration:** Configure the test URL with the disposable database and loopback host. Verify the guard accepts the host/port/database name.
3. **Prisma schema validation:** Run `prisma validate` and `prisma generate` against the additive schema without applying migrations.
4. **Migration generation:** Generate an additive migration containing `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX`, relation additions, and FKs. Review SQL for destructive statements.
5. **Migration application:** Apply the migration to the disposable database using `DIRECT_URL` equivalent pointed at the disposable instance, never production.
6. **Migration status:** Run `prisma migrate status` against the disposable database and confirm applied/consistent.
7. **Rollback/recovery:** Document reverse SQL for the additive migration (drop policies, drop table, drop type) and test rollback on a second disposable database. Do not run rollback against production.
8. **Seed strategy:** Insert synthetic tenants, outlets, and reservations only on the disposable database. Use multiple tenants/outlets to test isolation. No real customer data.
9. **Integration test strategy:** Run adapter contract tests, tenant isolation tests, overlap tests, concurrent booking tests, idempotency tests, status transition tests, and migration integrity checks.
10. **Cleanup procedure:** Remove test data and, if approved, destroy the disposable database/container. Container/volume deletion is RED and requires explicit owner approval. Application runtime variables remain unchanged.

### PgBouncer-specific considerations

- OA39 requires an owner decision between local disposable PgBouncer and staging-only testing.
- If local PgBouncer is approved, use transaction pooling mode, version >= 1.26.1, and port 5434 with a reviewed guard change.
- If staging is selected, use the PHASE-17 matrix when staging is available.
- Direct PostgreSQL results do not prove pooled behavior.

## H. Test Coverage Plan

### 1. Reservation CRUD

- **Existing:** `tests/customer-reservations-route.test.ts` covers demo POST success, auth/role/body/outlet/idempotency.
- **Missing:** GET/list, update, cancel, check-in, complete, no-show, delete policy, not-found behavior for production, service-level unit tests for cancel/complete.
- **Files:** `tests/customer-reservations-route.test.ts`, future `tests/reservation-service.test.ts`.
- **Expected outcome:** All CRUD operations scoped by tenant/outlet and return deterministic errors.

### 2. Tenant isolation

- **Existing:** `tests/reservation-port-contract.test.ts` verifies `MemoryReservations` tenant filtering on `findById`, `listByTenant`, and `countByOutletAndTime`.
- **Missing:** Production adapter tenant tests; DB RLS positive/negative tests; cross-tenant write/update tests.
- **Files:** `tests/reservation-port-contract.test.ts`, future Prisma adapter tests, `prisma/rls-tenant-isolation.sql`.
- **Expected outcome:** No cross-tenant read/write/update under app or DB context.

### 3. Outlet isolation

- **Existing:** Contract test verifies `countByOutletAndTime` ignores other outlets. Route tests verify missing outlet.
- **Missing:** `findById` outlet enforcement; `save` outlet enforcement; list filtering by tenant+outlet; RLS outlet tests.
- **Files:** `tests/reservation-port-contract.test.ts`, `src/server/db/reservation-adapter.ts`.
- **Expected outcome:** Same-tenant different-outlet access denied.

### 4. Table availability

- **Existing:** Phase A7 helpers in `src/domain/customers/reservations.ts` validate table active/capacity/overlap. `tests/reservation-overlap.test.ts` covers memory overlap counting.
- **Missing:** Integration of helpers with C2 service; Table model tests; per-table availability tests.
- **Files:** `src/domain/customers/reservations.ts`, `src/domain/reservations/service.ts`.
- **Expected outcome:** Table capacity and overlap rules enforced consistently.

### 5. Reservation overlap
### 7. Idempotency

- **Existing:** `tests/customer-reservations-route.test.ts` covers replay (200) and conflicting payload (409). `tests/idempotency-organization-consistency.test.ts` may cover organization consistency.
- **Missing:** Production idempotency interaction with reservation save; audit/idempotency atomicity; retry after partial failure.
- **Files:** `tests/customer-reservations-route.test.ts`, `src/server/idempotency.ts`, `src/server/db/idempotency-adapter.ts`.
- **Expected outcome:** Same key/payload replays; different payload conflicts; failed writes release claims.

### 8. Invalid status transitions

- **Existing:** Phase A7 helpers define transition matrix. C2 service enforces cancel/complete transitions. No dedicated transition tests were verified for reservation service.
- **Missing:** Unit tests for all transitions including check-in/no-show if adopted; DB constraint if status enum is DB-level.
- **Files:** `src/domain/customers/reservations.ts`, `src/domain/reservations/service.ts`.
- **Expected outcome:** Disallowed transitions throw `RESERVATION_TRANSITION_INVALID`.

### 9. Customer ownership

- **Existing:** None. C2 stores contact fields but no customer model.
- **Missing:** Customer identity model, ownership validation, scoped customer access.
- **Files:** `src/domain/customers/ports.ts`.
- **Expected outcome:** Reservation access tied to verified customer or documented guest-only scope.

### 10. Authorization

- **Existing:** Route tests cover unauthenticated (401), role lacking `pos:order_create` (403), missing outlet.
- **Missing:** Reservation-specific permission tests; HQ vs outlet permissions; production revalidation tests.
- **Files:** `tests/customer-reservations-route.test.ts`, `src/server/authz.ts`.
- **Expected outcome:** Only authorized roles/outlets can create or manage reservations.

### 11. Database constraints

## I. Production Readiness Assessment

- **Schema readiness:** BLOCKED. No `Reservation`, `Table`, `Floor`, or `Customer` Prisma models. OA41 proposes `Reservation` only; richer models unresolved.
- **Persistence readiness:** BLOCKED. Production uses `UnavailableReservations` and fails closed. Demo uses `MemoryReservations`. No durable adapter.
- **Security readiness:** PARTIALLY READY. App-level tenant/outlet/auth controls exist; RLS for reservations absent; no DB-level enforcement; permission model uses `pos:order_create`.
- **Concurrency readiness:** BLOCKED. Availability checks are not transactional; no advisory lock, serializable transaction, or exclusion constraint implemented/tested.
- **API integration readiness:** PARTIALLY READY. POST route is implemented and tested for demo. Cancel/complete/list/update endpoints are not wired. Production reservation creation intentionally returns 503.
- **Observability:** PARTIALLY READY. Audit events are recorded for create/cancel; complete does not audit. Structured logging specifics not verified in inspected files.
- **Error recovery:** PARTIALLY READY. Idempotency fail path releases claims; audit failures fail closed. No retry for transaction conflicts; no compensation beyond idempotency.
- **Test coverage:** PARTIALLY READY. 443 tests passed / 1 skipped in prior verification, including reservation port/overlap/route/fail-closed tests. Missing production adapter, DB, concurrency, RLS, and lifecycle tests.
## J. Implementation Sequence

Shortest safe sequence from current state:

1. **Confirm schema decisions.** Reconcile C2 reservation model with Phase A7 model; decide whether Table/Floor/Customer are in scope; approve status lifecycle and permissions.
2. **Additive Prisma schema.** Add `ReservationStatus` and `Reservation` to `prisma/schema.prisma`; add relations to `Organization` and `Outlet`; generate migration; review SQL.
3. **Disposable PostgreSQL validation.** Apply migration to disposable DB; run `prisma migrate status`; test FKs and indexes.
4. **Migration integrity testing.** Test rollback/recovery; verify no destructive SQL; document evidence.
5. **Reservation persistence implementation.** Implement `PrismaReservations` following OA42 mapping and `PrismaOrders` transaction pattern; pin tenant GUCs; transactional overlap check.
6. **API integration.** Replace `UnavailableReservations` with `PrismaReservations` in production runtime; add list/get/update/cancel/check-in/no-show endpoints if approved.
7. **Security and concurrency testing.** Add RLS policy for Reservation; run cross-tenant tests; run concurrent booking tests; validate PgBouncer if approved.
8. **Full verification.** Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`; add adapter contract tests.
## K. Blockers and Owner Decisions

1. **Reservation domain model reconciliation**
   - **Why it matters:** C2 and Phase A7 use incompatible reservation shapes/statuses.
   - **Options:** Use C2 model only; use Phase A7 model only; create a unified model.
   - **Recommended:** Create a unified model before schema work.
   - **Consequence of delay:** Schema and adapter rework later.

2. **Scope of Table/Floor/Customer models**
   - **Why it matters:** Phase A7 assumes these entities, but OA41 does not propose Prisma models.
   - **Options:** Reservation-only first with denormalized contact/table fields; add Table/Floor/Customer in same migration; defer Table/Floor/Customer.
   - **Recommended:** Reservation-only first, with `listTables` returning `[]`, matching OA41 and current behavior.
   - **Consequence of delay:** Blocks richer table-level availability.

3. **Status lifecycle**
   - **Why it matters:** Determines enum, transitions, and tests.
   - **Options:** OA41's five uppercase statuses; Phase A7's six lowercase statuses including seated/no_show; hybrid.
   - **Recommended:** Owner must choose; do not silently merge.
   - **Consequence of delay:** Migration and transition logic cannot be finalized.

4. **Permission model**
   - **Why it matters:** Current route uses `pos:order_create`.
   - **Options:** Keep `pos:order_create`; add `pos:reservation_create/manage`; HQ vs outlet permissions.
   - **Recommended:** Explicit owner decision, with least privilege.
   - **Consequence of delay:** Overbroad or incorrect access.

5. **Table-level vs outlet-level capacity**
   - **Why it matters:** Affects schema, validation, and concurrency.
   - **Options:** Outlet capacity only; per-table overlap; both.
   - **Recommended:** Start outlet-level to match current behavior; add per-table only after Table model approval.
   - **Consequence of delay:** Capacity enforcement remains disabled.

6. **Concurrency strategy**
   - **Why it matters:** Prevents double booking.
   - **Options:** Serializable transaction; advisory lock by outlet/time; PostgreSQL exclusion constraint; application-level lock.
   - **Recommended:** Transaction plus advisory lock/exclusion constraint, proven on disposable PostgreSQL.
   - **Consequence of delay:** Race conditions remain.

7. **RLS policy shape**
   - **Why it matters:** Database-level tenant isolation.
   - **Options:** Order-pattern org/outlet/dataScope policy; customer-access variant; no RLS initially.
   - **Recommended:** Order-pattern policy, with owner approval.
   - **Consequence of delay:** No DB-level protection.

8. **Disposable PostgreSQL / PgBouncer path**
   - **Why it matters:** OA39 has an owner-decision conflict.
## L. Final Recommendation

- **Current phase status:** Preparation complete. No schema, migration, database, or production runtime changes have been made. Production reservation persistence remains intentionally unavailable and fail-closed.
- **Whether the next phase can safely begin:** The next phase can begin only after owner approval of the blockers in Section K. Schema implementation should not start before model reconciliation and status lifecycle decisions.
- **Exact next authorized action:** Owner reviews and approves the reservation domain model, status lifecycle, Table/Floor/Customer scope, permission model, and disposable PostgreSQL/PgBouncer path. Then create the additive Prisma schema and migration in a separate approved task.
- **Remaining blockers:** Model reconciliation; Table/Floor/Customer scope; status lifecycle; permission model; concurrency strategy; RLS policy; disposable PostgreSQL validation; production adapter implementation.
- **Expected deliverables:** Unified reservation domain model, additive Prisma schema/migration, `PrismaReservations` adapter, RLS policy, disposable PostgreSQL validation evidence, concurrency tests, updated runtime wiring, full verification.
- **Acceptance criteria:** `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` pass; production reservation creation persists durably; cross-tenant access denied; overlapping bookings prevented under concurrency; RLS validated on disposable PostgreSQL; no production Supabase mutation.

   - **Options:** Local disposable PgBouncer with explicit override; staging-only.
   - **Recommended:** Owner selects based on infrastructure availability.
   - **Consequence of delay:** Cannot validate pooled transaction behavior.

9. **Customer identity**
   - **Why it matters:** Determines whether reservations link to customers or remain guest records.
   - **Options:** Guest-only contact fields; linked Customer model; hybrid.
   - **Recommended:** Owner decision; current flow is guest-only.
   - **Consequence of delay:** Customer ownership tests cannot be defined.

9. **Production readiness review.** Review evidence, owner sign-off, deployment checklist, rollback plan.

Avoid refactoring unrelated modules. Keep changes additive and scoped to reservation persistence.

- **Deployment readiness:** BLOCKED. Cannot deploy durable reservation persistence without schema migration, RLS, disposable PostgreSQL validation, and owner approval.

- **Existing:** None for reservations.
- **Missing:** FK tests, RLS tests, unique/idempotency constraint tests, migration integrity tests.
- **Files:** future migration, `prisma/rls-tenant-isolation.sql`, `tests/pg-guard.test.ts`.
- **Expected outcome:** Invalid tenant/outlet/table references fail; cross-tenant rows invisible.

### 12. Migration integrity

- **Existing:** Init migration exists; OA40 documents migration status prerequisites.
- **Missing:** Reservation migration apply/status on disposable PostgreSQL; rollback test; PgBouncer smoke if approved.
- **Files:** `prisma/migrations/`, `docs/OA39...`, `docs/OA40...`.
- **Expected outcome:** Migration applies cleanly, status consistent, rollback documented and tested.


- **Existing:** `tests/reservation-overlap.test.ts` (18+ cases) covers half-open intervals, boundaries, statuses, outlets, dates, timezones, invalid inputs.
- **Missing:** Database-level concurrent overlap tests; per-table overlap tests.
- **Files:** `tests/reservation-overlap.test.ts`.
- **Expected outcome:** Overlapping occupying reservations are counted and blocked.

### 6. Concurrent booking

- **Existing:** None for reservations. Idempotency adapter has concurrency protection for keys.
- **Missing:** Concurrent create tests at adapter/service/route levels; transaction conflict retry tests; advisory lock/exclusion constraint tests.
- **Files:** Future `tests/reservation-concurrency.test.ts`.
- **Expected outcome:** No double booking under concurrent requests; conflicts return `SLOT_UNAVAILABLE` or idempotency conflict deterministically.

### Guarantee against accidental production connection

- Never set `DATABASE_URL` or `DIRECT_URL` to Supabase during validation.
- Use only `HANSAN_PG_TEST_URL`.
- Guard validates host, port, database prefix, and sentinel.
- No migration command should use production environment files.
- Report any guard failure and stop; do not bypass the guard.
- No production Supabase connection is made by this task.

- Table and floor persistence.
- RLS policy for Reservation.
- Transactional overlap protection.
- Audit on complete reservation.
- Table-level availability integration.
- Cancellation idempotency/no-op behavior for completed/cancelled reservations (currently throws).
- Audit/idempotency atomicity with reservation save.
- Owner-approved schema decisions.

- FK `Reservation.organizationId -> Organization.id`
- FK `Reservation.outletId -> Outlet.id`
- Optional future FK `Reservation.tableId -> Table.id` (if Table model approved)
- Optional future FK `Reservation.createdBy -> User.id` (if approved)
- RLS policies comparing `organizationId` to `current_setting('app.organization_id')`
- RLS outlet predicate comparing `outletId` to `current_setting('app.outlet_id')`
- No DELETE policy for lifecycle-only reservation handling, if adopted
- Unique constraints are not currently proposed; any idempotency at DB level would require an explicit owner decision.


### 4. Unresolved design decisions

- Whether to use OA41's simplified C2 reservation model or reconcile with the richer Phase A7 model (`src/domain/customers/ports.ts` and `src/domain/customers/reservations.ts`).
- Whether to persist `Table`, `Floor`, and `Customer` entities or keep reservation contact/table data denormalized.
- Whether table assignment validation should be per-table (Phase A7) or outlet-capacity based (C2 service).
- Whether status lifecycle should be uppercase C2 statuses or lowercase Phase A7 statuses including `seated` and `no_show`.
- Whether `EXPIRED` should be system-derived or manually set.
- Whether to add a unique/idempotency constraint directly on `Reservation`.
- Whether to add PostgreSQL exclusion constraints for overlap prevention.
- Whether `createdBy` should reference `User.id` with a foreign key. The proposal declares `createdBy String` but no relation.
- Whether `customerEmail` should be normalized/indexed.
- Whether soft-delete or cancellation-only lifecycle is required.
- Whether RLS policy for `Reservation` should follow the Order pattern (org + outlet + dataScope) or a customer-access variant.
- Whether `listByOutlet` should enforce tenant pinning using the outlet's organization, as OA42 requires, even though the current port lacks a tenant parameter.

Do not invent decisions not documented. The above are explicitly unresolved in the repository.

- No check-in/seated, no-show, update, or table-level availability integration.

### Existing error handling

- Route catches all errors and returns `jsonError(error)`.
- Service throws `AppError` with `VALIDATION_FAILED`, `SLOT_UNAVAILABLE`, `NOT_FOUND`, `RESERVATION_TRANSITION_INVALID`.
- Adapter throws `PERSISTENCE_NOT_CONFIGURED` for production.
- Idempotency failures are swallowed in `fail(...).catch(() => {})`.
- Audit write failures propagate and fail the operation; in the future Prisma implementation, reservation and audit should be atomic.

  - `validateGuestCount`, `validateTableForReservation`, `windowsOverlap`, `validateAvailability`, `validateWindow`
  - These helpers are not used by the C2 `ReservationService` in the inspected code. Status: implemented but not integrated into the C2 flow.

### Current demo and production behavior

- **Demo sessions:** `demoSandbox()` in `src/server/runtime.ts` uses `MemoryReservations`; reservation writes succeed in process-local memory and are isolated from Postgres.
- **Production sessions:** `runtimeFor()` uses `UnavailableReservations`; every reservation operation throws `PERSISTENCE_NOT_CONFIGURED` (503). This is intentional fail-closed behavior until a Prisma model exists.
- **`tests/reservation-production-failclosed.test.ts`** verifies production uses `UnavailableReservations` and demo uses `MemoryReservations`.

### Authoritative preparation package

The authoritative preparation package is **`docs/OA42-RESERVATION-PERSISTENCE-PREPARATION.md`** plus **`docs/OA41-RESERVATION-PERSISTENCE-PROPOSAL.md`**, with `tests/reservation-port-contract.test.ts` as the baseline contract artifact. OA42 is the operational preparation document; OA41 is the schema/migration proposal. OA39 and OA40 are supporting validation prerequisites, not reservation schema designs.

   - **Remaining work:** Owner selection of local disposable vs staging path; guard change approval; execution.

5. **`docs/OA40-RLS-VALIDATION-PREREQUISITES.md`**
   - **Purpose:** Prerequisites and test matrix for RLS/tenant-isolation validation.
   - **Status:** Artifacts prepared; nothing applied. Identifies missing RLS policies in the init migration, missing app DB role, missing table ownership separation, and missing synthetic seed strategy.
   - **Dependencies:** `prisma/rls-tenant-isolation.sql`, `src/server/db/tenant-context.ts`, disposable PostgreSQL guard.
   - **Remaining work:** RLS migration authoring, role creation, seed strategy, disposable PostgreSQL execution.

  - Existing untracked implementation support: `src/domain/reservations/service.ts`, `src/server/db/reservation-adapter.ts`, `src/app/api/customer/reservations/route.ts`, `src/domain/customers/ports.ts`, `src/domain/customers/reservations.ts`, `tests/customer-reservations-route.test.ts`, `tests/reservation-overlap.test.ts`, `tests/reservation-production-failclosed.test.ts`
  - Modified tracked runtime support: `src/server/runtime.ts` now uses `UnavailableReservations` for production and `MemoryReservations` for demo.
- **Database / production changes:** None verified. `prisma/schema.prisma` contains no `Reservation`, `Table`, `Floor`, or `Customer` model. No Prisma migration for reservations is present. No disposable PostgreSQL validation was run. No production Supabase mutation was performed. Runtime production reservation writes fail closed with `PERSISTENCE_NOT_CONFIGURED` (503).

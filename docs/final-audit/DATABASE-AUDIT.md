# HANSAN V2 — Database Audit

## 1. Prisma schema overview

- Provider: PostgreSQL (Supabase)
- Models: `Organization`, `Outlet`, `User`, `Membership`, `MenuCategory`,
  `MenuItem`, `Ingredient`, `Recipe`, `RecipeItem`, `InventoryMovement`,
  `Order`, `OrderItem`, `SequenceCounter`, `IdempotencyRecord`, `Payment`,
  `Refund`, `SettlementBatch`, `Approval`, `AuditEvent`, `Reservation`
- Enums: `DataScope`, `OrderState`, `OrderType`, `Station`, `PrepStatus`,
  `PaymentState`, `PaymentStatus`, `RefundStatus`, `SettlementStatus`,
  `ReservationStatus`
- Money: `BigInt` for financial values
- Quantities: `Decimal(14,3)` with unit enum

## 2. Schema validation

- `npm run db:validate` (`prisma validate`): **PASS**
  - Schema is valid.
- `npm run db:migrate:status` (`prisma migrate status`): **BLOCKED**
  - Database unreachable: `P1001: Can't reach database server at
    aws-0-us-west-1.pooler.supabase.com:5432`.
  - No live database connection available during audit.

## 3. Migration history

Local migration directories:
- `prisma/migrations/20261009000000_init`
- `prisma/migrations/20261028110457_reservation_persistence` (untracked)

Only the init migration is tracked; the reservation persistence migration is
untracked and was not applied/verified against a live database during this audit.

## 4. Key integrity features (schema-level)

- Tenant columns (`organizationId`, `outletId`) on business tables.
- `dataScope` separation (`PRODUCTION`/`DEMO`) on money and lifecycle tables.
- Unique constraints:
  - `Outlet.slug`? (Organization.slug unique)
  - `IdempotencyRecord` unique on `(organizationId, scope, key)`
  - `SequenceCounter` unique on `(outletId, name)`
  - `SettlementBatch` unique on `(outletId, batchNumber)`
  - `Membership` unique on `(userId, organizationId)`
- Indexes on tenant/outlet/status/time columns.

## 5. Relation gaps

- No `Table`, `Floor`, or `Customer` models exist.
- `Reservation.tableId` is a nullable string, not a foreign key to a Table
  model (no Table model exists).
- `Order.customerId` is a nullable string without a Customer relation.
- `Reservation` has no `Floor` relation.
- `MemoryReservations` and `PrismaReservations` return an empty table list
  (`listTables` returns `[]`), so table-capacity assignment is not backed by
  persisted table data.

## 6. Transaction boundaries

- Order persistence: adapter-level transactional parent+items (per Phase A).
- Idempotency: unique constraint + in-progress/completed states.
- Refund/payment: service-level checks; DB transaction boundaries depend on
  adapter implementation.
- Reservation overlap protection: in-memory/adapter-level filtering only;
  no database-level exclusion constraint or transactional locking verified.
- No live database validation performed.

## 7. RLS status

- `prisma/rls-tenant-isolation.sql` exists and covers 15+ tenant tables,
  including `Reservation`.
- It is explicitly marked "REVIEWABLE, NOT YET APPLIED".
- RLS is not verified against a live database.
- Identity tables (`Organization`, `Outlet`, `User`, `Membership`) are
  intentionally not RLS-scoped (bootstrap/session issuance).

## 8. Demo vs production behavior

- Demo sessions use process-local in-memory sandbox (`demoSandbox()`).
- Live/production sessions use Prisma; missing `DATABASE_URL` fails closed
  (`PERSISTENCE_NOT_CONFIGURED` / 503).
- Reservation persistence was historically fail-closed (`UnavailableReservations`);
  current untracked code introduces `PrismaReservations` for live sessions.

## 9. Database audit conclusion

Schema is structurally coherent and validates. However, live migration
consistency, RLS application, transactional overlap protection, and
reservation persistence behavior are not verified against a real database.

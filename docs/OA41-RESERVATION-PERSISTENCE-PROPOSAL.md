# OA41 — Reservation Persistence: Blocker and Safe Migration Proposal

## Current verified state
- `prisma/schema.prisma` has no `Reservation` (or `Table`/`Floor`/`Customer`) model.
- `src/server/runtime.ts` previously used `MemoryReservations` for production, which accepted and reported successful reservations without durable storage.
- Production runtime now uses `UnavailableReservations`, which fails closed with `PERSISTENCE_NOT_CONFIGURED` (503). Demo sessions remain on `MemoryReservations`.
- No remote database mutation or migration was performed in this phase.

## Required schema change (additive only)
Add the following enum and model to `prisma/schema.prisma` in a new migration:

```prisma
enum ReservationStatus {
  PENDING
  CONFIRMED
  CANCELLED
  EXPIRED
  COMPLETED
}

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

Also add `reservations Reservation[]` relations to `Organization` and `Outlet`.

## Adapter implementation
Implement `PrismaReservations implements ReservationPort` (`src/server/db/reservation-adapter.ts` or a new Prisma adapter) using tenant-pinned transactions, following the existing `PrismaPayments`/`PrismaOrders` patterns:
- `findById(id, scope)`: verify `organizationId` match; pin tenant GUC.
- `save(reservation)`: upsert by `id` (create on first write, update status/timestamps on transition).
- `listByOutlet` / `listByTenant`: filter by outlet/tenant and optional status/since.
- `countByOutletAndTime`: count overlapping reservations for capacity checks.
- `listTables`: may initially return `[]` unless a `Table` model is added; capacity enforcement then stays disabled, matching current memory behavior.

## Concurrency and correctness requirements
- Overlap checks must run inside a transaction or use a database constraint to avoid double-booking under concurrent requests.
- `save` must be idempotent for retries with the same reservation id.
- All reads/writes must be scoped by `organizationId` (and `outletId` where provided) before returning data.
- RLS policies must be added/verified for the new table before production use.

## Migration safety
- Migration must be additive only: `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX`, and relation additions.
- No destructive SQL, no data backfill, no changes to existing tables.
- Apply only through the disposable/authorized database process documented in `docs/OA39-PGBOUNCER-DISPOSABLE-VALIDATION-PLAN.md` and `docs/OA40-RLS-VALIDATION-PREREQUISITES.md`.

## Runtime change after implementation
Once `PrismaReservations` exists and is tested:
1. Replace `new UnavailableReservations()` in `src/server/runtime.ts` production branch with `new PrismaReservations(db)`.
2. Keep `MemoryReservations` for demo.
3. Remove or retain `UnavailableReservations` as a fail-closed fallback only if `getPrisma()` is null.

## Evidence still required
- Disposable local PostgreSQL target (`hansan_test_*`, loopback only).
- `HANSAN_PG_TEST_ALLOW=DISPOSABLE-LOCAL-PG` authorization.
- Migration apply/status verification.
- RLS and PgBouncer pool behavior tests for the new table.
- Concurrency regression tests for overlapping reservations.
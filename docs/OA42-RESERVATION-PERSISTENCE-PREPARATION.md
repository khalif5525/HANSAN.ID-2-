# OA42 — Reservation Persistence Preparation

Code-only preparation. No Prisma schema, migration, database, or runtime production change is included.

## Architecture map

Request
-> Authentication (`requireAuth`, same-origin, role authorization)
-> Tenant/Outlet Resolution (`authCtx.actor.tenantId`, `actor.outletIds[0]`)
-> Idempotency gate (`runtime.idempotency.begin/complete/fail`)
-> Reservation Service (`ReservationService.createReservation/cancelReservation/completeReservation`)
-> Persistence Adapter (`ReservationPort`: MemoryReservations demo / UnavailableReservations production today)
-> Audit (`AuditLogPort.record`) + Idempotency completion

Production runtime currently returns `UnavailableReservations`, so reservation writes fail closed with `PERSISTENCE_NOT_CONFIGURED`.

## Adapter boundary (future `PrismaReservations`)

Implement `ReservationPort` only. Do not add a production adapter until the Prisma `Reservation` model exists. Required method mapping:

- `findById(id, scope)`: `prisma.reservation.findFirst({ where: { id, organizationId: scope.organizationId, ...(scope.outletId ? { outletId: scope.outletId } : {}) } })`, tenant GUC pinned first.
- `save(reservation)`: upsert by `id`; create on first write, update mutable fields on transition; include `organizationId`, `outletId`, `dataScope`.
- `listByOutlet(outletId, options)`: filter by outlet and optional status/since; pin tenant GUC using outlet's organization.
- `listByTenant(tenantId, options)`: filter by organization and optional status/since.
- `countByOutletAndTime(outletId, reservationAt, durationMinutes)`: count overlapping occupying statuses (`PENDING`, `CONFIRMED`) with half-open interval overlap.
- `listTables(outletId)`: return `[]` until a `Table` model is approved; capacity enforcement remains disabled.

## Transaction and concurrency strategy

- Availability and save must occur in one tenant-pinned interactive transaction.
- Pin GUCs first (`pinTenantContext`) in the same transaction.
- Use either serializable isolation or an advisory lock keyed by outlet/time for the overlap check.
- Retry transaction conflicts with bounded exponential backoff; surface `SLOT_UNAVAILABLE` when capacity is exhausted.
- Audit and idempotency completion should ride the same transaction where the adapter transaction API allows it, matching `PrismaOrders`.

## Tenant isolation and RLS

- App layer remains primary: revalidated actor, adapter `WHERE organizationId`, outlet authorization.
- Transaction GUCs: `app.organization_id`, `app.outlet_id`, `app.role`, `app.data_scope`.
- RLS table policy for `Reservation` must be added to `prisma/rls-tenant-isolation.sql` before production use.
- Do not claim RLS protection until policies exist and are tested against disposable PostgreSQL.

## Idempotency and audit

- Route-level idempotency remains authoritative for replay/conflict.
- Service-generated reservation id is not an idempotency key; route replay returns the stored response.
- Retrying cancellation with a completed reservation should return the existing cancelled reservation or a defined no-op, not duplicate audit events.
- Audit write failure must fail the operation closed; reservation and audit should be atomic in the future Prisma implementation.
- Reuse of an idempotency key with a different payload returns conflict (`409`).

## Schema requirements (not implemented)

See `docs/OA41-RESERVATION-PERSISTENCE-PROPOSAL.md`. Additive only: `ReservationStatus` enum, `Reservation` model, relation additions, indexes. A separate `Table` model is optional and requires business approval before capacity enforcement.

## Contract tests

`tests/reservation-port-contract.test.ts` exercises `MemoryReservations` against the `ReservationPort` contract. It is a baseline only and does not imply production persistence readiness.

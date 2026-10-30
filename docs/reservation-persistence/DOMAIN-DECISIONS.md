# HANSAN — Reservation Domain Decisions

**Branch:** `release/hansan-c1-c3-ci-validation`  
**HEAD:** `7c69d835ca93ff4f94e5c91b075d7a675f9c32f4`  
**Scope:** Additive reservation persistence preparation. No production database was changed by this document.

## 1. Decision summary

Selected design: **OA41 simplified `Reservation` model + Phase C2 service contract** (`src/domain/reservations/service.ts`).

This is the smallest consistent model that matches the existing implemented route, service, adapter boundary, tests, and `ReservationPort` contract. The richer Phase A7 customer/table/floor model (`src/domain/customers/ports.ts`, `src/domain/customers/reservations.ts`) remains an alternative and is not reconciled into production schema yet.

## 2. Selected model

- Reservation fields follow OA41 exactly:
  - `id`, `organizationId`, `outletId`, `dataScope`
  - `customerName`, `customerEmail`, `customerPhone`
  - `partySize`, `reservationAt`, `durationMinutes`
  - `status`, `tableId?`, `area?`, `notes?`
  - `createdBy`, `createdAt`, `updatedAt`
- No `Table`, `Floor`, or `Customer` Prisma models are added in this phase.
- `tableId` remains an optional denormalized string. `listTables()` returns `[]`, so capacity enforcement stays disabled, matching current memory behavior.
- Customer data is denormalized contact data on `Reservation`; no customer ownership linkage is introduced yet.

## 3. Status lifecycle

Selected statuses (uppercase, OA41/C2):

- `PENDING`
- `CONFIRMED`
- `CANCELLED`
- `EXPIRED`
- `COMPLETED`

Selected transitions (current service behavior):

- Create -> `CONFIRMED`
- `CONFIRMED` -> `CANCELLED`
- `CONFIRMED` -> `COMPLETED`
- Terminal states: `CANCELLED`, `EXPIRED`, `COMPLETED`

`PENDING` is retained for compatibility with the port/status list but the current creation path writes `CONFIRMED`. `EXPIRED` is not currently auto-derived.

## 4. Alternatives considered

1. **Phase A7 richer model**
   - Pros: richer lifecycle (`pending`, `confirmed`, `seated`, `completed`, `cancelled`, `no_show`), table/floor/customer ownership, table capacity validation.
   - Cons: incompatible with current route/service/tests and would require a larger, riskier schema and API rewrite.
   - Decision: deferred as an owner decision.

2. **Outlet-capacity enforcement now**
   - Pros: stronger booking protection.
   - Cons: no `Table` model exists; implementing partial capacity would invent business rules.
   - Decision: disabled, matching OA42.

3. **Lowercase status strings**
   - Pros: matches Phase A7.
   - Cons: breaks existing C2 tests and service.
   - Decision: uppercase retained.

## 5. Compatibility requirements

- `ReservationPort` in `src/domain/reservations/service.ts` remains authoritative.
- `MemoryReservations` remains demo-only and unchanged in behavior.
- Production remains fail-closed until `PrismaReservations` is implemented and verified.
- All existing reservation tests must continue to pass without weakening assertions.

## 6. Security implications

- Tenant isolation remains app-layer first: revalidated actor, adapter `WHERE organizationId`, outlet authorization.
- RLS policy for `Reservation` is not claimed until added to `prisma/rls-tenant-isolation.sql` and tested on disposable PostgreSQL.
- `createdBy` is stored as a string without an FK in this phase, matching OA41.
- No customer-authenticated access or customer IDOR handling is implemented yet because no Customer model/link exists.

## 7. Unresolved owner decisions

- Whether to adopt Phase A7 lifecycle (`seated`, `no_show`) and transitions.
- Whether to persist `Table`, `Floor`, and `Customer`.
- Whether table assignment validation is per-table or outlet-capacity based.
- Whether `EXPIRED` is system-derived or manually set.
- Whether to add a unique/idempotency constraint directly on `Reservation`.
- Whether to add PostgreSQL exclusion constraints for overlap prevention.
- Whether `createdBy` should reference `User.id`.
- Whether `customerEmail` should be normalized/indexed.
- Whether soft-delete or cancellation-only lifecycle is required.
- Whether RLS should follow the Order pattern or a customer-access variant.
- Whether `listByOutlet` should enforce tenant pinning using the outlet's organization in the port signature.
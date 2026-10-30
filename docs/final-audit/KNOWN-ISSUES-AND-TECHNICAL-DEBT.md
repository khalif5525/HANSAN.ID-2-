# HANSAN V2 — Known Issues and Technical Debt

## Known blocker re-verification

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Reservation/Table/Floor/Customer Prisma models incomplete | PARTIALLY RESOLVED | `Reservation` model now exists; `Table`, `Floor`, `Customer` models still absent. `Reservation.tableId` is a string, not FK. |
| 2 | OA41 vs A7 model conflict | PARTIALLY RESOLVED | Reservation persistence adapter and Prisma model now exist; migration untracked; docs still reference older fail-closed state. |
| 3 | Production `UnavailableReservations` returns 503 | PARTIALLY RESOLVED | Current `runtime.ts` uses `PrismaReservations` for live sessions; `UnavailableReservations` remains as fallback class. Historical docs still say 503. |
| 4 | Demo outlet-enforcement gap | PARTIALLY RESOLVED | `assertDemoScope` blocks demo-to-production; demo sandbox is process-local. Outlet-level enforcement in demo not DB-backed. |
| 5 | No adequate RLS | PARTIALLY RESOLVED | `prisma/rls-tenant-isolation.sql` covers 15+ tables; marked reviewable/not applied; not verified live. |
| 6 | No verified transactional overlap protection | STILL OPEN | Reservation overlap is application-level count; no DB constraint/locking verified. |
| 7 | Incomplete reservation flows | PARTIALLY RESOLVED | Create verified; cancel/complete service methods exist but no verified routes/tests. |
| 8 | Order lifecycle lacks full completion/cancellation/refund authority | PARTIALLY VERIFIED | Order creation and refund request verified; full completion/cancellation/refund settlement not fully verified. |
| 9 | Payment gateway and settlement authority unavailable | STILL OPEN | Mock provider only; health reports payments not-configured. |
| 10 | Offline POS unverified | NOT VERIFIED | No offline verification found. |
| 11 | In-memory simulation modules | STILL OPEN | Memory adapters remain for demo/tests; production uses Prisma where configured. |
| 12 | Untracked scripts reading service-role key | RESOLVED (current scan) | No untracked script reading service-role key found; `.env` hygiene issue remains. |

## Additional technical debt

1. Rate limiter is in-memory and per-instance.
2. `.env` contains malformed/raw credential lines.
3. `NUL`, `AppData/`, `tmp_*`, `flaky_run_*` local artifacts present.
4. Untracked reservation migration not applied/verified.
5. Header comment in `reservation-adapter.ts` is stale (claims no Reservation model).
6. `listTables` returns empty array; no persisted table capacity.
7. No Customer/Table/Floor models.
8. No E2E suite executed.
9. Build output `.next/` present locally.
10. Live PostgreSQL tests not run.
11. Some historical docs are outdated relative to current untracked implementation.

## Non-blocking but important

- CI workflow evidence: latest remote run status not verified here.
- No production deployment performed during audit.
- No database migration applied during audit.

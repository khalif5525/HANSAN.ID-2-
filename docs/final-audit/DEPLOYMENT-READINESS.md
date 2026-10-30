# HANSAN V2 — Deployment Readiness

## 1. Readiness classification

**DEMO READY WITH LIMITATIONS** (not production ready).

## 2. Ready components

- Typecheck, lint, unit tests, and production build pass.
- Authentication fail-closed behavior implemented.
- RBAC and tenant/outlet assertions implemented.
- Order creation with server-authoritative pricing and idempotency.
- Refund request flow with validation.
- Demo sandbox isolation.
- Prisma schema validates.

## 3. Not ready for production

- Live database migration consistency not verified.
- RLS not applied/verified.
- Payment gateway not configured.
- Offline POS not verified.
- Reservation persistence not fully verified against live DB.
- No Table/Floor/Customer models.
- Rate limiting is in-memory.
- Environment hygiene issue in `.env`.

## 4. Required before production

1. Reachable PostgreSQL + successful `prisma migrate status`.
2. Apply and verify RLS in disposable DB.
3. Run live PG test lane.
4. Configure production `SESSION_SECRET`.
5. Configure real payment provider and webhook verification.
6. Remediate `.env` and rotate any exposed credentials.
7. Commit reviewed changes through normal Git workflow.
8. Obtain green CI run.

## 5. Demo deployment

Demo mode can run with in-memory sandbox and demo session secret, but must not
be treated as production. Demo data must never be used for financial reporting.

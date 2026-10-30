# HANSAN V2 — Repository Audit

## 1. Repository identity

| Item | Value |
|---|---|
| Expected remote | `https://github.com/khaliffatturrozy-arch/HANSAN.ID-2-.git` |
| Actual remote (fetch/push) | `https://github.com/khaliffatturrozy-arch/HANSAN.ID-2-.git` |
| Active branch | `release/hansan-c1-c3-ci-validation` |
| Baseline branch | `release/hansan-c1-c3-ci-validation` |
| Actual HEAD | `7c69d835ca93ff4f94e5c91b075d7a675f9c32f4` |
| Baseline HEAD | `7c69d835ca93ff4f94e5c91b075d7a675f9c32f4` |
| Last commit | `7c69d83 docs: add CI stabilization and OA11-OA18 audit trail` |
| HEAD vs baseline | Identical |

Conclusion: repository identity matches HANSAN V2 expected baseline.

## 2. Git status (read-only snapshot)

Modified tracked files (18):
- `.github/workflows/ci.yml`
- `package.json`
- `prisma/migrations/migration_lock.toml`
- `prisma/rls-tenant-isolation.sql`
- `prisma/schema.prisma`
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

Untracked files/directories (selected):
- `.cline/`
- `AppData/` (local disposable artifact, gitignored by `/AppData/`)
- `NUL` (accidental Windows artifact)
- `docs/OA20-*`, `docs/OA21-*`, `docs/OA39-*`, `docs/OA40-*`, `docs/OA41-*`, `docs/OA42-*`
- `docs/TEST-WORKFLOW.md`
- `docs/reservation-persistence/`
- `fix_route.txt`, `flaky_run_*.txt`, `tmp_*`
- `run-hansan-local.bat`
- `prisma/migrations/20261028110457_reservation_persistence/`
- `src/app/api/customer/`
- `src/domain/payments/`
- `src/domain/reservations/`
- `src/server/db/reservation-adapter.ts`
- many new tests and helpers
- `vitest.live-pg.config.ts`

These untracked files represent in-progress reservation persistence work and
local audit artifacts. They were not committed during this audit.

## 3. Stack

- Next.js `14.2.35` (App Router)
- React `18`
- TypeScript `5`
- Tailwind CSS `3.4.1`
- Prisma `5.22.0`
- Vitest `2.1.9`
- Supabase SSR / Supabase JS

## 4. Top-level structure

- `src/app` — Next.js App Router pages and API routes
- `src/components` — UI components
- `src/config` — environment and tax config
- `src/domain` — domain logic and ports
- `src/server` — server adapters, auth, runtime composition
- `src/types` — shared types
- `prisma` — schema, migrations, SQL artifacts
- `tests` — unit/integration tests
- `docs` — historical and audit documentation

## 5. Route inventory (API)

- `admin/provision-developer`
- `admin/provision-owner`
- `auth/live`
- `auth/session`
- `auth/sign-in`
- `auth/signout`
- `customer/orders`
- `customer/reservations`
- `health`
- `orders`
- `orders/[id]`
- `refunds`
- `refunds/[id]`
- `staff/invite`

## 6. Frontend surfaces

Pages exist for HQ, POS, KDS (all/bar/completed/priority), Finance, Developer,
Login. No separate public customer page route was found; customer-facing
functionality is exposed via API endpoints (`/api/customer/*`).

## 7. Notable working-tree risk

- `.env` exists locally and is gitignored, but contains malformed/raw credential
  lines (see `SECURITY-AUDIT.md`).
- `NUL` and `AppData/` local artifacts exist and should not be committed.
- Untracked implementation files are substantial and not yet committed.

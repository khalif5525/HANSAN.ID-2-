# HANSAN — Production Readiness

Status snapshot derived from **actual repository inspection**. **Current baseline:
release/hansan-c1-c3-ci-validation @ `17d9906` (C1 `4042959`, C2 `91fbbef`, C3
`17d9906`)** — verified against code and test results. The original snapshot
(branch `main` @ `1bf82a4` + uncommitted UI refinements, Phase 1 of the Production
Readiness Autopilot) is **historical**; rows below that still describe that era are
marked *(pre-C1 — superseded)*. Updated by the CI-stabilization batch (see
`docs/AUTOPILOT-CI-STABILIZATION-20261015.md`).

Legend for feature status:

- **UI-only** — page renders; no server call, no domain wiring.
- **Implemented locally** — domain logic exists and is unit-tested, in-memory only.
- **Persisted through backend** — writes/reads a real database via a port adapter.
- **Integration-tested** — exercised against a disposable database or API harness.
- **Production-verified** — confirmed live on the deployed environment.

---

## Feature status map

| Feature | Domain logic | UI | Persistence | Integration tests | Production | Notes |
|---|---|---|---|---|---|---|
| POS order flow | Implemented locally (A2: `src/domain/pos/*`, unit tests) | Menu selection still local (§4); order placement via `/pos/*` | **Persisted through backend (C1): `/api/orders` + `/api/orders/[id]` call `PosService` server-authoritatively** (authZ, idempotency, rate-limit) | local service tests only (`pos-order`, `payment-lifecycle`) | ❌ | Menu/catalog API route still absent; no live DB exercised |
| Kitchen KDS | Implemented locally (A3 + `aggregate.ts`) | UI-only (ticket board renders empty) | ❌ None | ❌ | ❌ | Station routing lives on `OrderLine.station` |
| Bar KDS | Implemented locally (same) | UI-only | ❌ None | ❌ | ❌ | Explicit `bar` station, never name-inferred |
| Checker / aggregate | Implemented locally (`kds/aggregate.ts`, tested) | UI-only | Derived at read time | ❌ | ❌ | Aggregate derived from persisted item states once persisted |
| Inventory | Implemented locally (A4, unit tests) | UI-only | ❌ None | ❌ | ❌ | Movements + race guard in memory double |
| Recipes / units | Implemented locally (`inventory/recipes.ts`, `units.ts`) | UI-only | ❌ | ❌ | ❌ | g/kg/ml/l/pc explicit |
| Workforce | Implemented locally (A6) | UI-only | ❌ | ❌ | ❌ | |
| Finance | Implemented locally (A5, refund separation-of-duties tested) | UI-only | ❌ | ❌ | ❌ | Totals derive from records when records exist |
| Settlement | Rules partially in `finance/rules.ts` | UI-only (`/finance/settlement`, uncommitted) | ❌ | ❌ | ❌ | Batch/approval persistence not built |
| Owner / HQ | Aggregations implemented locally (A8) | UI-only (honest zero states) | ❌ | ❌ | ❌ | |
| Developer | Health endpoint exists (`/api/health`) | UI-only | n/a | ❌ | ❌ | |
| Customer ordering | Implemented locally (A7) | UI-only | ❌ | ❌ | ❌ | |
| **Authentication** | Signed-cookie session + Supabase Auth routes (C1), unit-tested (`auth-session`, `live-session`); live provider blocked on BLOCKER-001 | Login page | Fail-closed 503 without `SESSION_SECRET`; **not production-verified** | ❌ live | ❌ | NOT production auth until verified live |
| **Authorization** | RBAC core implemented + unit-tested (A9/A10); **server-side `requireAuth`/`authorize` + middleware exist (C1)** | Sidebar visibility | Enforced on API routes; **not exercised on a live deployment** | unit only | ❌ | Staging exercise pending |
| Rate limiting | In-memory fixed window (`src/server/rate-limit.ts`) | n/a | Per-instance only | unit only | ❌ | Documented limitation |

## P0 — critical security / data-loss / tenant-isolation / financial-integrity

| ID | Finding | Evidence | Target phase |
|---|---|---|---|
| P0-1 | ~~No server-side authorization~~ **Resolved locally (C1), NOT live-verified:** `src/middleware.ts` gates workspaces fail-closed on signed session cookies; `requireAuth`/`authorize` enforced server-side on API routes (e.g., `src/app/api/orders/route.ts`); RBAC unit-tested. | `src/middleware.ts`, `src/server/authz.ts`, OA6 gate results (local) | Implemented + locally tested; staging/live exercise pending |
| P0-2 | ~~No production authentication~~ **Partially resolved locally (C1), NOT production-verified:** signed-session cookies + Supabase Auth routes (`/api/auth/sign-in`, `/session`, `/live`, `/signout`) implemented and unit-tested (`auth-session`, `live-session`); production fails closed (503) without `SESSION_SECRET`; real provider credentials still BLOCKED (BLOCKER-001). The legacy localStorage dev session (`src/lib/dev-session.ts`) is never promoted to production auth. | `src/server/auth/*`, `tests/auth-session.test.ts`, `docs/MANUAL-BLOCKERS.md` | Live auth verification pending BLOCKER-001 |
| P0-3 | ~~No tenant/outlet enforcement at any boundary~~ **Resolved locally (C1), NOT live-verified:** scoped callers + `withTenantTransaction` GUC pinning + fail-closed `requireTenantContext` (`src/server/db/tenant-context.ts`, `src/domain/shared/tenant-scope.ts`); cross-tenant denial unit-tested (`tenant-isolation` 13, `phase12-scoped-callers` 13). RLS not active on any live database; pooled behavior unverified. | local tests (OA6), `prisma/rls-tenant-isolation.sql` (unapplied artifact) | Staging RLS gate G1–G9 pending |
| P0-4 | ~~No persistence layer~~ **Resolved locally (C1), NOT migrated anywhere:** `prisma/schema.prisma` (19 models) + committed migration `20261009000000_init` (unapplied to any remote database) + Prisma port adapters (`src/server/db/*-adapter.ts`); persistence tests pass locally (`phase-a-persistence`, `pos-order`). | local tests (OA6) | Migration to staging pending proven-staging gate |
| P0-5 | Demo/production data separation **designed and locally tested (C1 artifacts)**: `prisma/rls-demo-isolation.sql` + tenant scoping unit-tested. **NOT enforced in any live environment until owner-authorized RLS activation (gate G1–G9).** | `prisma/rls-demo-isolation.sql`, `tests/tenant-isolation.test.ts` | RLS gate |

## P1 — blockers to core operational workflows

| ID | Finding | Target phase |
|---|---|---|
| P1-1 | No order-creation API (transactional parent + items, idempotency). | Phase 4 |
| P1-2 | No KDS/Checker read-write API; no station-scoped progress persistence. | Phase 5 |
| P1-3 | No inventory movement API tied to the order lifecycle. | Phase 6 |
| P1-4 | No finance/settlement persistence; totals cannot derive from records. | Phase 7 |
| P1-5 | UI never calls the domain layer — pages are static shells. | Phases 4–5 (wire POS/KDS first) |

## P2 — required operational improvements

| ID | Finding | Target phase |
|---|---|---|
| P2-1 | Health endpoint reports static "Phase 0" strings; no env/db reality check. | Phase 10 |
| P2-2 | Rate limiter is per-instance (documented); needs a shared store before strict limits. | Phase 8 |
| P2-3 | No structured request logging / error monitoring integration. | Phase 8 |
| P2-4 | Backup/recovery runbook **written** (`docs/PHASE-16-STAGING-INFRASTRUCTURE-PREPARATION.md` §4.2); **no backup has ever been created or restored — evidence NONE (gate G2 blocked)**. | PHASE-16 §4.2 | Staging execution pending |
| P2-5 | `npm audit`: 2 advisories in Next-bundled PostCSS; only fix is breaking `next@16` — **not** to be applied blindly. | Phase 8 (assess, do not force) |
| P2-6 | CI workflow **exists** (C2: `.github/workflows/ci.yml`, secret-free, `contents: read`). **Run #1 (PR #1, Oct 15 2026) FAILED** at `npm ci` (npm-10 lockfile validation: missing `@emnapi/core`/`@emnapi/runtime` entries). **Local fix prepared (uncommitted): Node 22 workflow alignment + lockfile regenerated under Node 22.23.3/npm 10.9.9; `npm ci` + all 5 gates pass locally on the CI runtime class. CI result remains FAILING until the fix is pushed and an Actions run is observed green.** | Actions run #1 (failed), `docs/AUTOPILOT-CI-STABILIZATION-20261015.md` | Owner push + observed green run |

## P3 — later enhancements

- Real-time KDS sync (WebSocket/SSE) — until then a documented polling refresh.
- Shared-store rate limiting (Redis/Upstash).
- Payment gateway integration (BLOCKER-005), marketplace/delivery adapters.
- Accessibility pass beyond current keyboard/focus support.

---

## Known constraint gates (cannot be resolved by code alone)

1. **BLOCKER-001** Supabase Auth credentials → real login/sessions.
2. **BLOCKER-002** `DATABASE_URL` → first migration, live adapters.
3. **BLOCKER-003** Vercel project linkage details → automated deploy verification.
4. **BLOCKER-005** Payment/delivery merchant credentials.

Until those exist, this document and `/api/health` report only honest states.
No capability is marked *Persisted* / *Integration-tested* / *Production-verified*
unless this session's validation proves it.


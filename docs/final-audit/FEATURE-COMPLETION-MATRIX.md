# HANSAN V2 — Feature Completion Matrix

Status legend:
- **VERIFIED** — implementation plus test/build evidence
- **PARTIALLY VERIFIED** — partial implementation or partial test evidence
- **NOT VERIFIED** — code may exist but insufficient evidence
- **BLOCKED** — cannot run due to dependency/blocker

## Frontend

| Feature | Status | Evidence |
|---|---|---|
| HQ dashboard shell | PARTIALLY VERIFIED | Pages exist; no comprehensive E2E |
| POS terminal flow | PARTIALLY VERIFIED | Pages + demo sandbox tests |
| KDS Kitchen | PARTIALLY VERIFIED | Pages + aggregate/ticket tests |
| KDS Bar | PARTIALLY VERIFIED | Page exists; station routing tested |
| Finance UI | PARTIALLY VERIFIED | Pages exist; finance service tests |
| Developer console | PARTIALLY VERIFIED | Pages exist; limited verification |
| Login/auth flow | PARTIALLY VERIFIED | Auth session tests |
| Public/customer pages | NOT VERIFIED | No public page route; API only |

## Backend / API

| Feature | Status | Evidence |
|---|---|---|
| Order creation API | VERIFIED | `tests/pos-order.test.ts`, `customer-orders-route.test.ts` |
| Order history API | VERIFIED | `tests/history-since-iso.test.ts` |
| Refund request API | VERIFIED | `tests/refund-route.test.ts` |
| Refund approval/completion | PARTIALLY VERIFIED | Finance service; no full gateway |
| Customer reservation API (POST) | VERIFIED | `tests/customer-reservations-route.test.ts` |
| Reservation cancel/complete API | NOT VERIFIED | Service methods exist, no route wiring/tests |
| Health endpoint | VERIFIED | `tests/health-route.test.ts` |
| Provisioning APIs | PARTIALLY VERIFIED | `tests/provisioning.test.ts` |
| Staff invite | PARTIALLY VERIFIED | Route exists; limited tests |
| Rate limiting | PARTIALLY VERIFIED | In-memory; tests present |
| Idempotency | VERIFIED | `tests/idempotency*.test.ts` |

## Domain / business logic

| Feature | Status | Evidence |
|---|---|---|
| POS cart/state | VERIFIED | `tests/pos-cart-state.test.ts`, `pos-order-state.test.ts` |
| POS rules | VERIFIED | `tests/pos-rules.test.ts` |
| KDS state machine | VERIFIED | `tests/kds.test.ts`, `kds-tickets.test.ts` |
| KDS aggregation | VERIFIED | `tests/kds-aggregate.test.ts` |
| Payment state machine | VERIFIED | `tests/payment-lifecycle.test.ts` |
| Refund rules | VERIFIED | `tests/refund-rules.test.ts` |
| Inventory/recipes | VERIFIED | `tests/inventory.test.ts` |
| Customers/reservations logic | VERIFIED | `tests/customers.test.ts` |
| Reservation overlap logic | VERIFIED | `tests/reservation-overlap.test.ts` |
| Finance service | VERIFIED | `tests/finance-service.test.ts` |
| Analytics | VERIFIED | `tests/analytics.test.ts` |
| Workforce | PARTIALLY VERIFIED | Domain exists; fewer tests |
| Audit events | VERIFIED | `tests/audit-rate-limit.test.ts` |

## Database / persistence

| Feature | Status | Evidence |
|---|---|---|
| Prisma schema validity | VERIFIED | `prisma validate` PASS |
| Order persistence | VERIFIED | Adapter + tests |
| Payment persistence | VERIFIED | Adapter + tests |
| Refund persistence | VERIFIED | Adapter + tests |
| Finance persistence | VERIFIED | Adapter + tests |
| Reservation persistence (Prisma) | PARTIALLY VERIFIED | Untracked adapter + migration; DB unavailable |
| RLS application | NOT VERIFIED | SQL artifact only |
| Migration consistency | BLOCKED | DB unreachable |

## Integrations

| Feature | Status | Evidence |
|---|---|---|
| Payment gateway | NOT VERIFIED | Mock provider only |
| Settlement authority | PARTIALLY VERIFIED | Domain + adapter; no external settlement |
| Inventory external | NOT VERIFIED | No external integration verified |
| Customer channel | PARTIALLY VERIFIED | API only |
| Offline POS | NOT VERIFIED | No offline verification |
| Supabase Auth | PARTIALLY VERIFIED | Config + session tests; production config not verified |

## Security

| Feature | Status | Evidence |
|---|---|---|
| Auth fail-closed | VERIFIED | `tests/authz.test.ts` |
| RBAC | VERIFIED | `tests/authz.test.ts` |
| Tenant isolation (app) | VERIFIED | `tests/tenant-isolation.test.ts` |
| Demo isolation | VERIFIED | `tests/authz.test.ts` |
| RLS (DB) | NOT VERIFIED | Artifact only |
| Rate limiting (global) | PARTIALLY VERIFIED | In-memory |
| Secret exposure prevention | VERIFIED | `tests/supabase-clients.test.ts` |
| Environment hygiene | PARTIALLY VERIFIED | `.env` malformed raw lines found |

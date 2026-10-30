## OA20.2 Staging prerequisites matrix

| # | Prerequisite | Status | Evidence available | Missing prerequisite | Owner | Safe next action |
|---|---|---|---|---|---|---|
| S1 | Dedicated staging Supabase project | BLOCKED | None locally | Owner-provisioned project + project-ref | Owner | Provision staging project; record only project-ref/region |
| S2 | Safe project/DB target identity | NOT VERIFIED | `.env.example` names; schema `DATABASE_URL`/`DIRECT_URL` roles | Non-secret identity procedure (project-ref, host pattern, port 6543/5432 roles) | Owner | Owner confirms target identity out-of-band; agent never prints URLs |
| S3 | Backup creation + restore rehearsal | BLOCKED | None locally | Staging backup + documented restore drill | Owner | Run backup/restore drill on staging; attach timestamps only |
| S4 | Migration baseline + schema drift check | READY (design) / BLOCKED (execution) | Single init migration `20261009000000_init`; `prisma validate` schema-only | Staging `migrate status` against the staging target | Owner | Owner runs `prisma migrate status` on staging; agent reviews output |
| S5 | PG transaction + audit rollback (PG-1) | READY (code) / BLOCKED (evidence) | Code review: `transitionRefundWithAudit` single `$transaction`; mocked tests OA17 | LOCAL-PG run, then staging run | Owner+Agent | Run opt-in harness locally once disposable PG exists; then staging |
| S6 | Concurrent refund decision (PG-2) | READY (code) / BLOCKED (evidence) | Code review: conditional `update where {id, org, status}`; mocked conflict test | LOCAL-PG concurrency run, then staging | Owner+Agent | Same as S5 |
| S7 | Cross-tenant isolation + indistinguishable 404 (PG-3) | READY (code) / BLOCKED (evidence) | Code review: scoped `getRefund(id, org)` + non-leaking 404; mocked tests | LOCAL-PG + staging runs incl. nonexistent-id control | Owner+Agent | Same as S5 |
| S8 | Tenant GUC/RLS across pooled connections (PG-4) | READY (review) / BLOCKED (runtime) | Review: `SET LOCAL` first-in-tx, fail-closed `current_setting(k,false)`; SET LOCAL dies with tx | LOCAL-PG reuse/pool test, then staging | Owner+Agent | Run FIRST (gates all other PG evidence); then staging |
| S9 | Multi-instance idempotency (PG-5) | READY (code) / BLOCKED (evidence) | Code review: unique `(org, scope, key)`; mocked single-instance tests | Two-instance LOCAL-PG run, then staging | Owner+Agent | Run after PG-4/PG-1/PG-2; then staging |
| S10 | Duplicate audit-event prevention (PG-6) | READY (code) / BLOCKED (evidence) | Code review: audit insert inside same tx; mocked no-dup test | LOCAL-PG + staging full-lifecycle run | Owner+Agent | Run after PG-2; then staging |
| S11 | Monitoring, rollback, owner sign-off | BLOCKED | None locally | G8/G9 sign-off + monitoring acceptance | Owner | Owner records explicit go/no-go |
| S12 | CI freshness on release SHA | NOT VERIFIED | OA19 GREEN report on `7c69d83`; `gh` unavailable in OA20 | Owner-visible fresh run status on PR #1 | Owner | Owner confirms latest run GREEN on `7c69d83` in PR #1 Checks tab |

Legend: READY = code/design reviewed locally. BLOCKED = needs owner
infra/secret/approval. NOT VERIFIED = cannot confirm without fresh remote
evidence. PASS is reserved for post-execution verified results — none claimed.

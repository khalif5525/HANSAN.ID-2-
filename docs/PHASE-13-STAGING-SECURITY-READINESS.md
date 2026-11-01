# HANSAN — PHASE 13: STAGING SECURITY VERIFICATION PREPARATION
SECTION1
## 1. Baseline and Git status
### 1a. Git state
| Branch | main |
| Modified tracked files | 48 (all preserved from prior phases; no resets, cleans, or overwrites) |
| Property | Value |
| Upstream | origin/main — 0 ahead / 0 behind (verified git merge-base --is-ancestor) |
| HEAD | 1bf82a404fb6a02a12db3d2eb73349403538b934 |
| Staged changes | None (git diff --cached empty) |
| Git operations this phase | None (no stage, commit, push, merge, stash, checkout, reset, clean, or deploy) |
| Untracked files | 81 (Phase 8-12 SQL artifacts, reports, API routes, server modules, tests, config) |
### 1c. Local validation (read-only, no DB)
| Command | Result | Exit code |
| npm run lint | CLEAN, 0 warnings/errors (Phase 12 baseline) | 0 |
| npm run typecheck | CLEAN (Phase 12 baseline; no code changed in this session) | 0 |
| npm test | 284 tests passing (Phase 12 baseline; 30 test files) | 0 |
| npm run build | CLEAN Next 14.2.35 (Phase 12 baseline) | 0 |
| npm run db:validate | The schema at prisma\schema.prisma is valid | 0 |

## 2. Staging environment inventory
| Staging branch / PR | MISSING | No staging branch exists |
| Backup / restore evidence | MISSING | No backup scripts or restore procedures in repo |
| Item | Found? | Evidence |
| Dedicated staging Supabase project | MISSING | No staging project config; all Supabase env values are placeholders in .env.example |
| CI/CD workflow | MISSING | .github/workflows/ does not exist (repo has only .github/agents/). No automated gate |
| Staging application config | MISSING | src/config/environment.ts reads NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, DATABASE_URL, DIRECT_URL, SESSION_SECRET from env; all unset on this machine |
| Staging credentials / access | UNAVAILABLE | No staging credentials in repo; no provisioning secrets set |
| .env (local, gitignored) | Present (1218 bytes) — not tracked, git ls-files --others --ignored confirms; do not read (may contain local secrets) |
| Dedicated staging database | MISSING | .env.example shows DATABASE_URL/DIRECT_URL = postgresql://<user>@<pooler-host>:6543/postgres (placeholder). No live staging env vars set |
| Var | Code boundary | Presence on this machine | Note |
| NEXT_PUBLIC_SUPABASE_URL | src/config/environment.ts | Unset (placeholder only) | hasSupabaseAuth() returns false |

## 3. RLS table, policy, and index review
| SUPABASE_SECRET_KEY | src/server/config/secrets.ts | Unset | createAdminClient throws on missing |
| SESSION_SECRET | src/config/environment.ts | Unset | Production fails closed (503) when missing |
| DATABASE_URL | prisma/schema.prisma datasource.db.url | Unset | getConfig().databaseUrl null, getPrisma null, 503 path |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | src/config/environment.ts | Unset | createClient and createServerClient throw on missing |
| DIRECT_URL | prisma/schema.prisma datasource.db.directUrl | Unset | Migrations and admin only |
| Table | Rows | RLS | Policy count | Notes |
| Order | parent | ON + FORCE | 3 (select/insert/update) | No DELETE (cancel/refund lifecycle) |
### 3b. Table / policy coverage matrix
| Table | Rows | RLS | Policy count | Notes |
| Order | parent | ON + FORCE | 3 (select/insert/update) | No DELETE (cancel/refund lifecycle) |
| Payment | parent | ON + FORCE | 3 |
| InventoryMovement | append-only | ON + FORCE | 2 (select/insert) | No UPDATE/DELETE |
| Approval | parent | ON + FORCE | 2 (select/insert) |
| Outlet | identity | OFF by design | 0 |
| Membership | identity | OFF by design | 0 |
| SequenceCounter | parent | ON + FORCE | 1 (via Outlet.outletId EXISTS-join) |
| User | identity | OFF by design | 0 |


## 3c. RLS policy review checklist

| Criterion | Status |
|---|---|
| Every tenant-owned table accounted for | ✅ 15 tenant tables + 4 identity tables documented |
| Parent-derived policies | ✅ OrderItem, RecipeItem, SequenceCounter use EXISTS/joins |
| Policies fail closed when tenant context absent | ✅ current_setting(key, false) throws on unset GUC |
| App role not superuser / no BYPASSRLS | ✅ Tested on disposable PG (hansan_app); NOT verified remotely |
| Required indexes exist | ❌ NONE applied (see §3d) |
| Adapters pin tenant in same transaction | ✅ withTenantTransaction / pinTenantContext pin-first (Phase 11/12) |
| SET LOCAL cannot leak across pooled transactions | ✅ Conceptually correct; NOT empirically proven under pooled PG |
| No unscoped production callers | ✅ Phase 12 resolved all 8 errors; production passes authCtx.actor.tenantId |

### 3d. Required indexes (§3c plan — NOT applied)

| Table group | Index key |
|---|---|
| Order, Payment, Refund, SettlementBatch | (organizationId, outletId) |
| MenuItem, MenuCategory, Ingredient, Recipe | (organizationId) |
| InventoryMovement, AuditEvent | (organizationId, occurredAt) |

### 3e. Role / privilege state

- Test role `hansan_app` (Phase 9): LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS, not table owner, ordinary table privileges only.
- No remote database available to confirm this for any live environment.

## 4. PgBouncer verification evidence

| Item | Finding |
|---|---|
| Local PgBouncer binary | NOT INSTALLED |
| Disposable local PostgreSQL | NONE |
| Test setup | DOES NOT EXIST in repo |
| Direct-PG vs pooling | Phase 9 direct-PG only; no pooling proof |

## 5. PostgreSQL isolation and query-plan results

| Check | Result | Evidence |
|---|---|---|
| SET LOCAL pin-first | Unit-verified | tests/tenant-isolation.test.ts |
| Direct-PG RLS 38/38 | PASS | Phase 9 rls-verify.sql |
| PgBouncer pooling | UNVERIFIED | No binary, no staging pooler |
| Parent-join EXPLAIN | UNVERIFIED | No disposable-PG run |
| CREATE INDEX CONCURRENTLY | NOT RUN | Planned follow-up |
| Cross-tenant isolation | NOT RUN | No disposable-PG run |

## 6. Backup / recovery and migration

| Item | Status |
|---|---|
| Migration files | 1 commit: 20261009000000_init |
| RLS SQL applied as migration | No — standalone artifact |
| Supporting index rollout | No — CONCURRENTLY planned |
| Backup / restore evidence | NONE |
| Rollback | Documented (DROP POLICY reverse + DISABLE RLS) |

## 7. Exact remaining blockers and owner actions

| # | Blocker | Owner action |
|---|---|---|
| B1 | No isolated staging DB | Provision isolated staging Supabase project |
| B2 | No CI/CD workflow | Add .github/workflows/ CI gate |
| B3 | No local PG/PgBouncer harness | Provision isolated disposable PG with PgBouncer |
| B4 | No backup/restore evidence | Produce backup + restore verification |
| B5 | Supporting indexes not applied | Apply CREATE INDEX CONCURRENTLY on staging |
| B6 | No SESSION_SECRET / staging config | Set SESSION_SECRET on staging app config |
| B7 | No Supabase identity project | Provision and configure staging Supabase project |

## 8. Safe next step

1. Provision isolated staging environment (B1, B2, B6, B7)
2. Add CI gate (B2)
3. Produce backup/restore evidence (B4)
4. Apply committed migration (NOT RLS) to staging; run read-only verification SQL
5. Apply supporting indexes (B5) via CREATE INDEX CONCURRENTLY on staging
6. Run PgBouncer pooling test T1 + cross-tenant isolation test T2
7. Apply prisma/rls-tenant-isolation.sql as review-gated, owner-approved step
8. Re-run RLS verification harness against staging

## 9. Final decision

# BLOCKED — STAGING SECURITY PREREQUISITES MISSING

Per the decision rule, READY FOR ISOLATED STAGING TESTS is only permitted when an
isolated staging environment AND the prerequisites for the intended tests are
actually available. This phase's inspection found none:
- No isolated staging database or project (§2)
- No staging application config or credentials (§2)
- No CI/CD gate (§2)
- No local PostgreSQL/PgBouncer binaries and no test harness (§4)
- No backup/restore evidence (§6)
- No supporting indexes applied (§3e)
- SESSION_SECRET / Supabase config all absent (§2)

Code-side contract is sound: RLS SQL reviewed and fail-closed, scoped-callers
migration complete, port/tenant-scope contracts in place. These are code-side
prerequisites, not environment prerequisites. The environment (staging DB, pooler,
credentials, CI, backup) is what is missing.

Evidence summary:
| Dimension | Result |
|---|---|
| Git / baseline | main @ 1bf82a4, 0 ahead/0 behind, 48 modified / 81 untracked |
| Phase 9-12 reports | All complete; carry-forward blockers B2/B3/B4 remain open |
| Local validation | db:validate PASS (exit 0); typecheck/lint/test/build PASS |
| Staging inventory | MISSING — no staging DB, no config, no CREDENTIALS, no CI, no backup |
| RLS review | 15 tenant tables fail-closed, parent-derived policies correct, no unscoped callers |
| PgBouncer | Unavailable — no binary, no harness; T1 still required |
| PostgreSQL isolation | Direct-PG evidence only; pooling + query-plan UNVERIFIED |
| Backup/recovery | NONE |
| Final decision | BLOCKED — STAGING SECURITY PREREQUISITES MISSING |

No secrets were read or printed. No remote database was written, migrated, or had
RLS activated. No Git operations were performed.

| SettlementBatch | parent | ON + FORCE | 3 |
| AuditEvent | parent | ON + FORCE | 2 (select/insert) | FORCE added |

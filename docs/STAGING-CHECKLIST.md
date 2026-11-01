# HANSAN — Staging Deployment Checklist

Pre-deployment readiness for a **staging** environment. Derived from live repository
inspection (`main` @ `1bf82a4`) plus this session's validation.

**Verified local state (updated by OA18):** branch `release/hansan-c1-c3-ci-validation` = local `main` = `17d9906` (C1→C2→C3); **working tree carries uncommitted OA11–OA18 work** (15 modified tracked files + 7 untracked entries — the "clean tree" claim from the C3 push is superseded); **3 ahead** of locally known `origin/main` (`1bf82a4`). The release branch has since been pushed by the owner and PR #1 exists; **CI Actions run #1 FAILED at `npm ci` — fix prepared locally, not yet pushed** (see `docs/AUTOPILOT-CI-STABILIZATION-20261015.md`). *(Historical: the original snapshot said branch `main` @ `1bf82a4`, 0 ahead/0 behind.)*

**Devops scope:** this checklist is for **staging only**. It never runs migrations, provisioners,
payments, or live data. All items marked ⚑ require owner credentials/approval.

---

## A. Local steps (dev machine)

| # | Step | Owner-credential needed? |
|---|------|--------------------------|
| A1 | Copy `.env.example` → `.env.local` (gitignored). | No — template only |
| A2 | Set `NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co` | ⚑ BLOCKER-001 (Supabase project access) |
| A3 | Set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (modern anon key). | ⚑ BLOCKER-001 |
| A4 | Set `SUPABASE_SECRET_KEY` (server-only, never client-visible). | ⚑ BLOCKER-001 (priviledged key) |
| A5 | Set `SESSION_SECRET` (>=32 chars; production-fail-closed). | ⚑ BLOCKER-001 |
| A6 | Set `DATABASE_URL` (pooler, port 6543) + `DIRECT_URL` (port 5432, migrations). | ⚑ BLOCKER-002 |
| A7 | (Optional) `HANSAN_PROVISION_SECRET`, `HANSAN_DEVELOPER_PROVISION_SECRET`. | ⚑ BLOCKER-001 |
| A8 | (Optional) `POS_TAX_PERCENT`, `QRIS_API_KEY`, `EDC_CONFIG`. | ⚑ Payments |

**Do not commit `.env.local` or any real secret.** `next/scripts` masks nothing; it is pre-existing.

## B. GitHub steps

| # | Step | Owner-credential needed? |
|---|------|--------------------------|
| B1 | **(Revised)** Push the **release branch** and open/maintain the PR → `main` for CI activation; **do not push `main` directly** as part of first activation. | No |
| B2 | **DONE (C2 `91fbbef`)** — `.github/workflows/ci.yml` runs `npm ci && npm run typecheck && npm run lint && npm test && npm run db:validate && npm run build` on PRs → `main` (+ `workflow_dispatch`). **Open item: first green run** — run #1 failed at `npm ci`; Node 22 + lockfile fix prepared locally, pending owner push. | No (repo change) |
| B3 | Create a staging branch/PR; enforce the CI gates before merging. | No |
| B4 | Ensure `next.config.mjs` headers (CSP, HSTS, X-Frame, Permissions-Policy) are untouched. | No |

> **Gap CLOSED (C2):** `.github/workflows/ci.yml` now exists with the full gate. Remaining gap is its **first observed green run** (owner push of the prepared fix; CI run #1 currently FAILING).

## C. Vercel configuration (staging)

| # | Step | Owner-credential needed? |
|---|------|--------------------------|
| C1 | Import repo `khaliffatturrozy-arch/HANSAN.ID-2-` into Vercel. Framework = Next.js (defaults auto-detect). | ⚑ Owner login required |
| C2 | Set PRODUCTION + PREVIEW env vars (match `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`. | ⚑ Owner Vercel dashboard access |
| C3 | Keep `NEXT_PUBLIC_APP_ENV` consistent for staging (recommended `staging`). | No |
| C4 | Confirm `next.config.mjs` security headers remain active on the Vercel CDN. | No |
| C5 | Do **not** deploy an empty production DB; Vercel imports the repo as-is (no auto-migration). | ⚑ Owner confirms DB target |

## D. Supabase Auth configuration (staging)

| # | Step | Owner-credential needed? |
|---|------|--------------------------|
| D1 | Create/point the project at the staging Supabase org. | ⚑ Owner Supabase access |
| D2 | Set the project API keys (`URL + publishable key`) in the Supabase dashboard → Project Settings → API. | ⚑ Owner |
| D3 | Add `NEXT_PUBLIC_SUPABASE_URL` (staging URL) to the allowed site URL list. | ⚑ Owner |
| D4 | **BLOCKER-004:** Auth → URL Configuration → Site URL = Vercel staging URL; Redirect URLs = `{STAGING_URL}/**`. | ⚑ Owner |
| D5 | Enable required providers (email/anon identity) — no webhook/signup gates for staging. | ⚑ Owner |

## E. Database migration and RLS review

| # | Step | Owner-credential needed? |
|---|------|--------------------------|
| E1 | `npm run db:generate` (Prisma client; no server needed). | No |
| E2 | `npm run db:migrate:status` to confirm migration state locally before syncing. | No |
| E3 | Apply the committed `prisma/migrations/` to the staging DB (transactional pooler for `migrate`). | ⚑ Owner DB access |
| E4 | Review `prisma/rls-demo-isolation.sql` and apply the DEMO-isolation RLS artifact to staging. | ⚑ Owner DB access |
| E5 | Confirm production starter policy: `prisma/schema.prisma` seeds nothing (`Production` org rows empty). | ⚑ Owner confirms before first write |

> **Gate note:** steps E3–E4 execute **only** inside the RLS go/no-go gate
> `docs/PHASE-17-STAGING-RLS-GO-NO-GO.md` (G1–G9). Current verdict:
> **`BLOCKED — RLS ACTIVATION NOT AUTHORIZED`** — no migration or RLS SQL has been
> applied to any remote database.

## F. Post-deployment smoke tests (staging)

| # | Step | Owner-credential needed? |
|---|------|--------------------------|
| F1 | `GET /api/health` returns 200; report shows staging config state (no secrets in body). | No (public health probe) |
| F2 | Load the staging login page; confirm it renders and fails closed without credentials. | No |
| F3 | Sign in as the staging owner; confirm a live session cookie is issued. | ⚑ Owner staging account |
| F4 | Create a draft order and advance it to ready/completed via the staging UI. | ⚑ Owner staging account |


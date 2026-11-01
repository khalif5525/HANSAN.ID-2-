# HANSAN — Manual Blockers

Every item genuinely requiring user intervention. **No secrets are stored in this file.**
Last updated: Phase A1.

---

## BLOCKER-001 — Supabase Auth credentials (Phase 13)

1. **Feature:** Production authentication (Supabase Auth + Next.js App Router).
2. **Why manual:** A real Supabase project must exist; credentials cannot be invented (rules).
3. **Required:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (project URL + publishable key; the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is still accepted as a fallback per `src/config/environment.ts:41`).
4. **Where:**
   - Locally: `.env.local` in `C:\Users\MyBook Hype AMD\Desktop\HANSAN(2)` (gitignored).
   - Vercel: Project → Settings → Environment Variables (Production + Preview).
5. **Dashboard:** https://supabase.com/dashboard → your project → Project Settings → API.
6. **Provider:** Supabase.
7. **Security warning:** Never commit these; anon key is publishable via env only. Service-role key NEVER goes to `NEXT_PUBLIC_*` or client code.
8. **Continuing without it:** All Phase A1–A11 autonomous domain/security/QA work.
9. **Unlocks:** Real login/logout/sessions, protected routes, server-side validation, Phase 13 completion.
10. **Verification:** Login works in prod; unauthenticated request to a protected route returns 401; session survives reload.
11. **Status:** ⬜ OPEN.

---

## BLOCKER-002 — Database connection (Phase 14, deferred by DATABASE RULE)

1. **Feature:** Prisma + Supabase PostgreSQL production database.
2. **Why manual:** Requires Supabase project + connection string.
3. **Required:** `DATABASE_URL` (pooled Postgres connection string; transactional pooler URL for migrations if needed).
4. **Where:** `.env.local` locally; Vercel → Settings → Environment Variables.
5. **Dashboard:** Supabase Dashboard → Project Settings → Database → Connection string (Transaction/Session pooler).
6. **Provider:** Supabase.
7. **Security warning:** Never commit; server-side only; rotate if leaked.
8. **Continuing without it:** Schema design, Prisma model definitions, repository interfaces, migrations scripts (unapplied), all domain logic + tests.
9. **Unlocks:** `prisma migrate`, real adapters, live data, API endpoints backed by storage.
10. **Verification:** `npx prisma validate` + `npx prisma migrate status` + app health endpoint reports connected.
11. **Status:** ⬜ OPEN (deferred by DATABASE RULE).

---

## BLOCKER-003 — Vercel project connection (all Deployment Checkpoints)

1. **Feature:** Automatic production deployment from `main`.
2. **Why manual:** Requires interactive Vercel login/dashboard (OAuth) — cannot be done safely unattended.
3. **Required:** Import repo `khaliffatturrozy-arch/HANSAN.ID-2-` into Vercel (Git integration), or locally run `vercel login` + `vercel link`.
4. **Where:** https://vercel.com/new → Import Git Repository → select `HANSAN.ID-2-`; set Framework = Next.js (defaults detected automatically).
5. **Dashboard:** Vercel → Project → Settings (env vars) / Deployments (status).
6. **Provider:** Vercel.
7. **Security warning:** Do not paste Vercel tokens into the repo. Configure env vars per BLOCKER-001/002 there.
8. **Continuing without it:** All code phases; pushes land on their branches in GitHub. **CI does not run on pushes** (PR / manual-dispatch events only) — the first CI run happens via PR #1.
9. **Unlocks:** Automatic deploy per push, production URL verification.
10. **Verification:** After push, Vercel Deployment shows success; production URL returns 200 on `/` and `/login`.
11. **Status:** ⬜ OPEN (vercel CLI installed but unauthenticated; `.vercel/` not linked).

---

## BLOCKER-004 — Supabase Auth URL configuration (after BLOCKER-001)

1. **Feature:** Auth redirects in production.
2. **Why manual:** Supabase dashboard allow-list configuration.
3. **Required:** Add production URL(s) to Supabase Auth → URL Configuration: Site URL = Vercel production URL; Redirect URLs = `{PROD_URL}/**`.
4. **Where:** Supabase Dashboard → Authentication → URL Configuration.
5. **Provider:** Supabase.
6. **Security warning:** Never allow unrestricted wildcard redirect origins beyond your own domains (open-redirect risk).
7. **Continuing without it:** Domain-logic phases.
8. **Unlocks:** Production login redirect flows.
9. **Verification:** Login from production URL completes and returns to the app.
10. **Status:** ⬜ OPEN (pending BLOCKER-001/003).

---

## BLOCKER-005 — Payment/delivery integrations (QRIS, EDC, Gojek, Grab, Shopee)

1. **Feature:** Real payment & delivery integrations (Phase 21 original).
2. **Why manual:** Merchant accounts, API keys, webhook registration, commercial contracts.
3. **Required:** Provider merchant credentials + webhook secrets (per provider).
4. **Where:** Provider dashboards; keys → `.env.local`/Vercel env (server-side only).
5. **Provider:** Each payment/delivery vendor.
6. **Security warning:** Webhook secrets server-side only; verify signatures before trusting events.
7. **Continuing without it:** Interfaces/adapters/error states/honest "Not configured" UI states.
8. **Unlocks:** Real QRIS/EDC/order-channel flows.
9. **Status:** ⬜ OPEN.

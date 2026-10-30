# HANSAN V2 — Security Audit

## 1. Summary

No secret values are printed in this report. Findings are described by file
location and risk type only.

Security posture is strong at the application layer (auth fail-closed, RBAC,
tenant assertions, CSRF origin check, idempotency, rate limiting), but
production hardening remains incomplete (RLS not applied, rate limiter
in-memory, payment gateway not configured, environment hygiene issues).

## 2. Environment and credential hygiene

### Finding S-01: `.env` contains malformed/raw credential lines (HIGH)

- Location: repository root `.env` (gitignored)
- Evidence: file contains lines that are not `KEY=VALUE` pairs, including a raw
  PostgreSQL connection string, a JWT-like token, and a `password : ...` line.
- Risk: accidental credential exposure through backups, logs, screenshots, or
  future commits; unclear which values are active.
- Recommendation: remove raw lines, keep only `KEY=VALUE` entries matching
  `.env.example`; rotate any credential that may have been exposed; never commit
  `.env`.

### Finding S-02: `.env` is gitignored but not validated (MEDIUM)

- `.gitignore` ignores `.env`, `.env*.local`, `.env.production`.
- No automated check ensures `.env` only contains expected keys.
- Recommendation: add a local-only hygiene check (not part of CI) or document
  required format in `MANUAL-BLOCKERS.md`.

## 3. Secret handling in source

- `src/config/environment.ts` never reads `SUPABASE_SECRET_KEY` or DB
  passwords; public config is client-safe.
- `src/server/config/secrets.ts` is `server-only` and resolves missing values
  to `null`; admin client fails closed when absent.
- Provisioning secrets (`HANSAN_PROVISION_SECRET`,
  `HANSAN_DEVELOPER_PROVISION_SECRET`) are optional and fail closed when absent.
- `.eslintrc.json` bans `@/server/*` imports from client code (per docs).

## 4. Authentication and authorization

- `requireAuth` fails closed: 503 when `SESSION_SECRET` missing in production,
  401 when cookie absent/invalid.
- RBAC permission checks are server-side and audited on denial.
- Tenant and outlet assertions (`assertTenant`, `assertOutlet`) are enforced.
- Demo sessions cannot access production scope (`assertDemoScope`).
- Live production reads revalidate session context before authorization
  (`requireRevalidatedLiveContext`).

Verified by: `tests/authz.test.ts`, `tests/tenant-isolation.test.ts`.

## 5. CSRF and origin

- Cookie is `SameSite=Lax`.
- `assertSameOrigin` rejects cross-origin `Origin` headers; absent Origin passes.
- Assessment: acceptable for cookie-authenticated mutations, with documented
  limitation for clients without Origin.

## 6. Rate limiting

- Fixed-window in-memory limiter (`src/server/rate-limit.ts`).
- Limitation: per-instance only; on serverless (Vercel) limits are approximate.
- Recommendation: replace store with shared backend (Redis/Upstash) before
  relying on strict global limits.

## 7. Tenant isolation

- Application-level tenant/outlet scoping is implemented and tested.
- RLS SQL artifact exists but is not applied/verified.
- Demo/production data separation uses `dataScope` and in-memory sandbox.

## 8. Potential authorization bypass review

- No evidence of client-trusted tenant/outlet IDs in audited routes; scope comes
  from authenticated session.
- Idempotency keys are scoped by organization + scope + key.
- Refund and order creation validate against authoritative records.

## 9. Tracked sensitive files

- `.env` is gitignored and not tracked.
- `*.pem`, `*.key`, `*.crt`, `credentials*`, `service-account*`, `secrets*`
  are gitignored.
- `src/server/config/secrets.ts` is explicitly un-ignored as source code.

## 10. Untracked scripts

- `tests/_patch/oa19-scan.ps1` is a secret-scanning helper; it does not read
  or store credentials.
- No untracked script was found reading the service-role key during this audit.
  Historical concern remains documented; re-scan before commit.

## 11. Security recommendations

1. Remediate `.env` hygiene immediately (rotate if exposure suspected).
2. Apply and verify RLS in a disposable database before production.
3. Replace in-memory rate limiter for production.
4. Configure real payment provider credentials and webhook signature
   verification.
5. Ensure `SESSION_SECRET` (>=32 chars) is set in production.
6. Do not commit `.env`, `NUL`, `AppData/`, or local artifacts.

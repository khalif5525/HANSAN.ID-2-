"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEV_ACCOUNTS, DEV_ROLES } from "@/types/roles";
import { devCredentialsFor, verifyDevCredentials, writeDevSession } from "@/lib/dev-session";
import { homeForRole } from "@/config/routes";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

/**
 * Sign-in (Phase 3) — issues the interim signed demo session cookie via
 * POST /api/auth/sign-in, then mirrors identity to localStorage for the
 * existing client gate (presentation only).
 *
 * Continuity guarantee: if the server cannot sign (production deployment
 * without SESSION_SECRET), sign-in falls back to local verification so the
 * owner demo workflow is NEVER locked — server APIs remain fail-closed and
 * no server identity exists in that state (honest, documented in
 * docs/PRODUCTION-READINESS.md). Supabase Auth (BLOCKER-001) replaces this.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  async function establishSession(creds: { email: string; password: string }): Promise<boolean | null> {
    try {
      const res = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creds),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: { code?: string } } | null;
      if (res.ok && json?.ok) return true;
      // Wrong credentials on the server = real rejection.
      if (res.status === 401) return false;
      // 503 AUTH_NOT_CONFIGURED / network failure -> local fallback (demo continuity).
      return null;
    } catch {
      return null;
    }
  }

  async function finishSignIn(role: (typeof DEV_ROLES)[number]) {
    writeDevSession(role);
    router.replace(homeForRole(role));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const localRole = verifyDevCredentials(email, password);
    if (!localRole) {
      setSubmitting(false);
      setError(
        "Unknown development account. Use one of the five development sign-ins listed below.",
      );
      return;
    }

    const server = await establishSession({ email, password });
    if (server === false) {
      setSubmitting(false);
      setError("Sign-in rejected by the server. Check the development account and try again.");
      return;
    }
    await finishSignIn(localRole);
  }

  async function quickSignIn(role: (typeof DEV_ROLES)[number]) {
    setSubmitting(true);
    setError(null);
    await establishSession(devCredentialsFor(role));
    await finishSignIn(role);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-hansan-surface px-4 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center justify-center gap-3">
          <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl bg-hansan-orange text-lg font-black text-white shadow-neu-raised-sm">
            H
          </span>
          <span className="text-2xl font-black tracking-tight text-hansan-ink">HANSAN</span>
        </Link>

        <section className="rounded-sm border border-hansan-line bg-hansan-surface-raised p-6 sm:p-8">
          <h1 className="text-xl font-bold text-hansan-ink">Development sign-in</h1>
          <p className="mt-1.5 text-sm text-hansan-ink-muted">
            Demo sandbox access for exploring HANSAN. Sign-in issues a signed demo session
            cookie (server-verified); this is not production authentication — real accounts
            arrive with Supabase Auth.
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <Input
              label="Email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="developer@hansan.local"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && (
              <Alert tone="danger" role="alert">
                {error}
              </Alert>
            )}
            <Button type="submit" loading={submitting} className="w-full">
              Sign in to workspace
            </Button>
          </form>
        </section>

        <section className="mt-6 rounded-sm border border-hansan-line bg-hansan-surface-raised p-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-hansan-ink-muted">
            Development accounts
          </h2>
          <p className="mt-1 text-xs text-hansan-ink-muted">
            Click a role to sign in instantly (demo shortcut). Development-only identities.
          </p>
          <ul className="mt-4 space-y-2">
            {DEV_ROLES.map((role) => {
              const account = DEV_ACCOUNTS[role];
              return (
                <li key={role}>
                  <button
                    type="button"
                    onClick={() => quickSignIn(role)}
                    className="flex w-full items-center justify-between gap-3 rounded-sm border border-hansan-line bg-hansan-surface-raised px-4 py-3 text-left transition hover:border-hansan-ink focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)]"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-hansan-ink">
                        {account.label}
                      </span>
                      <span className="block font-mono text-xs text-hansan-ink-muted">
                        {account.email}
                      </span>
                    </span>
                    <span className="text-xs font-semibold text-hansan-blue">Enter →</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}

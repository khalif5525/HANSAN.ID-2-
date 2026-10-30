/**
 * Configuration boundary — single place that reads process env.
 * NEVER throws at import time (builds run without secrets).
 * Values are accessed lazily via getters; secrets are never logged.
 * (Phase A1; MANUAL-BLOCKERS.md lists required production vars.)
 */

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  appName: string;
  /** Supabase project URL (Phase 13) — null until configured. */
  supabaseUrl: string | null;
  /**
   * Client-safe Supabase publishable (formerly "anon") key — the single
   * public value handed to the Supabase SDK. Resolved from the modern
   * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` first, falling back to the legacy
   * `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Safe to expose to the browser by design.
   */
  supabasePublishableKey: string | null;
  /** Database (deferred) — null until configured. */
  databaseUrl: string | null;
  /** Interim demo-session signing secret (Phase 3). Server-only: NEVER expose via NEXT_PUBLIC_ or log. */
  sessionSecret: string | null;
}

function read(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

export function getConfig(): AppConfig {
  const nodeEnvRaw = read("NODE_ENV") ?? "development";
  return {
    nodeEnv: nodeEnvRaw === "production" ? "production" : nodeEnvRaw === "test" ? "test" : "development",
    appName: read("NEXT_PUBLIC_APP_NAME") ?? "HANSAN",
    supabaseUrl: read("NEXT_PUBLIC_SUPABASE_URL"),
    // New Supabase key naming (publishable) with legacy anon fallback.
    // Server secrets (SUPABASE_SECRET_KEY / service-role / DB password) are
    // intentionally NEVER read here — they must never reach the client bundle.
    supabasePublishableKey:
      read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? read("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    databaseUrl: read("DATABASE_URL") ?? read("POSTGRES_URL") ?? read("PRISMA_DATABASE_URL"),
    sessionSecret: read("SESSION_SECRET"),
  };
}

export function hasSupabaseAuth(): boolean {
  const c = getConfig();
  return Boolean(c.supabaseUrl && c.supabasePublishableKey);
}

export function hasDatabase(): boolean {
  return Boolean(getConfig().databaseUrl);
}

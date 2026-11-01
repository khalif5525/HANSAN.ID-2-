/**
 * Environment configuration contract (Phase 13 key-name compatibility).
 *
 * Guards the Supabase key resolution introduced for the new "publishable key"
 * naming while keeping the legacy anon fallback, plus the hard rule that
 * server secrets must NEVER be surfaced through the client-safe config.
 */
import { describe, expect, it } from "vitest";
import { getConfig, hasSupabaseAuth, hasDatabase } from "@/config/environment";
import { getEnv, setEnv, setNodeEnv } from "./helpers/env";

// Every env key this suite touches — captured & restored so tests never leak
// state into each other or into the real process environment.
const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "DATABASE_URL",
] as const;

function clearAll(): void {
  setEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
  setEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
  setEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", undefined);
  setEnv("DATABASE_URL", undefined);
}

describe("getConfig — Supabase key name compatibility", () => {
  const saved: Record<string, string | undefined> = {};
  for (const k of KEYS) saved[k] = getEnv(k);

  it("resolves supabasePublishableKey from NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", () => {
    clearAll();
    setEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    setEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_placeholder");
    const cfg = getConfig();
    expect(cfg.supabasePublishableKey).toBe("sb_publishable_placeholder");
    expect(hasSupabaseAuth()).toBe(true);
  });

  it("falls back to legacy NEXT_PUBLIC_SUPABASE_ANON_KEY when publishable is absent", () => {
    clearAll();
    setEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    setEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "legacy-anon-placeholder");
    const cfg = getConfig();
    expect(cfg.supabasePublishableKey).toBe("legacy-anon-placeholder");
    expect(hasSupabaseAuth()).toBe(true);
  });

  it("prefers the publishable key when both publishable and legacy anon are set", () => {
    clearAll();
    setEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    setEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_wins");
    setEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "legacy-loses");
    expect(getConfig().supabasePublishableKey).toBe("sb_publishable_wins");
  });

  it("reports incomplete config as NOT configured (fail-closed)", () => {
    clearAll();
    setEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    // URL present but no key of either kind.
    expect(getConfig().supabasePublishableKey).toBeNull();
    expect(hasSupabaseAuth()).toBe(false);
  });

  it("hasDatabase reflects only the database URL (independent of Supabase keys)", () => {
    clearAll();
    setEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    setEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_placeholder");
    expect(hasSupabaseAuth()).toBe(true);
    expect(hasDatabase()).toBe(false);
    setEnv("DATABASE_URL", "postgresql://user@host:6543/postgres");
    expect(hasDatabase()).toBe(true);
  });

  it("never reads server secrets (SUPABASE_SECRET_KEY) into the public config", () => {
    clearAll();
    setEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    setEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_placeholder");
    const cfg = getConfig() as unknown as Record<string, unknown>;
    // The config object exposes no field holding the privileged secret.
    const serialized = JSON.stringify(cfg);
    expect(serialized).not.toContain("SUPABASE_SECRET_KEY");
    expect(cfg).not.toHaveProperty("supabaseSecretKey");
    expect(cfg).not.toHaveProperty("serviceRoleKey");
    // And the publishable value is a placeholder, never the secret.
    expect(cfg.supabasePublishableKey).toBe("sb_publishable_placeholder");
  });

  // Restore the real environment after the suite.
  for (const k of KEYS) setEnv(k, saved[k]);
});

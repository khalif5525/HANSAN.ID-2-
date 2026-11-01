/**
 * Supabase BROWSER client (Phase B1) — browser-safe authentication.
 *
 * Uses ONLY `NEXT_PUBLIC_SUPABASE_URL` and the publishable (anon) key through
 * the client-safe `getConfig()`. It must never reference database connection
 * strings, privileged admin credentials, or any server-only module.
 * `createBrowserClient` persists the session in cookies automatically so the
 * server client can read it on the next request.
 */
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "@/config/environment";

/** Create a browser Supabase client (publishable key only). Browser-only. */
export function createClient(): SupabaseClient {
  const config = getConfig();
  const url = config.supabaseUrl;
  const key = config.supabasePublishableKey;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured (missing NEXT_PUBLIC_SUPABASE_URL or publishable key); the browser client cannot be created.",
    );
  }

  return createBrowserClient(url, key);
}

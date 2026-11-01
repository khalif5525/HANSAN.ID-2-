/**
 * Supabase ADMIN client (Phase B1) — server-only, privileged.
 *
 * Uses the service-role / secret key (`SUPABASE_SECRET_KEY`) EXCLUSIVELY on
 * the server. This client bypasses Row Level Security and must NEVER be
 * imported from a Client Component or any user-facing request path. The
 * `server-only` import below makes the production build fail if a client
 * component reaches this module.
 *
 * Phase B1 scope: this factory exists for FUTURE provisioning / invite work
 * only. It is intentionally NOT wired into sign-in, session, or ordinary
 * request paths.
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerSecrets } from "@/server/config/secrets";

/**
 * Create the privileged Supabase admin client.
 *
 * Fails clearly (throws) when the server-only secret or URL is not configured —
 * it never silently substitutes credentials. Callers MUST handle the error.
 */
export function createAdminClient(): SupabaseClient {
  const { url, secretKey } = getSupabaseServerSecrets();

  if (!secretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not configured; the Supabase admin client cannot be created.",
    );
  }
  if (!url) {
    throw new Error(
      "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not configured; the Supabase admin client cannot be created.",
    );
  }

  return createClient(url, secretKey, {
    auth: {
      // Admin client is stateless: never persist a session to any storage.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

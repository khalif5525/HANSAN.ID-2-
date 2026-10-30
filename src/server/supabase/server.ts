/**
 * Supabase SERVER client (Phase B1) — cookie-aware, user-scoped.
 *
 * For use in Server Components, Route Handlers, and Server Actions. Uses ONLY
 * the public project URL + publishable (anon) key from the client-safe
 * `getConfig()`; it never touches the privileged secret. Reads/writes the
 * Supabase auth cookies through Next.js `next/headers`.
 *
 * Follows Supabase SSR guidance for Next.js 14 (synchronous `cookies()`): a
 * fresh client is created per render, and `setAll` is wrapped in try/catch
 * because cookies cannot be set from a Server Component — middleware and route
 * handlers own session refresh there.
 */
import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getConfig } from "@/config/environment";

/** Create a request-scoped Supabase server client (publishable key only). */
export function createClient(): SupabaseClient {
  const config = getConfig();
  const url = config.supabaseUrl;
  const key = config.supabasePublishableKey;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured (missing NEXT_PUBLIC_SUPABASE_URL or publishable key); the server client cannot be created.",
    );
  }

  const cookieStore = cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Invoked from a Server Component where cookies are read-only.
          // Session refresh is handled by middleware / route handlers instead.
        }
      },
    },
  });
}

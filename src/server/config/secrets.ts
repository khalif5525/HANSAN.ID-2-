/**
 * Server-only secret accessor (Phase B1).
 *
 * Reads the privileged Supabase secret (service-role) key. This module is
 * COMPLETELY SEPARATE from the client-safe `getConfig()` in
 * `src/config/environment.ts` — that public config never reads this key and
 * never exposes it. This module is guarded by `server-only`, so importing it
 * from a Client Component fails the production build.
 *
 * Secret policy (never invent or substitute credentials): when a value is
 * absent the field resolves to `null`, and the admin client factory turns a
 * missing secret into a clear, thrown error instead of silently falling back.
 */
import "server-only";

export interface SupabaseServerSecrets {
  /**
   * Project URL used for privileged admin operations. Prefers the server-only
   * `SUPABASE_URL`, falling back to the public `NEXT_PUBLIC_SUPABASE_URL` —
   * both point at the same project.
   */
  url: string | null;
  /**
   * Privileged service-role / secret key. Server-only; NEVER exposed to the
   * client bundle, React props, API responses, or logs.
   */
  secretKey: string | null;
}

function read(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Resolve the server-only Supabase admin credentials. Missing values resolve
 * to `null`; callers MUST fail closed when they require them.
 */
export function getSupabaseServerSecrets(): SupabaseServerSecrets {
  return {
    url: read("SUPABASE_URL") ?? read("NEXT_PUBLIC_SUPABASE_URL"),
    secretKey: read("SUPABASE_SECRET_KEY"),
  };
}

export interface ProvisioningSecrets {
  /** Gates first-Owner bootstrap (`POST /api/admin/provision-owner`). */
  ownerBootstrap: string | null;
  /** Gates platform Developer provisioning (`POST /api/admin/provision-developer`). */
  developer: string | null;
}

/**
 * Resolve the provisioning gate secrets. Server-only; NEVER exposed to the
 * client. A null value means that provisioning path is disabled (fail closed).
 */
export function getProvisioningSecrets(): ProvisioningSecrets {
  return {
    ownerBootstrap: read("HANSAN_PROVISION_SECRET"),
    developer: read("HANSAN_DEVELOPER_PROVISION_SECRET"),
  };
}

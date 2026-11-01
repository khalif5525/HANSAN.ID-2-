/**
 * Rate limiting (Phase A9) — fixed-window in-memory limiter.
 *
 * HONEST LIMITATION: this runs per server instance. On serverless
 * (Vercel) each instance has its own counter, so limits are
 * approximate per-instance. A shared-store adapter (Redis/Upstash)
 * must replace the store before relying on strict global limits —
 * see docs/MANUAL-BLOCKERS.md guidance in deployment docs.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): { count: number; resetAt: number };
  reset(key: string): void;
}

/** Default: sliding fixed window in process memory. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  hit(key: string, windowMs: number): { count: number; resetAt: number } {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      this.gc(now);
      return fresh;
    }
    existing.count += 1;
    return existing;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private gc(now: number): void {
    // opportunistic cleanup to bound memory
    if (this.buckets.size < 10_000) return;
    for (const [key, bucket] of Array.from(this.buckets)) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

export const defaultStore = new InMemoryRateLimitStore();

export function rateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
  store?: RateLimitStore;
}): RateLimitResult {
  const store = params.store ?? defaultStore;
  const bucket = store.hit(params.key, params.windowMs);
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
  if (bucket.count > params.limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return { allowed: true, remaining: params.limit - bucket.count, retryAfterSeconds };
}

/** Standard buckets used by the API layer. */
export const RATE_LIMITS = {
  /** Login attempts per IP+email. */
  login: { limit: 10, windowMs: 60_000 },
  /** General API per identity. */
  api: { limit: 120, windowMs: 60_000 },
  /** Expensive mutations. */
  mutation: { limit: 30, windowMs: 60_000 },
  /** Order creation (customer-facing). */
  order_create: { limit: 30, windowMs: 60_000 },
} as const;

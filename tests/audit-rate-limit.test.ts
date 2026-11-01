import { describe, expect, it } from "vitest";
import { rateLimit, InMemoryRateLimitStore, RATE_LIMITS } from "@/server/rate-limit";

describe("rate limiter", () => {
  it("respects store and returns retry-after ceiling", () => {
    const store: { hit: (key: string, ms: number) => { count: number; resetAt: number }; reset: (key: string) => void } = {
      hit: (_k: string, ms: number) => ({ count: 0, resetAt: Date.now() + ms }),
      reset: () => {},
    };
    const r = rateLimit({ key: "ip:1.2.3.4", limit: 5, windowMs: 60_000, store });
    expect(r).toBeDefined();
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(5);
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("denies beyond limit with RETRY_AFTER", () => {
    const store: { hit: (key: string, ms: number) => { count: number; resetAt: number }; reset: (key: string) => void } = {
      hit: (_k: string, ms: number) => ({ count: 6, resetAt: Date.now() + ms }),
      reset: () => {},
    };
    const r = rateLimit({ key: "k", limit: 5, windowMs: 60_000, store });
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("local InMemoryRateLimitStore reset clears the bucket", () => {
    const store = new InMemoryRateLimitStore();
    expect(rateLimit({ key: "k", limit: 5, windowMs: 60_000, store }).allowed).toBe(true);
    expect(rateLimit({ key: "k", limit: 5, windowMs: 60_000, store }).remaining).toBe(3);
    store.reset("k");
    expect(rateLimit({ key: "k", limit: 5, windowMs: 60_000, store }).remaining).toBe(4);
  });

  it("RATE_LIMITS buckets exist with sane defaults", () => {
    expect(RATE_LIMITS.login.limit).toBe(10);
    expect(RATE_LIMITS.api.limit).toBe(120);
    expect(RATE_LIMITS.mutation.limit).toBe(30);
  });
});


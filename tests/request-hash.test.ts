/** Regression: requestHash canonicalization contract (M2). */
import { describe, expect, it } from 'vitest';
import { requestHash } from '@/server/idempotency';

describe('requestHash', () => {
  it('is key-order independent at top level', async () => {
    const a = await requestHash({ a: 1, b: 2 });
    const b = await requestHash({ b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('is key-order independent for nested objects', async () => {
    const a = await requestHash({ outer: { x: 1, y: 2 }, z: 3 });
    const b = await requestHash({ z: 3, outer: { y: 2, x: 1 } });
    expect(a).toBe(b);
  });

  it('is array-order sensitive', async () => {
    const a = await requestHash({ items: [1, 2, 3] });
    const b = await requestHash({ items: [3, 2, 1] });
    expect(a).not.toBe(b);
  });

  it('treats undefined property as absent', async () => {
    const a = await requestHash({ a: 1, b: undefined });
    const b = await requestHash({ a: 1 });
    expect(a).toBe(b);
  });

  it('distinguishes null from absent', async () => {
    const a = await requestHash({ a: null });
    const b = await requestHash({});
    expect(a).not.toBe(b);
  });

  it('handles null values', async () => {
    const a = await requestHash({ a: null, b: [null, 2] });
    const b = await requestHash({ a: null, b: [null, 2] });
    expect(a).toBe(b);
  });

  it('rejects NaN', async () => {
    await expect(requestHash({ a: NaN })).rejects.toThrow();
  });

  it('rejects Infinity', async () => {
    await expect(requestHash({ a: Infinity })).rejects.toThrow();
    await expect(requestHash({ a: -Infinity })).rejects.toThrow();
  });

  it('rejects top-level undefined', async () => {
    await expect(requestHash(undefined)).rejects.toThrow();
  });

  it('rejects unsupported values', async () => {
    await expect(requestHash({ a: () => 1 } as unknown)).rejects.toThrow();
  });

  it('produces different hashes for different valid payloads', async () => {
    const a = await requestHash({ a: 1 });
    const b = await requestHash({ a: 2 });
    const c = await requestHash({ a: 1, b: 2 });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
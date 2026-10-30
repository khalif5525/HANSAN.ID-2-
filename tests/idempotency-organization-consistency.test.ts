/** Regression: idempotency organization/tenant consistency (M1). */
import { describe, expect, it } from 'vitest';
import { InMemoryIdempotency } from '@/server/idempotency';

describe('idempotency organization consistency', () => {
  const scope = 'customer.orders.create';
  const key = 'k-org';

  it('replays when begin/complete/fail use the same organization', async () => {
    const idem = new InMemoryIdempotency();
    const first = await idem.begin({ organizationId: 'ten_a', scope, key, requestHash: 'h' });
    expect(first.status).toBe('started');
    await idem.complete({ organizationId: 'ten_a', scope, key, response: { id: '1' } });
    const replay = await idem.begin({ organizationId: 'ten_a', scope, key, requestHash: 'h' });
    expect(replay.status).toBe('replay');
  });

  it('does not replay when complete uses a different organization (mismatched context)', async () => {
    const idem = new InMemoryIdempotency();
    await idem.begin({ organizationId: 'ten_a', scope, key, requestHash: 'h' });
    // A complete under a different (actor-mismatched) org must not complete ten_a's claim.
    await idem.complete({ organizationId: 'ten_b', scope, key, response: { id: '1' } });
    const again = await idem.begin({ organizationId: 'ten_a', scope, key, requestHash: 'h' });
    expect(again.status).not.toBe('replay');
  });

  it('fail under a different organization does not release the original claim', async () => {
    const idem = new InMemoryIdempotency();
    await idem.begin({ organizationId: 'ten_a', scope, key, requestHash: 'h' });
    await idem.fail({ organizationId: 'ten_b', scope, key });
    const again = await idem.begin({ organizationId: 'ten_a', scope, key, requestHash: 'h' });
    // Original in_progress claim under ten_a must remain (conflict), not restarted.
    expect(again.status).toBe('conflict');
  });

  it('get returns null for mismatched organization', async () => {
    const idem = new InMemoryIdempotency();
    await idem.begin({ organizationId: 'ten_a', scope, key, requestHash: 'h' });
    await idem.complete({ organizationId: 'ten_a', scope, key, response: { id: '1' } });
    expect(await idem.get({ organizationId: 'ten_b', scope, key })).toBeNull();
    expect(await idem.get({ organizationId: 'ten_a', scope, key })).toEqual({ id: '1' });
  });
});
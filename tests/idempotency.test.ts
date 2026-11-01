/** Regression: idempotency begin/complete/fail round-trip (Phase A4). */
import { describe, expect, it } from 'vitest';
import { InMemoryIdempotency } from '@/server/idempotency';

describe('idempotency replay', () => {
  it('begin/complete/fail round-trips and replays results', async () => {
    const idem = new InMemoryIdempotency();
    const scope = 'orders.create';
    const key = 'k1';

    const first = await idem.begin({ organizationId: 'ten_1', scope, key, requestHash: 'abc123' });
    expect(first.status).toBe('started');

    await idem.complete({ organizationId: 'ten_1', scope, key, response: { orderId: 'ord_1' } });

    const replay = await idem.begin({ organizationId: 'ten_1', scope, key, requestHash: 'abc123' });
    expect(replay.status).toBe('replay');
    if (replay.status === 'replay') {
      expect(replay.response).toEqual({ orderId: 'ord_1' });
    }

    // fail() on a completed claim is a no-op — the claim stays completed
    await idem.fail({ organizationId: 'ten_1', scope, key });

    // The completed claim must STILL replay (no duplicate execute)
    const again = await idem.begin({ organizationId: 'ten_1', scope, key, requestHash: 'abc123' });
    expect(again.status).toBe('replay');
    if (again.status === 'replay') {
      expect(again.response).toEqual({ orderId: 'ord_1' });
    }
  });

  it('rejects a conflicting request hash', async () => {
    const idem = new InMemoryIdempotency();
    await idem.begin({ organizationId: 'ten_1', scope: 'orders.create', key: 'k1', requestHash: 'abc123' });
    await idem.complete({ organizationId: 'ten_1', scope: 'orders.create', key: 'k1', response: { orderId: 'ord_1' } });

    const conflicting = await idem.begin({ organizationId: 'ten_1', scope: 'orders.create', key: 'k1', requestHash: 'zzz' });
    expect(conflicting.status).toBe('conflict');
  });
});

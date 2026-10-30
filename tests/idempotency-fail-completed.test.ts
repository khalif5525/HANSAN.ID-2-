/** Regression: idempotency fail() must NOT release a completed claim (duplicate order) */
import { describe, expect, it } from 'vitest';
import { InMemoryIdempotency } from '@/server/idempotency';

describe('idempotency fail() on completed claim', () => {
  it('replay after fail on completed claim — duplicate execute must fail', async () => {
    const idem = new InMemoryIdempotency();
    const scope = 'orders.create';
    const key = 'k1';

    await idem.begin({ organizationId: 'ten_1', scope, key, requestHash: 'abc123' });
    await idem.complete({ organizationId: 'ten_1', scope, key, response: { orderId: 'ord_1' } });

    // fail() on a completed claim is a no-op
    await idem.fail({ organizationId: 'ten_1', scope, key });

    // The completed claim MUST still replay — fail() must not delete it
    const again = await idem.begin({ organizationId: 'ten_1', scope, key, requestHash: 'abc123' });
    expect(again.status).toBe('replay');
    if (again.status === 'replay') {
      expect(again.response).toEqual({ orderId: 'ord_1' });
    }
  });

  it('releases only in_progress claims on fail()', async () => {
    const idem = new InMemoryIdempotency();
    const scope = 'orders.create';
    const key = 'k2';

    await idem.begin({ organizationId: 'ten_1', scope, key, requestHash: 'abc123' });
    await idem.fail({ organizationId: 'ten_1', scope, key });

    const again = await idem.begin({ organizationId: 'ten_1', scope, key, requestHash: 'abc123' });
    expect(again.status).toBe('started');
  });
});
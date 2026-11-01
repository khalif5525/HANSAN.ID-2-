/** Regression: KDS ticket derivation (Phase A3). */
import { describe, expect, it } from 'vitest';
import {
  buildTickets,
  isVisibleToKds,
  computePriority,
  stationOf,
  allItemsReady,
} from '@/domain/kds/ticket';
import type { OrderRecord, OrderLine } from '@/domain/shared/ports';

function line(overrides: Partial<OrderLine> = {}): OrderLine {
  return {
    id: 'line_1',
    productId: 'prod_1',
    productName: 'Pasta',
    quantity: 1,
    unitPriceIdr: 10000,
    modifierIds: [],
    station: 'kitchen',
    state: 'active',
    prepStatus: 'pending',
    ...overrides,
  };
}

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 'ord_1',
    tenantId: 'ten_1',
    outletId: 'out_1',
    orderNumber: 'ORD-00001',
    orderType: 'dine-in',
    tableId: null,
    customerId: null,
    lines: [line()],
    subtotalIdr: 10000,
    discountIdr: 0,
    taxIdr: 0,
    grandTotalIdr: 10000,
    state: 'placed',
    paymentState: 'unpaid',
    createdBy: 'usr_1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('KDS ticket derivation', () => {
  it('hides cancelled orders from the queue', () => {
    const cancelled = order({ state: 'cancelled' });
    expect(isVisibleToKds(cancelled)).toBe(false);
    expect(buildTickets(cancelled, new Date('2026-01-01T00:00:00Z'))).toEqual([]);
  });

  it('builds one ticket per station with active lines', () => {
    const tickets = buildTickets(
      order({ lines: [line({ station: 'kitchen' }), line({ station: 'bar' })] }),
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(tickets).toHaveLength(2);
    expect(tickets[0]!.station).toBe('kitchen');
    expect(tickets[1]!.station).toBe('bar');
  });

  it('computes priority from elapsed minutes', () => {
    expect(computePriority(5, { highMinutes: 10, overdueMinutes: 20 })).toBe('normal');
    expect(computePriority(15, { highMinutes: 10, overdueMinutes: 20 })).toBe('high');
    expect(computePriority(25, { highMinutes: 10, overdueMinutes: 20 })).toBe('overdue');
  });

  it('reports station and item readiness', () => {
    const kitchenLine = line({ station: 'kitchen', prepStatus: 'ready' });
    const barLine = line({ station: 'bar', prepStatus: 'pending' });
    expect(stationOf(order({ lines: [kitchenLine] }), 'kitchen')).toBe(true);
    expect(stationOf(order({ lines: [kitchenLine] }), 'bar')).toBe(false);
    expect(allItemsReady(order({ lines: [kitchenLine] }), 'kitchen')).toBe(true);
    expect(allItemsReady(order({ lines: [barLine] }), 'kitchen')).toBe(false);
  });
});

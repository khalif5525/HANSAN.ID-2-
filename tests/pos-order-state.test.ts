/** Regression: order + payment state machine (Phase A2/A3). */
import { describe, expect, it } from 'vitest';
import {
  canTransitionOrder,
  canTransitionPayment,
  assertOrderTransition,
  assertPaymentTransition,
  TERMINAL_ORDER_STATES,
  KDS_VISIBLE_STATES,
} from '@/domain/pos/order-state';

describe('order state machine', () => {
  it('accepts valid order transitions', () => {
    expect(canTransitionOrder('draft', 'placed')).toBe(true);
    expect(canTransitionOrder('placed', 'accepted')).toBe(true);
    expect(canTransitionOrder('preparing', 'ready')).toBe(true);
    expect(canTransitionOrder('ready', 'completed')).toBe(true);
    expect(canTransitionOrder('completed', 'refund_requested')).toBe(true);
  });

  it('rejects unknown transitions', () => {
    expect(canTransitionOrder('draft', 'refunded')).toBe(false);
    expect(() => assertOrderTransition('draft', 'refunded')).toThrowError(/cannot move from draft to refunded/);
    expect(() => assertOrderTransition('cancelled', 'placed')).toThrowError(/cannot move from cancelled to placed/);
  });

  it('enforces payment transitions', () => {
    expect(canTransitionPayment('unpaid', 'paid')).toBe(true);
    expect(canTransitionPayment('paid', 'refunding')).toBe(true);
    expect(() => assertPaymentTransition('unpaid', 'refunding')).toThrowError(/cannot move from unpaid to refunding/);
    expect(() => assertPaymentTransition('paid', 'paid')).toThrowError(/cannot move from paid to paid/);
  });

  it('documents terminal and KDS-visible states', () => {
    expect(TERMINAL_ORDER_STATES).toContain('cancelled');
    expect(TERMINAL_ORDER_STATES).toContain('refunded');
    expect(KDS_VISIBLE_STATES).toContain('placed');
    expect(KDS_VISIBLE_STATES).not.toContain('cancelled');
  });
});

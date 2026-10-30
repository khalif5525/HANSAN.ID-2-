/** Regression: refund separation-of-duties rules (Phase A5).

Locks in:
  * only back-office roles (owner/finance) may approve;
  * the approver must be a different person than the requester (cashier must not self-approve);
  * a refund that has already been decided cannot be re-decided.
*/
import { describe, expect, it } from 'vitest';
import { canDecideRefund, canTransitionRefund } from '@/domain/finance/rules';
import type { RefundRecord } from '@/domain/finance/ports';
import { AppError, ERROR_CODES } from '@/domain/shared/errors';

/** Minimal refundable record used by every case below. */
type MakeRefundOverrides = Partial<Pick<RefundRecord, 'tenantId' | 'outletId' | 'orderId' | 'amountIdr' | 'reason' | 'status' | 'requestedBy'>> & {
  id: string;
  method?: 'cash';
  decidedBy?: string;
  decidedAt?: string;
};

function makeRefund(overrides: MakeRefundOverrides): RefundRecord {
  return {
    id: overrides.id,
    tenantId: overrides.tenantId ?? 'ten_1',
    outletId: overrides.outletId ?? 'out_1',
    orderId: overrides.orderId ?? 'ord_1',
    amountIdr: overrides.amountIdr ?? 10000,
    method: 'cash',
    reason: overrides.reason ?? 'defective unit',
    status: overrides.status ?? 'pending',
    requestedBy: overrides.requestedBy ?? 'usr_cashier',
    decidedBy: undefined,
    decidedAt: undefined,
    createdAt: '2026-01-01T00:00:00Z',
  } as RefundRecord;
}

describe('refund rules - separation of duties', () => {
  it('rejects an approver approving their own refund', () => {
    const ref = makeRefund({ id: 'ref_own', requestedBy: 'usr_self' });
    const result = canDecideRefund({
      refund: ref,
      actorId: 'usr_self',
      actorRole: 'owner',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AppError);
      expect((result.error as AppError).code).toBe(ERROR_CODES.REFUND_SELF_APPROVAL_FORBIDDEN);
    }
  });

  it('rejects non-approvers (POS may request but never approve)', () => {
    const ref = makeRefund({ id: 'ref_002' });
    expect(canDecideRefund({ refund: ref, actorId: 'usr_pos', actorRole: 'pos' }).ok).toBe(false);
    expect(canDecideRefund({ refund: ref, actorId: 'usr_dev', actorRole: 'developer' }).ok).toBe(false);
  });

  it('rejects already-decided refunds', () => {
    expect(canDecideRefund({ refund: makeRefund({ id: 'ref_003', status: 'approved' }), actorId: 'usr_owner', actorRole: 'owner' }).ok).toBe(false);
    expect(canDecideRefund({ refund: makeRefund({ id: 'ref_004', status: 'completed' }), actorId: 'usr_finance', actorRole: 'finance' }).ok).toBe(false);
  });

  it('allows back-office approvers on a pending, unrelated refund', () => {
    const result = canDecideRefund({
      refund: makeRefund({ id: 'ref_005', requestedBy: 'usr_cashier' }),
      actorId: 'usr_owner',
      actorRole: 'owner',
    });
    expect(result.ok).toBe(true);
    expect(canTransitionRefund('pending', 'approved')).toBe(true);
  });
});

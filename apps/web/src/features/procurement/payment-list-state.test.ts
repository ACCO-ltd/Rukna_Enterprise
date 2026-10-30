import { describe, expect, it } from 'vitest';

import { paymentListState } from './payment-list-state';

describe('paymentListState', () => {
  it.each([
    [{ documentStatus: 'CANCELLED', postingStatus: 'NOT_POSTED', unallocatedAmount: '0' }, 'CANCELLED'],
    [{ documentStatus: 'APPROVED', postingStatus: 'REVERSED', unallocatedAmount: '0' }, 'REVERSED'],
    [{ documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED', unallocatedAmount: '0' }, 'DRAFT'],
    [{ documentStatus: 'REJECTED', postingStatus: 'NOT_POSTED', unallocatedAmount: '0' }, 'REJECTED'],
    [{ documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED', unallocatedAmount: '0' }, 'APPROVED'],
    [{ documentStatus: 'RELEASED', postingStatus: 'NOT_POSTED', unallocatedAmount: '0' }, 'RELEASED'],
    [{ documentStatus: 'RELEASED', postingStatus: 'FAILED', unallocatedAmount: '0' }, 'POSTING_FAILED'],
    [{ documentStatus: 'RELEASED', postingStatus: 'POSTED', unallocatedAmount: '25.00' }, 'PAID_UNALLOCATED'],
    [{ documentStatus: 'RELEASED', postingStatus: 'POSTED', unallocatedAmount: '0.00' }, 'PAID'],
  ] as const)('%j → %s', (payment, state) => {
    expect(paymentListState(payment as never)).toBe(state);
  });
});

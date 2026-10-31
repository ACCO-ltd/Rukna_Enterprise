import { describe, expect, it } from 'vitest';

import { billDaysLate, billListState } from './bill-list-state';
import type { SupplierBill } from './types';

const bill = (over: Partial<SupplierBill>): SupplierBill =>
  ({
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    dueDate: '2026-11-30',
    totalAmount: '100.00',
    outstandingAmount: '100.00',
    ...over,
  }) as SupplierBill;
const TODAY = '2026-10-28';

describe('billListState', () => {
  it.each([
    [{ documentStatus: 'CANCELLED' as const }, 'CANCELLED'],
    [{ postingStatus: 'REVERSED' as const }, 'REVERSED'],
    [{ documentStatus: 'DRAFT' as const, postingStatus: 'NOT_POSTED' as const }, 'DRAFT'],
    [{ documentStatus: 'SUBMITTED' as const, postingStatus: 'NOT_POSTED' as const }, 'AWAITING_APPROVAL'],
    [{ documentStatus: 'REJECTED' as const, postingStatus: 'NOT_POSTED' as const }, 'REJECTED'],
    [{ documentStatus: 'DRAFT' as const, postingStatus: 'NOT_POSTED' as const, returnedAt: '2026-10-01' }, 'RETURNED'],
    [{ postingStatus: 'NOT_POSTED' as const }, 'TO_POST'],
    [{ postingStatus: 'FAILED' as const }, 'POSTING_FAILED'],
    [{ outstandingAmount: '0' }, 'PAID'],
    [{ postingStatus: 'OPENING_BALANCE' as const, dueDate: '2026-01-01' }, 'OVERDUE'],
    [{ outstandingAmount: '30.00' }, 'PART_PAID'],
    [{}, 'OPEN'],
  ])('%j → %s', (over, state) => {
    expect(billListState(bill(over), TODAY)).toBe(state);
  });

  it('counts days late only for an overdue bill', () => {
    expect(billDaysLate(bill({ dueDate: '2026-10-18' }), TODAY)).toBe(10);
    expect(billDaysLate(bill({ dueDate: '2026-10-18', outstandingAmount: '0' }), TODAY)).toBe(0);
  });
});

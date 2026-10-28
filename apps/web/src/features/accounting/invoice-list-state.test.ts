import { describe, expect, it } from 'vitest';

import { daysLate, invoiceListState } from './invoice-list-state';
import type { ClientInvoice } from './types';

const inv = (over: Partial<ClientInvoice>): ClientInvoice =>
  ({
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    dueDate: '2026-11-30',
    totalAmount: '100.00',
    outstandingAmount: '100.00',
    ...over,
  }) as ClientInvoice;
const TODAY = '2026-10-28';

describe('invoiceListState', () => {
  it.each([
    [{ documentStatus: 'CANCELLED' as const, outstandingAmount: '100.00' }, 'CANCELLED'],
    [{ postingStatus: 'REVERSED' as const }, 'REVERSED'],
    [{ documentStatus: 'DRAFT' as const, postingStatus: 'NOT_POSTED' as const }, 'DRAFT'],
    [{ postingStatus: 'NOT_POSTED' as const }, 'TO_POST'],
    [{ postingStatus: 'PENDING' as const }, 'POSTING'],
    [{ postingStatus: 'FAILED' as const }, 'POSTING_FAILED'],
    [{ outstandingAmount: '0.00' }, 'PAID'],
    [{ dueDate: '2026-10-01', outstandingAmount: '40.00' }, 'OVERDUE'], // late beats part-paid
    [{ outstandingAmount: '40.00' }, 'PART_PAID'],
    [{}, 'OPEN'],
  ])('%j → %s', (over, state) => {
    expect(invoiceListState(inv(over), TODAY)).toBe(state);
  });

  it('counts whole days late', () => {
    expect(daysLate(inv({ dueDate: '2026-09-11' }), TODAY)).toBe(47);
    expect(daysLate(inv({}), TODAY)).toBe(0);
  });
});

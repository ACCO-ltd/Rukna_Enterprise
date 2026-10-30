import { describe, expect, it } from 'vitest';

import type { SupplierBill } from '../types';
import { billMatchesFilters } from './bill-screens';

const bill = (over: Partial<SupplierBill>) =>
  ({
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    dueDate: '2026-11-15',
    totalAmount: '100.00',
    outstandingAmount: '100.00',
    supplierId: 's1',
    ...over,
  }) as SupplierBill;

describe('bill list balance filter (SB-2)', () => {
  const today = '2026-10-30';

  it('Unpaid keeps bills in the ledger with money still owed, opening balances included', () => {
    expect(billMatchesFilters(bill({}), { balance: 'unpaid' }, today)).toBe(true);
    expect(billMatchesFilters(bill({ postingStatus: 'OPENING_BALANCE' }), { balance: 'unpaid' }, today)).toBe(true);
    expect(billMatchesFilters(bill({ outstandingAmount: '0.00' }), { balance: 'unpaid' }, today)).toBe(false);
  });

  it('neither view shows drafts, reversed or cancelled bills', () => {
    for (const balance of ['unpaid', 'paid']) {
      expect(billMatchesFilters(bill({ documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' }), { balance }, today)).toBe(false);
      expect(billMatchesFilters(bill({ postingStatus: 'REVERSED', outstandingAmount: '0.00' }), { balance }, today)).toBe(false);
      expect(billMatchesFilters(bill({ documentStatus: 'CANCELLED', postingStatus: 'NOT_POSTED' }), { balance }, today)).toBe(false);
    }
  });

  it('Paid keeps settled bills only', () => {
    expect(billMatchesFilters(bill({ outstandingAmount: '0.00' }), { balance: 'paid' }, today)).toBe(true);
    expect(billMatchesFilters(bill({}), { balance: 'paid' }, today)).toBe(false);
  });
});

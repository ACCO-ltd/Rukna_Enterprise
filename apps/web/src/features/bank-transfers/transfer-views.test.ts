import { describe, expect, it } from 'vitest';
import type { BankTransferView } from '@erp/types';

import { overdrawnBy, transferTotals, transfersInView } from './transfer-views';

const tr = (over: Partial<BankTransferView>): BankTransferView => ({
  id: 'x', transferNumber: 'TR-000001', fromBankAccountId: 'a', fromAccountName: 'Bank', toBankAccountId: 'b', toAccountName: 'Box',
  amount: '100.00', currencyCode: 'USD', transferDate: '2026-10-16', reference: null, memo: null, status: 'POSTED', requestedBy: 'u',
  requestedByName: null, approvedByName: null, rejectionReason: null, reversalReason: null, journalEntryId: 'j', reversalJournalEntryId: null,
  requestedAt: '2026-10-16T08:00:00.000Z', postedAt: null, reversedAt: null, reversedByName: null, ...over,
});

describe('transfer views (TR)', () => {
  const rows = [
    tr({ id: '1', amount: '800.00' }),
    tr({ id: '2', status: 'PENDING_APPROVAL', amount: '5000.00', transferNumber: null }),
    tr({ id: '3', status: 'REVERSED' }),
    tr({ id: '4', status: 'REJECTED' }),
    tr({ id: '5', transferDate: '2026-09-30', amount: '50.00' }),
  ];

  it('splits waiting, posted and undone transfers', () => {
    expect(transfersInView(rows, 'waiting').map((r) => r.id)).toEqual(['2']);
    expect(transfersInView(rows, 'posted').map((r) => r.id)).toEqual(['1', '5']);
    expect(transfersInView(rows, 'undone').map((r) => r.id)).toEqual(['3', '4']);
    expect(transfersInView(rows, 'all')).toHaveLength(5);
  });

  it('adds what moved this month and what waits for approval', () => {
    expect(transferTotals(rows, '2026-10')).toEqual({ postedThisMonth: '800.00', postedThisMonthCount: 1, waiting: '5000.00', waitingCount: 1 });
  });

  it('warns when the books would show the sending account below zero', () => {
    expect(overdrawnBy('800.00', 100_00)).toBeNull();
    expect(overdrawnBy('800.00', 900_00)).toBe('-100.00');
    expect(overdrawnBy(undefined, 900_00)).toBeNull();
  });
});

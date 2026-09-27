import { describe, expect, it } from 'vitest';

import { isInvoiceOverdue, todayWireDate } from './invoice-overdue';

const base = {
  documentStatus: 'APPROVED' as const,
  postingStatus: 'POSTED' as const,
  dueDate: '2026-08-29',
  outstandingAmount: '105000.00',
};

describe('isInvoiceOverdue', () => {
  it('is overdue when posted, past due, and money is still owed', () => {
    expect(isInvoiceOverdue(base, '2026-09-27')).toBe(true);
  });

  it('is not overdue on the due date itself', () => {
    expect(isInvoiceOverdue(base, '2026-08-29')).toBe(false);
  });

  it('is not overdue once paid in full', () => {
    expect(isInvoiceOverdue({ ...base, outstandingAmount: '0.00' }, '2026-09-27')).toBe(false);
  });

  it('never flags an invoice that is not live in the ledger', () => {
    expect(isInvoiceOverdue({ ...base, postingStatus: 'NOT_POSTED' }, '2026-09-27')).toBe(false);
    expect(isInvoiceOverdue({ ...base, postingStatus: 'REVERSED' }, '2026-09-27')).toBe(false);
    expect(isInvoiceOverdue({ ...base, documentStatus: 'CANCELLED' }, '2026-09-27')).toBe(false);
  });

  it('never flags an invoice without a due date (separate charges)', () => {
    expect(isInvoiceOverdue({ ...base, dueDate: null as unknown as string }, '2026-09-27')).toBe(false);
  });
});

describe('todayWireDate', () => {
  it('formats the local calendar date', () => {
    expect(todayWireDate(new Date(2026, 8, 7))).toBe('2026-09-07');
  });
});

import { describe, expect, it } from 'vitest';

import { canSendReminder, daysOverdue, hasOutstanding } from './reminder-eligibility';

const issued = {
  invoiceNumber: 'INV-000042',
  postingStatus: 'POSTED',
  documentStatus: 'APPROVED',
  outstandingAmount: '4500.00',
};

describe('canSendReminder', () => {
  it('offers a reminder for an issued invoice with a balance', () => {
    expect(canSendReminder(issued)).toBe(true);
    expect(canSendReminder({ ...issued, outstandingAmount: '0.01' })).toBe(true);
  });

  it.each([
    ['paid', { outstandingAmount: '0.00' }],
    ['no balance known', { outstandingAmount: null }],
    ['not posted', { postingStatus: 'NOT_POSTED' }],
    ['reversed', { postingStatus: 'REVERSED' }],
    ['cancelled', { documentStatus: 'CANCELLED' }],
    ['unnumbered', { invoiceNumber: null }],
  ])('withholds it when %s', (_, over) => {
    expect(canSendReminder({ ...issued, ...over })).toBe(false);
  });

  it('reads amounts without floats', () => {
    expect(hasOutstanding('-1.00')).toBe(false);
    expect(hasOutstanding('')).toBe(false);
    expect(hasOutstanding('12.50')).toBe(true);
  });
});

describe('daysOverdue', () => {
  const now = new Date('2026-10-03T22:00:00Z');
  it('counts whole UTC days past the due date', () => {
    expect(daysOverdue('2026-09-30', now)).toBe(3);
    expect(daysOverdue('2026-10-03', now)).toBe(0);
    expect(daysOverdue('2026-10-20', now)).toBe(0);
    expect(daysOverdue(null, now)).toBe(0);
  });
});

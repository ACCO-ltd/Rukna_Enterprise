import { Decimal } from '@prisma/client/runtime/library';

import { computeReceivablePosition, isLiveStageInvoice, scheduleBaseValue } from './receivable-position';

const d = (n: number) => new Decimal(n);
const today = new Date('2026-10-03T10:00:00Z');

describe('computeReceivablePosition', () => {
  it('takes billed-before-tax from each invoice, whatever its tax rate', () => {
    const p = computeReceivablePosition({
      invoices: [
        { subtotal: d(1_000), totalAmount: d(1_050), outstandingAmount: d(1_050), dueDate: null }, // 5%
        { subtotal: d(2_000), totalAmount: d(2_000), outstandingAmount: d(2_000), dueDate: null }, // exempt
        { subtotal: d(500), totalAmount: d(580), outstandingAmount: d(580), dueDate: null }, // 16%
      ],
      postedCreditNotesSum: d(0),
      postedCreditNotesNetSum: d(0),
      collectedSum: d(0),
      today,
    });
    expect(p.netBilledExclTax.toFixed(2)).toBe('3500.00');
    expect(p.netBilled.toFixed(2)).toBe('3630.00');
  });

  it('nets credit notes, keeps outstanding = netBilled − collected', () => {
    const p = computeReceivablePosition({
      invoices: [{ subtotal: d(100_000), totalAmount: d(105_000), outstandingAmount: d(54_500), dueDate: null }],
      postedCreditNotesSum: d(10_500),
      postedCreditNotesNetSum: d(10_000),
      collectedSum: d(40_000),
      today,
    });
    expect(p.netBilled.toFixed(2)).toBe('94500.00');
    // Before tax, from each document's own subtotal / net amount — no assumed rate.
    expect(p.netBilledExclTax.toFixed(2)).toBe('90000.00');
    expect(p.outstanding.toFixed(2)).toBe('54500.00');
    expect(p.netBilled.minus(p.collected).toFixed(2)).toBe(p.outstanding.toFixed(2));
    expect(p.overdue.toFixed(2)).toBe('0.00');
    expect(p.oldestDaysPastDue).toBeNull();
  });

  it('counts overdue only past the due date with a balance, and the oldest age', () => {
    const p = computeReceivablePosition({
      invoices: [
        { subtotal: d(0), totalAmount: d(10), outstandingAmount: d(10), dueDate: new Date('2026-10-03') }, // due today: not overdue
        { subtotal: d(0), totalAmount: d(20), outstandingAmount: d(20), dueDate: new Date('2026-09-30') }, // 3 days
        { subtotal: d(0), totalAmount: d(30), outstandingAmount: d(30), dueDate: new Date('2026-08-04') }, // 60 days
        { subtotal: d(0), totalAmount: d(40), outstandingAmount: d(0), dueDate: new Date('2026-01-01') }, // paid
      ],
      postedCreditNotesSum: d(0),
      postedCreditNotesNetSum: d(0),
      collectedSum: d(40),
      today,
    });
    expect(p.overdue.toFixed(2)).toBe('50.00');
    expect(p.overdueCount).toBe(2);
    expect(p.oldestDaysPastDue).toBe(60);
  });
});

describe('stage helpers', () => {
  it('a cancelled invoice does not bill its stage', () => {
    expect(isLiveStageInvoice({ documentStatus: 'CANCELLED' })).toBe(false);
    expect(isLiveStageInvoice({ documentStatus: 'DRAFT' })).toBe(true);
  });

  it('prices against the base value, falling back to the contract value', () => {
    expect(scheduleBaseValue({ baseContractValue: d(400), contractValue: d(500) }).toFixed(0)).toBe('400');
    expect(scheduleBaseValue({ baseContractValue: null, contractValue: d(500) }).toFixed(0)).toBe('500');
  });
});

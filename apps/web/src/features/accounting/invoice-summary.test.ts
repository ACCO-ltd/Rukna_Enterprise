import { describe, expect, it } from 'vitest';

import { invoiceSummary } from './invoice-summary';
import type { ClientInvoice } from './types';

const inv = (over: Partial<ClientInvoice>): ClientInvoice =>
  ({
    id: Math.random().toString(36),
    currencyCode: 'USD',
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    dueDate: '2026-11-30',
    totalAmount: '100.00',
    outstandingAmount: '100.00',
    retentionAmount: '0',
    retentionReleasedAmount: '0',
    contractId: 'c1',
    projectId: 'p1',
    ...over,
  }) as ClientInvoice;

const TODAY = '2026-10-28';

describe('invoiceSummary (Step 2c)', () => {
  it('splits live invoices into overdue and not-yet-due, and totals drafts', () => {
    const s = invoiceSummary(
      [
        inv({ dueDate: '2026-09-11', outstandingAmount: '40.10' }), // 47 days late
        inv({ dueDate: '2026-10-20', outstandingAmount: '10.00' }),
        inv({ dueDate: '2026-11-30', outstandingAmount: '0.10' }),
        inv({ documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED', totalAmount: '0.20' }),
        inv({ documentStatus: 'CANCELLED', totalAmount: '999.00' }),
      ],
      TODAY,
    );
    expect(s.overdue).toEqual({ count: 2, outstandingMinor: 5010, oldestDaysLate: 47 });
    expect(s.notDue).toEqual({ count: 1, outstandingMinor: 10 });
    expect(s.draft).toEqual({ count: 1, totalMinor: 20 });
    expect(s.currency).toBe('USD');
  });

  it('counts what has been collected and what is fully paid', () => {
    const s = invoiceSummary(
      [inv({ totalAmount: '100.00', outstandingAmount: '0.00' }), inv({ totalAmount: '50.00', outstandingAmount: '20.00' })],
      TODAY,
    );
    expect(s.collected).toEqual({ paidCount: 1, collectedMinor: 13000 });
  });

  it('nets retention released against retention held, per contract', () => {
    const s = invoiceSummary(
      [
        inv({ contractId: 'c1', retentionAmount: '25.00' }),
        inv({ contractId: 'c1', retentionAmount: '25.00' }),
        inv({ contractId: 'c1', retentionReleasedAmount: '20.00' }),
        inv({ contractId: 'c2', retentionAmount: '10.00' }),
        inv({ contractId: 'c3', retentionAmount: '5.00' }),
        inv({ contractId: 'c3', retentionReleasedAmount: '5.00' }), // fully released
        // Not live: a draft's retention is not held yet.
        inv({ contractId: 'c4', documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED', retentionAmount: '99.00' }),
      ],
      TODAY,
    );
    expect(s.retentionHeld).toEqual({ contracts: 2, heldMinor: 4000 });
  });

  it('refuses to add currencies together', () => {
    const s = invoiceSummary([inv({}), inv({ currencyCode: 'SOS' })], TODAY);
    expect(s.mixedCurrencies).toBe(true);
    expect(s.currency).toBeNull();
  });
});

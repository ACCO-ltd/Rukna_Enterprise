import { describe, expect, it } from 'vitest';

import {
  availableInvoiceActions,
  canApprove,
  canGenerateInvoice,
  canPost,
  canReverse,
  defaultDueDate,
  invoiceBlockReason,
} from './invoice-actions';
import type { ClientInvoice } from './types';

function invoice(overrides: Partial<ClientInvoice> = {}): ClientInvoice {
  return {
    id: 'inv-1',
    organizationId: 'org-1',
    invoiceNumber: null,
    invoiceDate: '2026-08-10',
    dueDate: '2026-09-09',
    clientId: 'client-1',
    sourceIpcId: 'ipc-1',
    projectId: 'proj-1',
    contractId: 'con-1',
    currencyCode: 'SOS',
    subtotal: '6190.48',
    vatAmount: '307.52',
    totalAmount: '6498.00',
    outstandingAmount: '6498.00',
    paymentTerms: 'Net 30',
    documentStatus: 'DRAFT',
    postingStatus: 'NOT_POSTED',
    postedJournalEntryId: null,
    postedAt: null,
    postedBy: null,
    reversedAt: null,
    reversalJournalEntryId: null,
    cancelledAt: null,
    cancellationReason: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: '2026-08-10T09:00:00.000Z',
    createdBy: 'user-1',
    ...overrides,
  };
}

describe('canApprove', () => {
  it('allows approval from DRAFT', () => {
    expect(canApprove(invoice())).toBe(true);
  });

  it.each(['APPROVED', 'CANCELLED'] as const)('refuses when already %s', (documentStatus) => {
    expect(canApprove(invoice({ documentStatus }))).toBe(false);
  });
});

describe('canPost', () => {
  it('allows posting an APPROVED invoice', () => {
    expect(canPost(invoice({ documentStatus: 'APPROVED' }))).toBe(true);
  });

  it('refuses a DRAFT — approval comes first', () => {
    expect(canPost(invoice({ documentStatus: 'DRAFT' }))).toBe(false);
  });

  it('refuses one already POSTED, which the server answers 409', () => {
    expect(canPost(invoice({ documentStatus: 'APPROVED', postingStatus: 'POSTED' }))).toBe(false);
  });

  it('allows retrying a FAILED posting rather than treating it as terminal', () => {
    expect(canPost(invoice({ documentStatus: 'APPROVED', postingStatus: 'FAILED' }))).toBe(true);
  });

  it('refuses a CANCELLED invoice', () => {
    expect(canPost(invoice({ documentStatus: 'CANCELLED' }))).toBe(false);
  });

  /**
   * These three are STRICTER THAN THE SERVER and must stay that way. The server checks only
   * `postingStatus !== 'POSTED'`, so it would accept all three.
   *
   * Re-posting a REVERSED invoice overwrites `invoiceNumber` with a fresh number from the
   * sequence and replaces `postedJournalEntryId` — breaking the audit trail and changing a
   * number already issued to a client. If a future change makes these pass, the divergence has
   * been "fixed" in the wrong direction.
   */
  it('refuses a REVERSED invoice, which the server would wrongly accept', () => {
    expect(
      canPost(
        invoice({
          documentStatus: 'APPROVED',
          postingStatus: 'REVERSED',
          reversalJournalEntryId: 'je-9',
        }),
      ),
    ).toBe(false);
  });

  it('refuses while a post is PENDING, so the button cannot double-post', () => {
    expect(canPost(invoice({ documentStatus: 'APPROVED', postingStatus: 'PENDING' }))).toBe(false);
  });

  it('refuses an OPENING_BALANCE invoice — the opening journal already covers it', () => {
    expect(
      canPost(invoice({ documentStatus: 'APPROVED', postingStatus: 'OPENING_BALANCE' })),
    ).toBe(false);
  });
});

describe('canReverse', () => {
  it('allows reversing a POSTED invoice', () => {
    expect(canReverse(invoice({ documentStatus: 'APPROVED', postingStatus: 'POSTED' }))).toBe(true);
  });

  it('refuses one that was never posted', () => {
    expect(canReverse(invoice({ postingStatus: 'NOT_POSTED' }))).toBe(false);
  });

  it('refuses a second reversal', () => {
    expect(
      canReverse(
        invoice({ postingStatus: 'POSTED', reversalJournalEntryId: 'je-9' }),
      ),
    ).toBe(false);
  });
});

describe('availableInvoiceActions', () => {
  it('offers only approve on a fresh draft', () => {
    expect(availableInvoiceActions(invoice())).toEqual(['approve']);
  });

  it('offers only post once approved', () => {
    expect(availableInvoiceActions(invoice({ documentStatus: 'APPROVED' }))).toEqual(['post']);
  });

  it('offers only reverse once posted', () => {
    expect(
      availableInvoiceActions(invoice({ documentStatus: 'APPROVED', postingStatus: 'POSTED' })),
    ).toEqual(['reverse']);
  });

  it('offers nothing on a reversed invoice — it is finished', () => {
    expect(
      availableInvoiceActions(
        invoice({
          documentStatus: 'APPROVED',
          postingStatus: 'REVERSED',
          reversalJournalEntryId: 'je-9',
        }),
      ),
    ).toEqual([]);
  });

  it('offers nothing on a cancelled invoice', () => {
    expect(availableInvoiceActions(invoice({ documentStatus: 'CANCELLED' }))).toEqual([]);
  });
});

describe('invoiceBlockReason', () => {
  it('is null when the action is available', () => {
    expect(invoiceBlockReason(invoice(), 'approve')).toBeNull();
  });

  it('says approval is needed before posting', () => {
    expect(invoiceBlockReason(invoice({ documentStatus: 'DRAFT' }), 'post')).toBe('not-approved');
  });

  it('distinguishes already-posted from not-approved', () => {
    const posted = invoice({ documentStatus: 'APPROVED', postingStatus: 'POSTED' });
    expect(invoiceBlockReason(posted, 'post')).toBe('already-posted');
  });

  it('distinguishes already-reversed from not-posted', () => {
    expect(invoiceBlockReason(invoice(), 'reverse')).toBe('not-posted');
    expect(
      invoiceBlockReason(
        invoice({ postingStatus: 'POSTED', reversalJournalEntryId: 'je-9' }),
        'reverse',
      ),
    ).toBe('already-reversed');
  });

  it('reports cancellation ahead of anything else', () => {
    const cancelled = invoice({ documentStatus: 'CANCELLED' });
    expect(invoiceBlockReason(cancelled, 'approve')).toBe('cancelled');
    expect(invoiceBlockReason(cancelled, 'post')).toBe('cancelled');
  });
});

describe('canGenerateInvoice', () => {
  it('allows an effective IPC with no invoice', () => {
    expect(canGenerateInvoice({ isEffective: true }, null)).toBe(true);
  });

  it('refuses an IPC that is not effective', () => {
    expect(canGenerateInvoice({ isEffective: false }, null)).toBe(false);
  });

  it('refuses a second invoice — the server enforces one per IPC', () => {
    expect(canGenerateInvoice({ isEffective: true }, invoice())).toBe(false);
  });
});

describe('defaultDueDate', () => {
  it('is 30 days after the invoice date', () => {
    expect(defaultDueDate('2026-08-10')).toBe('2026-09-09');
  });

  it('crosses a month boundary correctly', () => {
    expect(defaultDueDate('2026-01-20')).toBe('2026-02-19');
  });

  it('crosses a year boundary correctly', () => {
    expect(defaultDueDate('2026-12-20')).toBe('2027-01-19');
  });

  it('handles a leap day', () => {
    expect(defaultDueDate('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('accepts a custom term', () => {
    expect(defaultDueDate('2026-08-10', 60)).toBe('2026-10-09');
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(defaultDueDate('')).toBe('');
    expect(defaultDueDate('not-a-date')).toBe('not-a-date');
  });

  it('ignores a time component rather than letting a timezone shift the day', () => {
    expect(defaultDueDate('2026-08-10T23:30:00.000Z')).toBe('2026-09-09');
  });
});

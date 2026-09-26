import { describe, expect, it } from 'vitest';
import type { CommercialInvoiceRow, CommercialReceiptRow } from '@erp/types';

import {
  buildAllocationPreview,
  deriveAgingBucket,
  derivePaymentState,
  deriveDueStatus,
  toClientPaymentView,
  toClientReceivableView,
} from './collection-view-model';

const TODAY = '2026-09-17';

function makeInvoiceRow(overrides: Partial<CommercialInvoiceRow> = {}): CommercialInvoiceRow {
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-0001',
    source: { kind: 'INSTALLMENT', label: null, id: 'inst-1' },
    invoiceDate: '2026-08-01',
    dueDate: '2026-10-01',
    currency: 'USD',
    subtotal: '100000.00',
    vatAmount: '5000.00',
    totalAmount: '105000.00',
    paidAmount: '0.00',
    outstandingAmount: '105000.00',
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    status: 'UNPAID',
    daysOverdue: 0,
    ...overrides,
  } as CommercialInvoiceRow;
}

function makeReceiptRow(overrides: Partial<CommercialReceiptRow> = {}): CommercialReceiptRow {
  return {
    id: 'rcpt-1',
    receiptDate: '2026-09-10',
    currency: 'USD',
    totalAmount: '60000.00',
    allocatedAmount: '60000.00',
    unallocatedAmount: '0.00',
    allocatedToThisContract: '60000.00',
    paymentMethod: 'Bank transfer',
    reference: 'TT-001',
    postingStatus: 'POSTED',
    allocations: [
      {
        id: 'alloc-1',
        invoiceId: 'inv-1',
        invoiceNumber: 'INV-0001',
        allocatedAmount: '60000.00',
        allocationDate: '2026-09-10',
      },
    ],
    ...overrides,
  } as unknown as CommercialReceiptRow;
}

// ─── derivePaymentState ──────────────────────────────────────────────────────────

describe('derivePaymentState', () => {
  it('POSTED/UNPAID invoice with future due date → AWAITING_PAYMENT', () => {
    const row = makeInvoiceRow({ dueDate: '2026-10-01', status: 'UNPAID', daysOverdue: 0 });
    expect(derivePaymentState(row, TODAY)).toBe('AWAITING_PAYMENT');
  });

  it('PAID invoice → PAID', () => {
    const row = makeInvoiceRow({ status: 'PAID', outstandingAmount: '0.00' });
    expect(derivePaymentState(row, TODAY)).toBe('PAID');
  });

  it('dueDate < today AND outstanding > 0 → OVERDUE', () => {
    const row = makeInvoiceRow({
      dueDate: '2026-09-01',
      outstandingAmount: '10000.00',
      status: 'UNPAID',
      daysOverdue: 16,
    });
    expect(derivePaymentState(row, TODAY)).toBe('OVERDUE');
  });

  it('null dueDate → paymentState never OVERDUE (even with outstanding balance)', () => {
    const row = makeInvoiceRow({ dueDate: null, outstandingAmount: '10000.00', status: 'UNPAID', daysOverdue: 0 });
    expect(derivePaymentState(row, TODAY)).toBe('AWAITING_PAYMENT');
    expect(derivePaymentState(row, TODAY)).not.toBe('OVERDUE');
  });

  it('PARTIALLY_PAID invoice with future due date → PARTIALLY_PAID', () => {
    const row = makeInvoiceRow({
      status: 'PARTIALLY_PAID',
      dueDate: '2026-10-01',
      paidAmount: '50000.00',
      outstandingAmount: '55000.00',
    });
    expect(derivePaymentState(row, TODAY)).toBe('PARTIALLY_PAID');
  });

  it('PARTIALLY_PAID invoice past due date → OVERDUE (overdue overlays partial)', () => {
    const row = makeInvoiceRow({
      status: 'PARTIALLY_PAID',
      dueDate: '2026-09-01',
      outstandingAmount: '55000.00',
      daysOverdue: 16,
    });
    expect(derivePaymentState(row, TODAY)).toBe('OVERDUE');
  });

  it('status DRAFT → DRAFT', () => {
    const row = makeInvoiceRow({ status: 'DRAFT', documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' });
    expect(derivePaymentState(row, TODAY)).toBe('DRAFT');
  });

  it('status AWAITING_POSTING (approved, not yet posted to GL) → DRAFT', () => {
    const row = makeInvoiceRow({ status: 'AWAITING_POSTING', documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED' });
    expect(derivePaymentState(row, TODAY)).toBe('DRAFT');
  });

  it('CANCELLED → CANCELLED', () => {
    expect(derivePaymentState(makeInvoiceRow({ status: 'CANCELLED' }), TODAY)).toBe('CANCELLED');
  });
});

// ─── toClientReceivableView ──────────────────────────────────────────────────────

describe('toClientReceivableView', () => {
  it('maps outstanding, paid, and total from the invoice row (spec §15 test 1)', () => {
    const row = makeInvoiceRow({ totalAmount: '105000.00', paidAmount: '0.00', outstandingAmount: '105000.00' });
    const view = toClientReceivableView(row, TODAY);
    expect(view.total).toBe('105000.00');
    expect(view.paid).toBe('0.00');
    expect(view.outstanding).toBe('105000.00');
    expect(view.paymentState).toBe('AWAITING_PAYMENT');
  });

  it('PAID invoice → canRecordPayment: false (spec §15 test 2)', () => {
    const view = toClientReceivableView(
      makeInvoiceRow({ status: 'PAID', outstandingAmount: '0.00', paidAmount: '105000.00' }),
      TODAY,
    );
    expect(view.canRecordPayment).toBe(false);
  });

  it('PARTIALLY_PAID invoice → paid and outstanding both non-zero (spec §15 test 3)', () => {
    const row = makeInvoiceRow({
      status: 'PARTIALLY_PAID',
      dueDate: '2026-10-01',
      paidAmount: '50000.00',
      outstandingAmount: '55000.00',
    });
    const view = toClientReceivableView(row, TODAY);
    expect(parseFloat(view.paid!)).toBe(50000);
    expect(parseFloat(view.outstanding!)).toBe(55000);
    expect(view.paymentState).toBe('PARTIALLY_PAID');
  });

  it('overdue invoice has paymentState OVERDUE (spec §15 test 4)', () => {
    const row = makeInvoiceRow({ dueDate: '2026-09-01', outstandingAmount: '10000.00', status: 'UNPAID', daysOverdue: 16 });
    expect(toClientReceivableView(row, TODAY).paymentState).toBe('OVERDUE');
  });

  it('null dueDate → paymentState never OVERDUE (spec §15 test 5)', () => {
    const row = makeInvoiceRow({ dueDate: null, outstandingAmount: '10000.00', status: 'UNPAID', daysOverdue: 0 });
    const view = toClientReceivableView(row, TODAY);
    expect(view.paymentState).not.toBe('OVERDUE');
  });

  it('two independent invoice rows stay financially separate — no summing (spec §15 test 10)', () => {
    const milestone = makeInvoiceRow({ id: 'inv-m', outstandingAmount: '150000.00' });
    const vo = makeInvoiceRow({ id: 'inv-vo', source: { kind: 'IPC', label: null, id: 'vo-1' }, outstandingAmount: '2000.00' });
    const mView = toClientReceivableView(milestone, TODAY);
    const vView = toClientReceivableView(vo, TODAY);
    expect(mView.outstanding).toBe('150000.00');
    expect(vView.outstanding).toBe('2000.00');
    // Each view holds only its own balance — they are not summed or cross-referenced
    expect(mView.invoiceId).not.toBe(vView.invoiceId);
  });

  it('DRAFT status → canRecordPayment: false', () => {
    const view = toClientReceivableView(
      makeInvoiceRow({ status: 'DRAFT', documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' }),
      TODAY,
    );
    expect(view.canRecordPayment).toBe(false);
  });

  it('AWAITING_POSTING → canRecordPayment: false', () => {
    const view = toClientReceivableView(
      makeInvoiceRow({ status: 'AWAITING_POSTING', documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED' }),
      TODAY,
    );
    expect(view.canRecordPayment).toBe(false);
  });

  it('composes "{kind} · {reference}" when the server provides a source label', () => {
    const row = makeInvoiceRow({ source: { kind: 'INSTALLMENT', label: 'Structure', id: 'inst-2' } });
    expect(toClientReceivableView(row, TODAY).sourceLabel).toBe('Milestone · Structure');
  });

  it('composes the SEPARATE_CHARGE kind with its BOQ leaf description', () => {
    const row = makeInvoiceRow({ source: { kind: 'SEPARATE_CHARGE', label: 'shamiito', id: 'node-9' } });
    expect(toClientReceivableView(row, TODAY).sourceLabel).toBe('Separate charge · shamiito');
  });

  it('falls back to the bare kind word when source.label is null', () => {
    const row = makeInvoiceRow({ source: { kind: 'IPC', label: null, id: null } });
    expect(toClientReceivableView(row, TODAY).sourceLabel).toBe('IPC');
  });

  it('falls back to the bare kind word for a migration-loaded (NONE) invoice, never a raw label', () => {
    const row = makeInvoiceRow({ source: { kind: 'NONE', label: null, id: null } });
    expect(toClientReceivableView(row, TODAY).sourceLabel).toBe('Invoice');
  });
});

// ─── buildAllocationPreview ──────────────────────────────────────────────────────

describe('buildAllocationPreview', () => {
  function makeReceivable(id: string, outstanding: string, invoiceNumber = `INV-${id}`) {
    return toClientReceivableView(makeInvoiceRow({ id, outstandingAmount: outstanding, invoiceNumber }), TODAY);
  }

  it('distributes greedily — fills first invoice then remainder to second (spec §15 test 6)', () => {
    const lines = buildAllocationPreview('60000.00', [
      makeReceivable('a', '40000.00'),
      makeReceivable('b', '30000.00'),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].suggested).toBe('40000.00');
    expect(lines[1].suggested).toBe('20000.00');
  });

  it('total allocation never exceeds receipt amount (spec §15 test 7)', () => {
    const lines = buildAllocationPreview('50000.00', [
      makeReceivable('a', '40000.00'),
      makeReceivable('b', '30000.00'),
    ]);
    const total = lines.reduce((sum, l) => sum + parseFloat(l.suggested), 0);
    expect(total).toBeLessThanOrEqual(50000);
    expect(total).toBe(50000);
  });

  it('per-invoice suggestion capped at its own outstanding — never exceeds max (spec §15 test 8)', () => {
    const lines = buildAllocationPreview('100000.00', [makeReceivable('a', '20000.00')]);
    expect(lines).toHaveLength(1);
    expect(lines[0].suggested).toBe('20000.00');
    expect(lines[0].max).toBe('20000.00');
  });

  it('unallocated remainder exists when amount exceeds total outstanding (spec §15 test 9)', () => {
    // amount=100k, only one invoice with 60k outstanding → 40k unallocated
    const lines = buildAllocationPreview('100000.00', [makeReceivable('a', '60000.00')]);
    const allocated = lines.reduce((sum, l) => sum + parseFloat(l.suggested), 0);
    expect(allocated).toBe(60000);
    // Caller is responsible for showing the remainder; here we verify only 60k was allocated
    expect(parseFloat('100000.00') - allocated).toBe(40000);
  });

  it('skips PAID invoices (canRecordPayment === false)', () => {
    const paid = toClientReceivableView(
      makeInvoiceRow({ id: 'paid', status: 'PAID', outstandingAmount: '0.00', paidAmount: '105000.00' }),
      TODAY,
    );
    const unpaid = makeReceivable('open', '10000.00');
    const lines = buildAllocationPreview('50000.00', [paid, unpaid]);
    expect(lines).toHaveLength(1);
    expect(lines[0].invoiceId).toBe('open');
  });

  it('allocates to the invoice the user selected before other open invoices', () => {
    const lines = buildAllocationPreview(
      '15000.00',
      [makeReceivable('a', '40000.00'), makeReceivable('b', '30000.00')],
      'b',
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ invoiceId: 'b', suggested: '15000.00' });
  });

  it('returns empty array when amount is zero or empty', () => {
    expect(buildAllocationPreview('0.00', [makeReceivable('a', '10000.00')])).toEqual([]);
    expect(buildAllocationPreview('', [makeReceivable('a', '10000.00')])).toEqual([]);
  });
});

// ─── toClientPaymentView ─────────────────────────────────────────────────────────

describe('toClientPaymentView', () => {
  it('maps receipt fields correctly', () => {
    const row = makeReceiptRow();
    const view = toClientPaymentView(row);
    expect(view.receiptId).toBe('rcpt-1');
    expect(view.total).toBe('60000.00');
    expect(view.unallocated).toBe('0.00');
    expect(view.method).toBe('Bank transfer');
    expect(view.reference).toBe('TT-001');
    expect(view.allocations).toHaveLength(1);
    expect(view.allocations[0].invoiceNumber).toBe('INV-0001');
    expect(view.allocations[0].amount).toBe('60000.00');
  });

  it('exposes unallocated > 0 when receipt is only partially applied', () => {
    const row = makeReceiptRow({ totalAmount: '100000.00', allocatedAmount: '60000.00', unallocatedAmount: '40000.00' });
    const view = toClientPaymentView(row);
    expect(parseFloat(view.unallocated!)).toBe(40000);
  });
});

// ─── deriveDueStatus ──────────────────────────────────────────────────────────

describe('deriveDueStatus', () => {
  it('null dueDate → null (never flagged, regardless of outstanding balance)', () => {
    expect(deriveDueStatus(null, '10000.00', TODAY)).toBeNull();
    expect(deriveDueStatus(null, '0.00', TODAY)).toBeNull();
  });

  it('dueDate === today → DUE_TODAY', () => {
    expect(deriveDueStatus(TODAY, '10000.00', TODAY)).toBe('DUE_TODAY');
  });

  it('dueDate is 3 days from today → DUE_SOON', () => {
    expect(deriveDueStatus('2026-09-20', '10000.00', TODAY)).toBe('DUE_SOON');
  });

  it('dueDate is 7 days from today → DUE_SOON (inclusive boundary)', () => {
    expect(deriveDueStatus('2026-09-24', '10000.00', TODAY)).toBe('DUE_SOON');
  });

  it('dueDate is 8 days from today → CURRENT', () => {
    expect(deriveDueStatus('2026-09-25', '10000.00', TODAY)).toBe('CURRENT');
  });

  it('dueDate is past today with outstanding balance → OVERDUE', () => {
    expect(deriveDueStatus('2026-09-01', '10000.00', TODAY)).toBe('OVERDUE');
  });

  it('dueDate is past today but outstanding is zero → CURRENT (already settled)', () => {
    expect(deriveDueStatus('2026-09-01', '0.00', TODAY)).toBe('CURRENT');
  });

  it('dueDate is past today but outstanding is null → CURRENT (no financial visibility)', () => {
    expect(deriveDueStatus('2026-09-01', null, TODAY)).toBe('CURRENT');
  });
});

// ─── deriveAgingBucket ────────────────────────────────────────────────────────

describe('deriveAgingBucket', () => {
  it('0 days → null (not overdue)', () => {
    expect(deriveAgingBucket(0)).toBeNull();
  });

  it('negative days → null', () => {
    expect(deriveAgingBucket(-5)).toBeNull();
  });

  it('1 day → DAYS_1_7', () => {
    expect(deriveAgingBucket(1)).toBe('DAYS_1_7');
  });

  it('7 days → DAYS_1_7 (upper boundary)', () => {
    expect(deriveAgingBucket(7)).toBe('DAYS_1_7');
  });

  it('8 days → DAYS_8_30', () => {
    expect(deriveAgingBucket(8)).toBe('DAYS_8_30');
  });

  it('30 days → DAYS_8_30 (upper boundary)', () => {
    expect(deriveAgingBucket(30)).toBe('DAYS_8_30');
  });

  it('31 days → DAYS_31_60', () => {
    expect(deriveAgingBucket(31)).toBe('DAYS_31_60');
  });

  it('60 days → DAYS_31_60 (upper boundary)', () => {
    expect(deriveAgingBucket(60)).toBe('DAYS_31_60');
  });

  it('61 days → DAYS_61_90', () => {
    expect(deriveAgingBucket(61)).toBe('DAYS_61_90');
  });

  it('90 days → DAYS_61_90 (upper boundary)', () => {
    expect(deriveAgingBucket(90)).toBe('DAYS_61_90');
  });

  it('91 days → DAYS_90_PLUS', () => {
    expect(deriveAgingBucket(91)).toBe('DAYS_90_PLUS');
  });

  it('200 days → DAYS_90_PLUS', () => {
    expect(deriveAgingBucket(200)).toBe('DAYS_90_PLUS');
  });
});

// ─── toClientReceivableView — new fields ─────────────────────────────────────

describe('toClientReceivableView — Slice 6A fields', () => {
  it('sets dueStatus OVERDUE for a past-due invoice with balance', () => {
    const row = makeInvoiceRow({ dueDate: '2026-09-01', outstandingAmount: '10000.00', status: 'UNPAID', daysOverdue: 16 });
    const view = toClientReceivableView(row, TODAY);
    expect(view.dueStatus).toBe('OVERDUE');
  });

  it('sets dueStatus DUE_TODAY when dueDate matches today', () => {
    const row = makeInvoiceRow({ dueDate: TODAY, outstandingAmount: '10000.00', status: 'UNPAID', daysOverdue: 0 });
    const view = toClientReceivableView(row, TODAY);
    expect(view.dueStatus).toBe('DUE_TODAY');
  });

  it('sets dueStatus DUE_SOON for invoice due within 7 days', () => {
    const row = makeInvoiceRow({ dueDate: '2026-09-20', outstandingAmount: '10000.00', status: 'UNPAID', daysOverdue: 0 });
    const view = toClientReceivableView(row, TODAY);
    expect(view.dueStatus).toBe('DUE_SOON');
  });

  it('sets dueStatus CURRENT for far-future due date', () => {
    const row = makeInvoiceRow({ dueDate: '2026-11-01', outstandingAmount: '10000.00', status: 'UNPAID', daysOverdue: 0 });
    const view = toClientReceivableView(row, TODAY);
    expect(view.dueStatus).toBe('CURRENT');
  });

  it('sets dueStatus null for null dueDate', () => {
    const row = makeInvoiceRow({ dueDate: null, outstandingAmount: '10000.00', status: 'UNPAID', daysOverdue: 0 });
    expect(toClientReceivableView(row, TODAY).dueStatus).toBeNull();
  });

  it('sets dueStatus null for PAID invoice', () => {
    const row = makeInvoiceRow({ status: 'PAID', outstandingAmount: '0.00', dueDate: '2026-09-01', daysOverdue: 0 });
    expect(toClientReceivableView(row, TODAY).dueStatus).toBeNull();
  });

  it('sets agingBucket for overdue invoice (server-reported daysOverdue)', () => {
    const row = makeInvoiceRow({ dueDate: '2026-09-01', status: 'UNPAID', outstandingAmount: '10000.00', daysOverdue: 16 });
    const view = toClientReceivableView(row, TODAY);
    expect(view.agingBucket).toBe('DAYS_8_30');
  });

  it('sets agingBucket null for current invoice', () => {
    const row = makeInvoiceRow({ dueDate: '2026-10-01', status: 'UNPAID', daysOverdue: 0 });
    expect(toClientReceivableView(row, TODAY).agingBucket).toBeNull();
  });

  it('maps sentAt from the invoice row', () => {
    const row = makeInvoiceRow({ sentAt: '2026-08-05T10:00:00.000Z' } as never);
    expect(toClientReceivableView(row, TODAY).sentAt).toBe('2026-08-05T10:00:00.000Z');
  });

  it('sentAt is null when not present on invoice row', () => {
    const row = makeInvoiceRow();
    expect(toClientReceivableView(row, TODAY).sentAt).toBeNull();
  });
});

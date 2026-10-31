import { describe, expect, it } from 'vitest';

import { invoiceDocumentModel, invoiceSettlement } from './invoice-document-model';
import type { ClientInvoice } from './types';

const inv = (over: Partial<ClientInvoice>): ClientInvoice =>
  ({
    id: 'i1',
    invoiceNumber: 'INV-000001',
    currencyCode: 'USD',
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    source: { kind: 'IPC', label: 'IPA 1', id: 'ipc1' },
    subtotal: '0',
    totalAmount: '0',
    outstandingAmount: '0',
    retentionAmount: '0',
    advanceRecoveryAmount: '0',
    retentionReleasedAmount: '0',
    otherDeductionsAmount: '0',
    certifiedGrossAmount: null,
    ...over,
  }) as ClientInvoice;

/** Lines − deductions − holdbacks must equal the server's total, or the page would lie. */
const ties = (m: ReturnType<typeof invoiceDocumentModel>) =>
  m.lines.reduce((s, l) => s + l.amountMinor, 0) -
  m.lessBeforeSubtotal.reduce((s, a) => s + a.minor, 0) -
  m.lessAfterSubtotal.reduce((s, a) => s + a.minor, 0);

describe('invoiceDocumentModel', () => {
  it('lays a certificate out at gross, less other deductions, less retention and advance', () => {
    const m = invoiceDocumentModel(
      inv({
        billingAddressSnapshot: { description: 'Interim Certificate #2' },
        certifiedGrossAmount: '200000',
        otherDeductionsAmount: '1000',
        subtotal: '199000',
        retentionAmount: '10000',
        advanceRecoveryAmount: '5000',
        totalAmount: '184000',
      }),
    );
    expect(m.lines).toEqual([
      expect.objectContaining({ description: 'Interim Certificate #2', amountMinor: 20_000_000 }),
    ]);
    expect(m.lessBeforeSubtotal).toEqual([{ kind: 'OTHER_DEDUCTIONS', minor: 100_000 }]);
    expect(m.subtotalMinor).toBe(19_900_000);
    expect(m.lessAfterSubtotal.map((a) => a.kind)).toEqual(['RETENTION', 'ADVANCE_RECOVERY']);
    expect(ties(m)).toBe(m.totalMinor);
  });

  it('bills a retention release at the released amount (its subtotal is 0)', () => {
    const m = invoiceDocumentModel(
      inv({
        source: { kind: 'RETENTION_RELEASE', label: 'C1', id: 'c1' },
        retentionReleasedAmount: '22500',
        totalAmount: '22500',
      }),
    );
    expect(m.lines[0]!.amountMinor).toBe(2_250_000);
    expect(ties(m)).toBe(m.totalMinor);
  });

  it('keeps a hand-typed sale’s own lines and accounts', () => {
    const m = invoiceDocumentModel(
      inv({
        isManual: true,
        source: { kind: 'MANUAL', label: null, id: null },
        lines: [
          {
            lineNo: 1,
            description: 'Crane hire',
            quantity: '3',
            unitPrice: '400.00',
            amount: '1200.00',
            revenueAccountCode: '42100',
          },
          {
            lineNo: 2,
            description: 'Transport',
            quantity: '1',
            unitPrice: '200.00',
            amount: '200.00',
            revenueAccountCode: '42100',
          },
        ],
        subtotal: '1400',
        totalAmount: '1400',
      }),
    );
    expect(m.lines.map((l) => [l.description, l.accountCode, l.amountMinor])).toEqual([
      ['Crane hire', '42100', 120_000],
      ['Transport', '42100', 20_000],
    ]);
    expect(m.subtotalMinor).toBe(140_000);
    expect(ties(m)).toBe(m.totalMinor);
  });
});

describe('invoiceSettlement', () => {
  it('splits what settled a posted invoice by kind; the parts add up to the total', () => {
    const s = invoiceSettlement(
      inv({
        totalAmount: '580',
        amountPaid: '200.00',
        amountCredited: '50.00',
        amountWrittenOff: '10.00',
        outstandingAmount: '320',
      }),
    );
    expect(s).toMatchObject({
      live: true,
      paidMinor: 20_000,
      creditedMinor: 5_000,
      writtenOffMinor: 1_000,
      balanceMinor: 32_000,
    });
    expect(s.paidMinor + s.creditedMinor + s.writtenOffMinor + s.balanceMinor).toBe(s.totalMinor);
  });

  it('a draft, a cancelled and a reversed invoice owe nothing', () => {
    for (const over of [
      { documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' },
      { documentStatus: 'CANCELLED', postingStatus: 'NOT_POSTED' },
      { postingStatus: 'REVERSED' },
    ] as Partial<ClientInvoice>[]) {
      expect(
        invoiceSettlement(inv({ totalAmount: '100', outstandingAmount: '100', ...over }))
          .balanceMinor,
      ).toBe(0);
    }
  });
});

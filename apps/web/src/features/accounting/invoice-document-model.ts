import { MONEY_SCALE, toMinorUnits } from '@/lib/money';

import type { ClientInvoice } from './types';

/**
 * An invoice laid out the way the client reads it: lines, the adjustments between them and the
 * total, then what has settled it. Pure and in minor units. Every figure is the server's; this only
 * arranges them, so the page and the PDF cannot disagree on an amount.
 *
 * Contract invoices carry one line, at the certificate's gross for an IPC (the subtotal is gross
 * less other deductions, ADR-046 §5) and at the released amount for a retention release (whose
 * subtotal is 0). A hand-typed sale carries its own lines (ADR-048).
 */
export interface InvoiceDocumentLine {
  key: string;
  description: string;
  quantity: string | null;
  unitPrice: string | null;
  accountCode: string | null;
  amountMinor: number;
}

export type InvoiceAdjustmentKind = 'OTHER_DEDUCTIONS' | 'RETENTION' | 'ADVANCE_RECOVERY';

export interface InvoiceDocumentModel {
  lines: InvoiceDocumentLine[];
  /** Taken off before the subtotal: only other deductions on a certificate. */
  lessBeforeSubtotal: { kind: InvoiceAdjustmentKind; minor: number }[];
  subtotalMinor: number;
  /** Held back after the subtotal: retention and advance recovery. */
  lessAfterSubtotal: { kind: InvoiceAdjustmentKind; minor: number }[];
  totalMinor: number;
}

const minor = (value: string | null | undefined) => (value ? toMinorUnits(value, MONEY_SCALE) : 0);

export function invoiceDocumentModel(invoice: ClientInvoice): InvoiceDocumentModel {
  const manualLines = invoice.isManual ? (invoice.lines ?? []) : [];
  const description =
    invoice.billingAddressSnapshot?.description?.trim() ||
    invoice.source.label ||
    invoice.invoiceNumber ||
    '—';
  const gross = minor(invoice.certifiedGrossAmount);
  const released = minor(invoice.retentionReleasedAmount);
  const other = minor(invoice.otherDeductionsAmount);

  const lines: InvoiceDocumentLine[] =
    manualLines.length > 0
      ? manualLines.map((l) => ({
          key: String(l.lineNo),
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          accountCode: l.revenueAccountCode,
          amountMinor: minor(l.amount),
        }))
      : [
          {
            key: 'source',
            description,
            quantity: null,
            unitPrice: null,
            accountCode: null,
            amountMinor:
              gross > 0
                ? gross
                : released > 0 && minor(invoice.subtotal) === 0
                  ? released
                  : minor(invoice.subtotal),
          },
        ];

  const after = (kind: InvoiceAdjustmentKind, value: string | undefined) =>
    minor(value) > 0 ? [{ kind, minor: minor(value) }] : [];

  return {
    lines,
    lessBeforeSubtotal: gross > 0 && other > 0 ? [{ kind: 'OTHER_DEDUCTIONS', minor: other }] : [],
    subtotalMinor: lines.reduce((sum, l) => sum + l.amountMinor, 0) - (gross > 0 ? other : 0),
    lessAfterSubtotal: [
      ...after('RETENTION', invoice.retentionAmount),
      ...after('ADVANCE_RECOVERY', invoice.advanceRecoveryAmount),
    ],
    totalMinor: minor(invoice.totalAmount),
  };
}

/**
 * What the client owes and why, in the order a statement reads: total, then each kind of
 * settlement, then the balance. `live` is false for a draft, cancelled or reversed invoice — it
 * owes nothing, so the page shows no balance rather than a misleading figure.
 */
export interface InvoiceSettlement {
  live: boolean;
  totalMinor: number;
  paidMinor: number;
  creditedMinor: number;
  writtenOffMinor: number;
  balanceMinor: number;
}

export function invoiceSettlement(invoice: ClientInvoice): InvoiceSettlement {
  const live =
    invoice.documentStatus !== 'CANCELLED' &&
    (invoice.postingStatus === 'POSTED' || invoice.postingStatus === 'OPENING_BALANCE');
  return {
    live,
    totalMinor: minor(invoice.totalAmount),
    paidMinor: minor(invoice.amountPaid),
    creditedMinor: minor(invoice.amountCredited),
    writtenOffMinor: minor(invoice.amountWrittenOff),
    balanceMinor: live ? minor(invoice.outstandingAmount) : 0,
  };
}

import { MONEY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import type { ClientReceivableView } from '../lib/collection-view-model';

/**
 * Pure rules behind the Record payment dialog, in integer minor units (lib/money.ts) so a
 * receipt split across invoices never drifts by a cent.
 */

export interface PayableInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  sourceLabel: string;
  dueDate: string | null;
  /** Decimal string — the balance still owed. */
  outstanding: string;
  outstandingMinor: number;
}

/**
 * Invoices a receipt can be applied to, OLDEST DUE FIRST (no due date last, then by issue date),
 * with the invoice the user started from — if any — at the top.
 */
export function payableInvoices(
  invoices: ClientReceivableView[],
  preselectedId?: string | null,
): PayableInvoice[] {
  const rows = invoices
    .filter((invoice) => invoice.canRecordPayment && invoice.outstanding !== null)
    .map((invoice) => ({
      invoice,
      outstandingMinor: parseMinorUnits(invoice.outstanding, MONEY_SCALE) ?? 0,
    }))
    .filter((row) => row.outstandingMinor > 0);

  rows.sort((a, b) => {
    if (a.invoice.invoiceId === preselectedId) return -1;
    if (b.invoice.invoiceId === preselectedId) return 1;
    const dueA = a.invoice.dueDate ?? '9999-12-31';
    const dueB = b.invoice.dueDate ?? '9999-12-31';
    if (dueA !== dueB) return dueA < dueB ? -1 : 1;
    return a.invoice.issuedAt < b.invoice.issuedAt ? -1 : a.invoice.issuedAt > b.invoice.issuedAt ? 1 : 0;
  });

  return rows.map(({ invoice, outstandingMinor }) => ({
    invoiceId: invoice.invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    sourceLabel: invoice.sourceLabel,
    dueDate: invoice.dueDate,
    outstanding: fromMinorUnits(outstandingMinor, MONEY_SCALE),
    outstandingMinor,
  }));
}

/** Fill each invoice up to its balance, in order, until the received amount runs out. */
export function prefillAllocations(
  receivedMinor: number,
  invoices: PayableInvoice[],
): Record<string, string> {
  let remaining = Math.max(0, receivedMinor);
  const result: Record<string, string> = {};
  for (const invoice of invoices) {
    const applied = Math.min(invoice.outstandingMinor, remaining);
    remaining -= applied;
    result[invoice.invoiceId] = applied > 0 ? fromMinorUnits(applied, MONEY_SCALE) : '';
  }
  return result;
}

export interface AllocationCheck {
  receivedMinor: number | null;
  appliedMinor: number;
  /** Received − applied, when positive: stays on the client's account as credit. */
  unappliedMinor: number;
  /** invoiceId → problem with that line. */
  lineErrors: Record<string, 'INVALID' | 'OVER_BALANCE'>;
  overApplied: boolean;
  valid: boolean;
}

export function checkAllocations(
  received: string,
  invoices: PayableInvoice[],
  amounts: Record<string, string>,
): AllocationCheck {
  const receivedMinor = received.trim() === '' ? null : parseMinorUnits(received, MONEY_SCALE);
  const lineErrors: AllocationCheck['lineErrors'] = {};
  let appliedMinor = 0;

  for (const invoice of invoices) {
    const raw = (amounts[invoice.invoiceId] ?? '').trim();
    if (raw === '') continue;
    const minor = parseMinorUnits(raw, MONEY_SCALE);
    if (minor === null || minor < 0) {
      lineErrors[invoice.invoiceId] = 'INVALID';
      continue;
    }
    if (minor > invoice.outstandingMinor) lineErrors[invoice.invoiceId] = 'OVER_BALANCE';
    appliedMinor += minor;
  }

  const overApplied = receivedMinor !== null && appliedMinor > receivedMinor;
  const unappliedMinor =
    receivedMinor !== null && receivedMinor > appliedMinor ? receivedMinor - appliedMinor : 0;

  return {
    receivedMinor,
    appliedMinor,
    unappliedMinor,
    lineErrors,
    overApplied,
    valid:
      receivedMinor !== null &&
      receivedMinor > 0 &&
      !overApplied &&
      Object.keys(lineErrors).length === 0,
  };
}

/** The allocation lines the API takes: positive amounts only, as numbers (the DTO's type). */
export function allocationPayload(
  invoices: PayableInvoice[],
  amounts: Record<string, string>,
): Array<{ clientInvoiceId: string; amount: number }> {
  return invoices
    .map((invoice) => ({
      clientInvoiceId: invoice.invoiceId,
      minor: parseMinorUnits((amounts[invoice.invoiceId] ?? '').trim() || '0', MONEY_SCALE) ?? 0,
    }))
    .filter((line) => line.minor > 0)
    .map((line) => ({
      clientInvoiceId: line.clientInvoiceId,
      amount: Number(fromMinorUnits(line.minor, MONEY_SCALE)),
    }));
}

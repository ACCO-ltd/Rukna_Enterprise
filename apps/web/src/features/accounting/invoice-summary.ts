import { sumMinorUnits, toMinorUnits } from '@/lib/money';

import { isInvoiceOverdue } from './invoice-overdue';
import type { ClientInvoice } from './types';

/**
 * Step 2c (ADR-047): the figures above the invoice list. Pure, in minor units (scale 2), so the
 * tiles never show a float sum. "Live" = approved and posted — the only invoices that owe money.
 *
 * Every figure is in ONE currency. A company billing in several gets `mixedCurrencies` instead
 * of a total that adds dollars to shillings.
 */
export interface InvoiceSummary {
  currency: string | null;
  mixedCurrencies: boolean;
  draft: { count: number; totalMinor: number };
  overdue: { count: number; outstandingMinor: number; oldestDaysLate: number };
  notDue: { count: number; outstandingMinor: number };
  /** Cash received against live invoices (receipts applied), and how many are fully settled. */
  collected: { paidCount: number; collectedMinor: number };
  /** What live invoices still owe: overdue plus not yet due. */
  outstanding: { count: number; outstandingMinor: number };
  /** Retention the clients hold back on IPC invoices, less what release invoices have billed. */
  retentionHeld: { contracts: number; heldMinor: number };
  /** Live invoices dated in `today`'s calendar year, and their total. */
  billedThisYear: { count: number; totalMinor: number };
}

const SCALE = 2;
const DAY_MS = 86_400_000;

function daysBetween(fromWireDate: string, toWireDate: string): number {
  return Math.round((Date.parse(toWireDate) - Date.parse(fromWireDate.slice(0, 10))) / DAY_MS);
}

export function invoiceSummary(invoices: readonly ClientInvoice[], today: string): InvoiceSummary {
  const relevant = invoices.filter((i) => i.documentStatus !== 'CANCELLED' && i.postingStatus !== 'REVERSED');
  const currencies = new Set(relevant.map((i) => i.currencyCode));
  const live = relevant.filter((i) => i.documentStatus === 'APPROVED' && i.postingStatus === 'POSTED');
  const drafts = relevant.filter((i) => i.documentStatus === 'DRAFT');
  const overdue = live.filter((i) => isInvoiceOverdue(i, today));
  const notDue = live.filter((i) => !isInvoiceOverdue(i, today) && toMinorUnits(i.outstandingAmount, SCALE) > 0);

  const retainedByContract = new Map<string, number>();
  for (const inv of live) {
    const key = inv.contractId ?? inv.projectId ?? inv.id;
    const delta = toMinorUnits(inv.retentionAmount, SCALE) - toMinorUnits(inv.retentionReleasedAmount, SCALE);
    if (delta !== 0) retainedByContract.set(key, (retainedByContract.get(key) ?? 0) + delta);
  }
  const held = [...retainedByContract.values()].filter((v) => v > 0);

  return {
    currency: currencies.size === 1 ? [...currencies][0]! : null,
    mixedCurrencies: currencies.size > 1,
    draft: { count: drafts.length, totalMinor: sumMinorUnits(drafts.map((i) => i.totalAmount), SCALE) },
    overdue: {
      count: overdue.length,
      outstandingMinor: sumMinorUnits(overdue.map((i) => i.outstandingAmount), SCALE),
      oldestDaysLate: overdue.reduce((max, i) => Math.max(max, daysBetween(i.dueDate, today)), 0),
    },
    notDue: { count: notDue.length, outstandingMinor: sumMinorUnits(notDue.map((i) => i.outstandingAmount), SCALE) },
    outstanding: {
      count: overdue.length + notDue.length,
      outstandingMinor: sumMinorUnits([...overdue, ...notDue].map((i) => i.outstandingAmount), SCALE),
    },
    collected: {
      paidCount: live.filter((i) => toMinorUnits(i.outstandingAmount, SCALE) === 0).length,
      // CI-3 — cash received only. Total less balance also counted credit notes and write-offs as
      // collected. An API too old to send `amountPaid` falls back to that difference.
      collectedMinor: live.reduce(
        (sum, i) =>
          sum +
          (i.amountPaid !== undefined
            ? toMinorUnits(i.amountPaid, SCALE)
            : toMinorUnits(i.totalAmount, SCALE) - toMinorUnits(i.outstandingAmount, SCALE)),
        0,
      ),
    },
    retentionHeld: { contracts: held.length, heldMinor: held.reduce((a, b) => a + b, 0) },
    billedThisYear: (() => {
      const year = today.slice(0, 4);
      const billed = live.filter((i) => (i.invoiceDate ?? '').slice(0, 4) === year);
      return { count: billed.length, totalMinor: sumMinorUnits(billed.map((i) => i.totalAmount), SCALE) };
    })(),
  };
}

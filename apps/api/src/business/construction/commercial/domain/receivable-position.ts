import { Decimal } from '@prisma/client/runtime/library';

import { daysPastDue } from './commercial-workspace.policy.js';

const ZERO = new Decimal(0);

/** A POSTED client invoice, as far as the project's receivable position needs it. */
export interface PostedInvoiceFigures {
  /** Before sales tax — the invoice's own subtotal, at whatever tax code it was raised. */
  subtotal: Decimal;
  totalAmount: Decimal;
  outstandingAmount: Decimal;
  dueDate: Date | null;
}

export interface ReceivablePosition {
  grossIssued: Decimal;
  netBilled: Decimal;
  /**
   * `netBilled` without sales tax: Σ invoice subtotals − Σ credit-note net amounts. The figure
   * comparable with the contract value and with posted revenue; tax comes from each document,
   * never from an assumed rate.
   */
  netBilledExclTax: Decimal;
  collected: Decimal;
  outstanding: Decimal;
  overdue: Decimal;
  overdueCount: number;
  /** Whole UTC days the most-late overdue invoice is past due; null when nothing is overdue. */
  oldestDaysPastDue: number | null;
}

/**
 * The one formula for a project's receivable position — shared by the Commercial Overview
 * (`GET /projects/:id/commercial/overview`) and the Finance portfolio (`GET /finance/projects`,
 * ADR-043), so the two can never disagree.
 *
 * - netBilled = Σ posted invoice totals − Σ posted credit notes
 * - netBilledExclTax = Σ posted invoice subtotals − Σ posted credit-note net amounts
 * - collected = Σ posted receipt allocations
 * - outstanding = Σ invoice.outstandingAmount (the AR subledger value, already reduced by credit
 *   notes and allocations), so netBilled − collected = outstanding
 * - overdue = Σ outstanding of invoices whose due date is past (D5: whole UTC days > 0, server clock)
 */
export function computeReceivablePosition(input: {
  invoices: PostedInvoiceFigures[];
  postedCreditNotesSum: Decimal;
  /** The same credit notes before sales tax (their `netAmount`). */
  postedCreditNotesNetSum: Decimal;
  collectedSum: Decimal;
  today: Date;
}): ReceivablePosition {
  const { invoices, postedCreditNotesSum, postedCreditNotesNetSum, collectedSum, today } = input;
  let grossIssued = ZERO;
  let issuedExclTax = ZERO;
  let outstanding = ZERO;
  let overdue = ZERO;
  let overdueCount = 0;
  let oldestDaysPastDue: number | null = null;

  for (const inv of invoices) {
    grossIssued = grossIssued.plus(inv.totalAmount);
    issuedExclTax = issuedExclTax.plus(inv.subtotal);
    outstanding = outstanding.plus(inv.outstandingAmount);
    if (!inv.dueDate || !inv.outstandingAmount.gt(ZERO)) continue;
    const late = daysPastDue(inv.dueDate, today);
    if (late <= 0) continue;
    overdue = overdue.plus(inv.outstandingAmount);
    overdueCount += 1;
    oldestDaysPastDue = Math.max(oldestDaysPastDue ?? 0, late);
  }

  return {
    grossIssued,
    netBilled: grossIssued.minus(postedCreditNotesSum),
    netBilledExclTax: issuedExclTax.minus(postedCreditNotesNetSum),
    collected: collectedSum,
    outstanding,
    overdue,
    overdueCount,
    oldestDaysPastDue,
  };
}

/**
 * The invoice that bills a payment-schedule stage. A cancelled draft is not the stage's invoice
 * (deleting a draft also releases its source tag) — the payment schedule and the Finance
 * portfolio's "ready to bill" both use this rule.
 */
export function isLiveStageInvoice(inv: { documentStatus: string }): boolean {
  return inv.documentStatus !== 'CANCELLED';
}

/**
 * A schedule stage's amount: its share of the base contract value. T-6 — the schedule is frozen
 * against the base value; a legacy contract whose base was never set falls back to the contract
 * value (M-4: never fail a legacy contract).
 */
export function scheduleBaseValue(contract: {
  baseContractValue: { toString(): string } | null;
  contractValue: { toString(): string };
}): Decimal {
  return new Decimal((contract.baseContractValue ?? contract.contractValue).toString());
}

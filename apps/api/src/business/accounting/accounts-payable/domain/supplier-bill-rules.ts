import { Decimal } from '@prisma/client/runtime/library';

/**
 * SB-1 — what a supplier bill must satisfy before it is saved, checked the same way on create and
 * on edit. Each rule names a mistake a clerk can make on the form; the server refuses it with a
 * plain reason instead of saving a bill that fails later at posting, or posts a wrong figure.
 */

/**
 * A line's amount may differ from quantity × unit price on purpose: the clerk types the figure the
 * supplier charged and the bill shows the difference (Eng Ahmed, 2026-09-27). So it is not checked.
 */
export interface BillRuleLine {
  netAmount: number;
}

export interface BillRuleInput {
  currencyCode: string;
  billDate: string;
  dueDate: string;
  lines: readonly BillRuleLine[];
}

export interface BillRuleProblem {
  errorCode: string;
  message: string;
}

/** ADR-024 — the platform keeps its books in US dollars only. */
export const BILL_CURRENCY = 'USD';

const day = (iso: string) => iso.slice(0, 10);

/** The first problem with the bill, or null when it can be saved. */
export function billProblem(bill: BillRuleInput): BillRuleProblem | null {
  if (bill.currencyCode !== BILL_CURRENCY) {
    return { errorCode: 'CURRENCY_NOT_SUPPORTED', message: 'Bills are recorded in US dollars (USD) only.' };
  }
  if (day(bill.dueDate) < day(bill.billDate)) {
    return { errorCode: 'DUE_BEFORE_BILL_DATE', message: 'The due date cannot be before the bill date.' };
  }
  const total = bill.lines.reduce((sum, l) => sum.plus(l.netAmount), new Decimal(0));
  if (total.lte(0)) {
    return { errorCode: 'BILL_TOTAL_NOT_POSITIVE', message: 'The bill total must be more than 0.' };
  }
  return null;
}

/** A reversal is dated on or after the bill it reverses. */
export function reversalDateProblem(billDate: Date, reversalDate: string): BillRuleProblem | null {
  if (day(reversalDate) < billDate.toISOString().slice(0, 10)) {
    return {
      errorCode: 'REVERSAL_BEFORE_BILL',
      message: `The reversal date cannot be before the bill date (${billDate.toISOString().slice(0, 10)}).`,
    };
  }
  return null;
}

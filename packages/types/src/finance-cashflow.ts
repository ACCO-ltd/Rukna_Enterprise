/**
 * ADR-043 Phase 4 — the cash-flow forecast (`GET /finance/cashflow`). Read-only.
 *
 * Every figure is an existing definition placed on a date — never a second formula:
 *
 * - inflows from invoices: the outstanding balance of POSTED client invoices (the Finance
 *   portfolio's `outstanding`), on each invoice's due date;
 * - inflows from unbilled stages: payment-schedule stages of an ACTIVE client contract whose
 *   invoice is not yet issued (the schedule's `deriveInvoiceState`), at base contract value × stage
 *   percentage (the portfolio's ready-to-bill amount), expected to be paid on the expected bill date
 *   + the contract's payment terms (the rule an issued invoice is dated with);
 * - outflows from supplier bills: the outstanding balance of POSTED supplier bills coded to the
 *   project (the portfolio's `billsToPay`), on each bill's due date;
 * - outflows from open commitments: commitment-ledger COMMITTED + ACCRUED per purchase order (the
 *   cost position's committed-to-date less actual = ordered or received but not yet billed), on the
 *   order's expected delivery date + the supplier's payment terms.
 *
 * Money is per currency and never added across currencies; a decimal string, or null when the
 * caller may not see money.
 */

export type CashflowBucketSize = 'WEEK' | 'MONTH';

export const CASHFLOW_BUCKET_SIZES: readonly CashflowBucketSize[] = ['WEEK', 'MONTH'];

/**
 * - `NOW`: dated before the first period of the range — already overdue, or due before the
 *   forecast starts ("Overdue / now").
 * - `PERIOD`: one week (Monday–Sunday, UTC) or one calendar month.
 * - `LATER`: dated after the last period of the range.
 * - `UNDATED`: no date can be derived from the records — never guessed.
 */
export type CashflowBucketKind = 'NOW' | 'PERIOD' | 'LATER' | 'UNDATED';

export type CashflowLineType = 'fromInvoices' | 'fromUnbilledStages' | 'fromSupplierBills' | 'fromOpenCommitments';

export const CASHFLOW_LINE_TYPES: readonly CashflowLineType[] = [
  'fromInvoices',
  'fromUnbilledStages',
  'fromSupplierBills',
  'fromOpenCommitments',
];

export interface CashflowInflows {
  fromInvoices: string | null;
  fromUnbilledStages: string | null;
  total: string | null;
}

export interface CashflowOutflows {
  fromSupplierBills: string | null;
  fromOpenCommitments: string | null;
  total: string | null;
}

export interface CashflowBucket {
  /** `NOW`, `LATER`, `UNDATED`, or the period's first day (`2026-10-05`). */
  key: string;
  kind: CashflowBucketKind;
  /** First day (ISO date) of a period; for `LATER`, the day after the range. Null otherwise. */
  start: string | null;
  /** Last day (ISO date, inclusive) of a period; for `NOW`, the day before the first period. */
  end: string | null;
  inflows: CashflowInflows;
  outflows: CashflowOutflows;
  /** inflows − outflows. */
  net: string | null;
  /** Running sum of `net` from the first bucket; null on `UNDATED` (it has no place in time). */
  cumulativeNet: string | null;
}

export interface CashflowCurrencyForecast {
  currency: string;
  buckets: CashflowBucket[];
  totals: { inflows: CashflowInflows; outflows: CashflowOutflows; net: string | null };
  /** How many records feed each line (counts are never hidden). */
  counts: Record<CashflowLineType, number>;
}

export interface CashflowForecastResponse {
  /** One entry per currency with any figure, ordered by currency code. */
  currencies: CashflowCurrencyForecast[];
  bucket: CashflowBucketSize;
  /** The range's first and last day (ISO dates) — the first and last period. */
  from: string;
  to: string;
  projectId: string | null;
  /** A plain-words note per line type: what is counted and how it is dated. */
  basis: Record<CashflowLineType, string>;
  /** What the forecast does not include (opening bank balance, unassigned documents, …). */
  exclusions: string[];
  moneyVisible: boolean;
  /** Server clock, ISO — the "today" overdue and `NOW` are measured against. */
  asOf: string;
}

export interface CashflowForecastQuery {
  projectId?: string;
  /** ISO date; defaults to today. A date before today is read as today. */
  from?: string;
  /** ISO date; defaults to 12 weeks (WEEK) or 6 months (MONTH) after `from`. */
  to?: string;
  bucket?: CashflowBucketSize;
}

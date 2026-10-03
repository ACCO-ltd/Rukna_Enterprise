/**
 * ADR-043 — Finance workspace: the project portfolio read model (`GET /finance/projects`).
 *
 * One row per project the caller may see, carrying the figures the per-project screens already
 * define — never a second formula:
 *
 * - `billed` / `collected` / `outstanding` / `overdue` are `financialPosition.netBilled` /
 *   `collected` / `outstanding` / `overdue` of `GET /projects/:id/commercial/overview`.
 * - `costToDate` / `committedCost` are `costPosition.actual` / `costPosition.committedToDate` of
 *   `GET /projects/:id/finance/overview`; `margin` is its `accountingPosition.marginPercent`.
 * - `readyToBill` counts payment-schedule stages marked ready to bill whose invoice is not yet
 *   POSTED (Finance issues invoices — ADR-043 decision 1). `draftCount` of them already have a
 *   prepared draft/approved invoice awaiting issue; the rest are not prepared yet.
 * - `billsToPay` counts POSTED supplier bills coded to the project with an outstanding balance.
 *
 * Money is a decimal string, or null when the caller may not see it. ACCO bills by milestone:
 * there is no retention and no certification figure here.
 */

/** The three morning queues (ADR-043 decision 5). */
export type FinancePortfolioQueue = 'TO_BILL' | 'OVERDUE' | 'TO_PAY';

export const FINANCE_PORTFOLIO_QUEUES: readonly FinancePortfolioQueue[] = [
  'TO_BILL',
  'OVERDUE',
  'TO_PAY',
];

export interface FinancePortfolioCountAmount {
  count: number;
  /** Decimal string; null when money is hidden from the caller. */
  amount: string | null;
}

export interface FinancePortfolioRow {
  projectId: string;
  code: string;
  name: string;
  clientName: string | null;
  /** The project's lifecycle status (`ProjectStatus`). */
  status: string;
  currency: string | null;
  /** The live client contract's current value (incl. adopted variations); null without one. */
  contractValue: string | null;
  billed: string | null;
  collected: string | null;
  outstanding: string | null;
  overdue: string | null;
  costToDate: string | null;
  committedCost: string | null;
  /**
   * Gross margin percent of posted revenue (one decimal), as the project Finance Overview shows.
   * Null without the margin permission, while the ledger cannot post, or with no revenue yet.
   */
  margin: number | null;
  readyToBill: FinancePortfolioReadyToBill;
  overdueInvoices: { count: number; oldestDaysPastDue: number | null };
  billsToPay: FinancePortfolioCountAmount;
}

export interface FinancePortfolioReadyToBill extends FinancePortfolioCountAmount {
  /** Of `count`, stages whose invoice is prepared (draft/approved) but not yet issued (posted). */
  draftCount: number;
}

/**
 * Sums of the returned rows in ONE currency — money is never added across currencies. Rows with
 * no currency are grouped under `currency: null`.
 */
export interface FinancePortfolioTotals {
  currency: string | null;
  /** Projects in this currency. */
  projectCount: number;
  contractValue: string | null;
  billed: string | null;
  collected: string | null;
  outstanding: string | null;
  overdue: string | null;
  costToDate: string | null;
  committedCost: string | null;
  readyToBill: FinancePortfolioReadyToBill;
  overdueInvoices: { count: number };
  billsToPay: FinancePortfolioCountAmount;
}

export interface FinancePortfolioQueueCounts {
  ALL: number;
  TO_BILL: number;
  OVERDUE: number;
  TO_PAY: number;
}

export interface FinancePortfolioResponse {
  items: FinancePortfolioRow[];
  /** One entry per currency among the returned rows, ordered by currency code. */
  totals: FinancePortfolioTotals[];
  /** Project counts per queue over the search/status-filtered set — chip badges. */
  queueCounts: FinancePortfolioQueueCounts;
  /** False when receivable/cost money is withheld from the caller (every money field is null). */
  moneyVisible: boolean;
  /** False when margin is withheld from the caller (every `margin` is null). */
  marginVisible: boolean;
  /** Server clock, ISO — the one "today" the overdue rule used. */
  asOf: string;
}

export interface FinancePortfolioQuery {
  queue?: FinancePortfolioQueue;
  search?: string;
  status?: string;
}

/** `GET /finance/projects/:projectId` — one project's portfolio row (the Finance workspace header). */
export interface FinancePortfolioProjectResponse {
  item: FinancePortfolioRow;
  moneyVisible: boolean;
  marginVisible: boolean;
  asOf: string;
}

/**
 * ─── Drill-down links between the accounting reports ──────────────────────────────
 *
 * The statements (Trial Balance, Balance Sheet, Profit & Loss) dead-ended: a reader who saw a
 * figure they doubted had no way from it to the postings behind it. These helpers build the
 * links that connect them — a report row to the Account Ledger, prefilled to the account and
 * the report's own period, and (in the ledger itself) a line to the journal that posted it.
 *
 * The ledger requires both a `from` and a `to` date. A statement figure is cumulative to its
 * as-of date, and a P&L figure is bounded by its range, so the mapping is:
 *   • Trial Balance / Balance Sheet → `to = asOfDate`, `from` = inception (see LEDGER_INCEPTION)
 *   • Profit & Loss                 → `from`/`to` = the report's own range
 * so the ledger the drill-down opens sums to the figure the reader clicked.
 */

/**
 * A `from` date old enough that the ledger includes every posting up to the chosen `to`.
 *
 * A trial-balance closing balance is the sum of everything ever posted to the account on or
 * before the as-of date; there is no natural start. This constant stands in for "inception" so
 * the ledger's opening balance is zero and its running balance closes on the same figure the
 * trial balance shows. It is a display bound, not a business date.
 */
export const LEDGER_INCEPTION = '2000-01-01';

const LEDGER_PATH = '/finance/accounting/ledger';

/**
 * The Account Ledger URL for `accountId`, scoped to a date range.
 *
 * `to` defaults to today and `from` to `LEDGER_INCEPTION`, which is the cumulative view a
 * balance-sheet or trial-balance row wants. A P&L row passes both dates explicitly.
 */
export function ledgerHref(
  accountId: string,
  range: { from?: string; to?: string } = {},
): string {
  const params = new URLSearchParams({
    accountId,
    from: range.from ?? LEDGER_INCEPTION,
    to: range.to ?? new Date().toISOString().slice(0, 10),
  });
  return `${LEDGER_PATH}?${params.toString()}`;
}

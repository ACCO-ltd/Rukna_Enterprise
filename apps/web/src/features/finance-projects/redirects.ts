/**
 * ADR-043 Phase 3 — where each retired project route now lives. One table, used by the redirect
 * pages and their tests, so a route and its target cannot drift apart.
 *
 * | Old route                                       | New route                                     |
 * | ----------------------------------------------- | --------------------------------------------- |
 * | /projects/:id/finance                           | /finance/projects/:id                         |
 * | /projects/:id/finance/cost-control              | /finance/projects/:id/cost                    |
 * | /projects/:id/finance/profit-loss, /pl          | /finance/projects/:id/transactions?view=pl    |
 * | /projects/:id/finance/ledger                    | /finance/projects/:id/transactions?view=ledger |
 * | /finance/projects/:id/pl (retired tab)          | /finance/projects/:id/transactions?view=pl    |
 * | /finance/projects/:id/payables (retired tab)    | /finance/projects/:id/transactions?view=bills |
 * | /finance/projects/:id/payments (retired tab)    | /finance/projects/:id/transactions?view=receipts |
 * | /projects/:id/finance/ledger/bills/:billId      | /finance/accounting/bills/:billId             |
 * | /projects/:id/commercial/billing(-collection)   | /finance/projects/:id/billing                 |
 * | /projects/:id/commercial/invoices/:invoiceId    | /finance/projects/:id/billing/invoices/:invoiceId (finance) or the Commercial contract view |
 * | /projects/:id/ipc                               | /projects/:id/commercial                      |
 * | /projects/:id/contracts                         | /projects/:id/commercial/contract             |
 */
/** The Transactions views (ADR-043 amendment, 2026-10-10), in reading order. */
export const TRANSACTION_VIEWS = ['bills', 'supplierPayments', 'receipts', 'journals', 'ledger', 'pl'] as const;
export type TransactionView = (typeof TRANSACTION_VIEWS)[number];

export const financeProjectRedirects = {
  overview: (projectId: string) => `/finance/projects/${projectId}`,
  costControl: (projectId: string) => `/finance/projects/${projectId}/cost`,
  /** The cash-flow forecast drill-in (ADR-043 amendment, 2026-10-10). */
  cashflow: (projectId: string) => `/finance/projects/${projectId}/cashflow`,
  profitLoss: (projectId: string) => `/finance/projects/${projectId}/transactions?view=pl`,
  ledger: (projectId: string) => `/finance/projects/${projectId}/transactions?view=ledger`,
  /** ADR-043 amendment (2026-10-10): the Transactions tab, optionally on one view. */
  transactions: (projectId: string, view?: TransactionView) =>
    `/finance/projects/${projectId}/transactions${view ? `?view=${view}` : ''}`,
  bill: (billId: string) => `/finance/accounting/bills/${billId}`,
  billing: (projectId: string) => `/finance/projects/${projectId}/billing`,
  invoice: (projectId: string, invoiceId: string) => `/finance/projects/${projectId}/billing/invoices/${invoiceId}`,
  commercialSchedule: (projectId: string) => `/projects/${projectId}/commercial/contract`,
  ipc: (projectId: string) => `/projects/${projectId}/commercial`,
  contracts: (projectId: string) => `/projects/${projectId}/commercial/contract`,
} as const;

/** A Next.js page's `searchParams` once awaited. */
export type RouteSearchParams = Record<string, string | string[] | undefined>;

/**
 * Carry the old URL's query string onto a redirect target, so a bookmark's filters (`?filter=`,
 * `?from=`) are not silently dropped. The query goes before any `#fragment` in the target.
 */
export function withQuery(target: string, searchParams: RouteSearchParams | undefined): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  const qs = query.toString();
  if (!qs) return target;
  const hashAt = target.indexOf('#');
  const [path, hash] = hashAt === -1 ? [target, ''] : [target.slice(0, hashAt), target.slice(hashAt)];
  return `${path}${path.includes('?') ? '&' : '?'}${qs}${hash}`;
}

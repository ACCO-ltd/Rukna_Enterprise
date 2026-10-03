import { Decimal } from '@prisma/client/runtime/library';
import type {
  FinancePortfolioQueue,
  FinancePortfolioQueueCounts,
  FinancePortfolioRow,
  FinancePortfolioTotals,
} from '@erp/types';

/**
 * Pure assembly rules for the Finance portfolio (ADR-043). Every figure arrives already computed
 * by the shared per-project formulas (`computeReceivablePosition`, `buildPosition`,
 * `buildAccountingPosition`); this file only decides which queue a row belongs to and how the
 * visible rows add up.
 */

const ZERO = new Decimal(0);

/** Does the row belong in the morning queue? (ADR-043 decision 5.) */
export function inQueue(row: FinancePortfolioRow, queue: FinancePortfolioQueue): boolean {
  switch (queue) {
    case 'TO_BILL':
      return row.readyToBill.count > 0;
    case 'OVERDUE':
      return row.overdueInvoices.count > 0;
    case 'TO_PAY':
      return row.billsToPay.count > 0;
  }
}

export function queueCounts(rows: FinancePortfolioRow[]): FinancePortfolioQueueCounts {
  return {
    ALL: rows.length,
    TO_BILL: rows.filter((r) => inQueue(r, 'TO_BILL')).length,
    OVERDUE: rows.filter((r) => inQueue(r, 'OVERDUE')).length,
    TO_PAY: rows.filter((r) => inQueue(r, 'TO_PAY')).length,
  };
}

/**
 * Sums of the visible rows, one entry per currency — money is never added across currencies.
 * A money total is null when money is hidden. Bills to pay are summed over DISTINCT bills (via
 * `billsFor`): a bill coded to two projects (per line) appears on both rows but is owed once.
 */
export function portfolioTotals(
  rows: FinancePortfolioRow[],
  billsFor: (projectIds: string[]) => { distinctCount: number; distinctAmount: Decimal },
  moneyVisible: boolean,
): FinancePortfolioTotals[] {
  const groups = new Map<string | null, FinancePortfolioRow[]>();
  for (const row of rows) {
    const list = groups.get(row.currency) ?? [];
    list.push(row);
    groups.set(row.currency, list);
  }
  // Currencies in code order; projects with no currency last.
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b),
  );

  return ordered.map(([currency, group]) => {
    const sum = (pick: (r: FinancePortfolioRow) => string | null): string | null => {
      if (!moneyVisible) return null;
      return group.reduce((s, r) => s.plus(pick(r) ?? 0), ZERO).toFixed(2);
    };
    const bills = billsFor(group.map((r) => r.projectId));
    return {
      currency,
      projectCount: group.length,
      contractValue: sum((r) => r.contractValue),
      billed: sum((r) => r.billed),
      collected: sum((r) => r.collected),
      outstanding: sum((r) => r.outstanding),
      overdue: sum((r) => r.overdue),
      costToDate: sum((r) => r.costToDate),
      committedCost: sum((r) => r.committedCost),
      readyToBill: {
        count: group.reduce((s, r) => s + r.readyToBill.count, 0),
        draftCount: group.reduce((s, r) => s + r.readyToBill.draftCount, 0),
        amount: sum((r) => r.readyToBill.amount),
      },
      overdueInvoices: { count: group.reduce((s, r) => s + r.overdueInvoices.count, 0) },
      billsToPay: {
        count: bills.distinctCount,
        amount: moneyVisible ? bills.distinctAmount.toFixed(2) : null,
      },
    };
  });
}

/** Free-text match on code, name and client — case-insensitive, trimmed; empty matches all. */
export function matchesSearch(
  row: Pick<FinancePortfolioRow, 'code' | 'name' | 'clientName'>,
  search: string | undefined,
): boolean {
  const needle = search?.trim().toLowerCase();
  if (!needle) return true;
  return [row.code, row.name, row.clientName ?? ''].some((v) => v.toLowerCase().includes(needle));
}

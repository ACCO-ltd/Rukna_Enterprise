import type { BankTransferView } from '@erp/types';

import { fromMinorUnits, toMinorUnits } from '@/lib/money';

/** TR — the transfer list's views and its two figures. */
export const TRANSFER_VIEWS = ['all', 'waiting', 'posted', 'undone'] as const;
export type TransferView = (typeof TRANSFER_VIEWS)[number];

export function transfersInView(rows: readonly BankTransferView[], view: TransferView): BankTransferView[] {
  switch (view) {
    case 'waiting':
      return rows.filter((r) => r.status === 'PENDING_APPROVAL');
    case 'posted':
      return rows.filter((r) => r.status === 'POSTED');
    case 'undone':
      return rows.filter((r) => r.status === 'REJECTED' || r.status === 'REVERSED');
    default:
      return [...rows];
  }
}

/** Money moved this month (posted, dated in the month) and money waiting for approval. */
export function transferTotals(rows: readonly BankTransferView[], month: string) {
  let posted = 0;
  let postedCount = 0;
  let waiting = 0;
  let waitingCount = 0;
  for (const r of rows) {
    if (r.status === 'POSTED' && r.transferDate.slice(0, 7) === month) {
      posted += toMinorUnits(r.amount, 2);
      postedCount += 1;
    }
    if (r.status === 'PENDING_APPROVAL') {
      waiting += toMinorUnits(r.amount, 2);
      waitingCount += 1;
    }
  }
  return { postedThisMonth: fromMinorUnits(posted, 2), postedThisMonthCount: postedCount, waiting: fromMinorUnits(waiting, 2), waitingCount };
}

/**
 * What the sending account would hold in the books after the transfer, when that is below zero —
 * a warning, not a refusal: the books may be behind (an opening balance not yet posted), and a
 * bank may allow an overdraft. Null when nothing is wrong.
 */
export function overdrawnBy(bookBalance: string | undefined, amountMinor: number | null): string | null {
  if (amountMinor === null || amountMinor <= 0 || bookBalance === undefined) return null;
  const after = toMinorUnits(bookBalance, 2) - amountMinor;
  return after < 0 ? fromMinorUnits(after, 2) : null;
}

import { toMinorUnits } from '@/lib/money';

import { isInvoiceOverdue } from './invoice-overdue';
import type { ClientInvoice } from './types';

/**
 * The one state a list row shows (ADR-047 list design): what the reader acts on next. Derived —
 * never stored — from both status axes plus the balance, so it cannot drift from them. The detail
 * page still shows the two axes separately; this is a summary, not a third status.
 *
 * Order matters: a cancelled or reversed invoice is finished whatever it owed; a live one is
 * overdue before it is part-paid, because being late is what someone has to chase.
 */
export type InvoiceListState =
  | 'DRAFT'
  | 'TO_POST'
  | 'POSTING'
  | 'POSTING_FAILED'
  | 'OVERDUE'
  | 'PART_PAID'
  | 'OPEN'
  | 'PAID'
  | 'CANCELLED'
  | 'REVERSED';

export function invoiceListState(inv: ClientInvoice, today: string): InvoiceListState {
  if (inv.documentStatus === 'CANCELLED') return 'CANCELLED';
  if (inv.postingStatus === 'REVERSED') return 'REVERSED';
  if (inv.documentStatus === 'DRAFT') return 'DRAFT';
  if (inv.postingStatus === 'FAILED') return 'POSTING_FAILED';
  if (inv.postingStatus === 'PENDING') return 'POSTING';
  if (inv.postingStatus !== 'POSTED') return 'TO_POST';
  const outstanding = toMinorUnits(inv.outstandingAmount, 2);
  if (outstanding <= 0) return 'PAID';
  if (isInvoiceOverdue(inv, today)) return 'OVERDUE';
  return outstanding < toMinorUnits(inv.totalAmount, 2) ? 'PART_PAID' : 'OPEN';
}

export const INVOICE_LIST_STATE_TONE: Record<
  InvoiceListState,
  'neutral' | 'progress' | 'attention' | 'success' | 'danger' | 'historical'
> = {
  DRAFT: 'neutral',
  TO_POST: 'progress',
  POSTING: 'progress',
  POSTING_FAILED: 'danger',
  OVERDUE: 'danger',
  PART_PAID: 'attention',
  OPEN: 'progress',
  PAID: 'success',
  CANCELLED: 'historical',
  REVERSED: 'historical',
};

/** Whole days past the due date, or 0 when not overdue. */
export function daysLate(inv: ClientInvoice, today: string): number {
  if (!isInvoiceOverdue(inv, today)) return 0;
  return Math.round((Date.parse(today) - Date.parse(inv.dueDate.slice(0, 10))) / 86_400_000);
}

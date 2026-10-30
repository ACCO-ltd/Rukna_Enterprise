import { toMinorUnits } from '@/lib/money';

import type { SupplierBill } from './types';

/**
 * The one state a bill row shows (ADR-047 list design): what finance does next. Derived from the
 * document axis, the posting axis and the balance — never stored. The bill page keeps both axes.
 */
export type BillListState =
  | 'DRAFT'
  | 'AWAITING_APPROVAL'
  | 'RETURNED'
  | 'REJECTED'
  | 'TO_POST'
  | 'POSTING'
  | 'POSTING_FAILED'
  | 'OVERDUE'
  | 'PART_PAID'
  | 'OPEN'
  | 'PAID'
  | 'CANCELLED'
  | 'REVERSED';

type BillFields = Pick<SupplierBill, 'documentStatus' | 'postingStatus' | 'dueDate' | 'totalAmount' | 'outstandingAmount'> &
  Partial<Pick<SupplierBill, 'returnedAt'>>;

/** In the ledger (posted, or carried in as an opening balance), past due, money still owed. */
export function isBillOverdue(bill: BillFields, today: string): boolean {
  if (bill.postingStatus !== 'POSTED' && bill.postingStatus !== 'OPENING_BALANCE') return false;
  if (!bill.dueDate || bill.dueDate.slice(0, 10) >= today) return false;
  return toMinorUnits(bill.outstandingAmount, 2) > 0;
}

export function billListState(bill: BillFields, today: string): BillListState {
  if (bill.documentStatus === 'CANCELLED') return 'CANCELLED';
  if (bill.postingStatus === 'REVERSED') return 'REVERSED';
  if (bill.documentStatus === 'DRAFT') return bill.returnedAt ? 'RETURNED' : 'DRAFT';
  if (bill.documentStatus === 'SUBMITTED') return 'AWAITING_APPROVAL';
  if (bill.documentStatus === 'REJECTED') return 'REJECTED';
  if (bill.postingStatus === 'FAILED') return 'POSTING_FAILED';
  if (bill.postingStatus === 'PENDING') return 'POSTING';
  if (bill.postingStatus !== 'POSTED' && bill.postingStatus !== 'OPENING_BALANCE') return 'TO_POST';
  const outstanding = toMinorUnits(bill.outstandingAmount, 2);
  if (outstanding <= 0) return 'PAID';
  if (isBillOverdue(bill, today)) return 'OVERDUE';
  return outstanding < toMinorUnits(bill.totalAmount, 2) ? 'PART_PAID' : 'OPEN';
}

export const BILL_LIST_STATE_TONE: Record<
  BillListState,
  'neutral' | 'progress' | 'attention' | 'success' | 'danger' | 'historical'
> = {
  DRAFT: 'neutral',
  AWAITING_APPROVAL: 'progress',
  RETURNED: 'attention',
  REJECTED: 'danger',
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

export function billDaysLate(bill: BillFields, today: string): number {
  if (!isBillOverdue(bill, today)) return 0;
  return Math.round((Date.parse(today) - Date.parse(bill.dueDate.slice(0, 10))) / 86_400_000);
}

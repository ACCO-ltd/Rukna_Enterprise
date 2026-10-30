import { toMinorUnits } from '@/lib/money';

import type { Receipt } from './types';

/**
 * The one state a receipt row shows (ADR-047 list design), from the posting axis and the
 * unallocated balance. "On account" is money in the bank not yet matched to an invoice — the
 * thing to finish.
 */
export type ReceiptListState =
  'NOT_POSTED' | 'POSTING' | 'POSTING_FAILED' | 'UNALLOCATED' | 'RECEIVED' | 'REVERSED' | 'CANCELLED';

export function receiptListState(
  receipt: Pick<Receipt, 'postingStatus' | 'unallocatedAmount'> & Partial<Pick<Receipt, 'documentStatus'>>,
): ReceiptListState {
  // RC-5 — an unposted receipt set aside.
  if (receipt.documentStatus === 'CANCELLED') return 'CANCELLED';
  switch (receipt.postingStatus) {
    case 'REVERSED':
      return 'REVERSED';
    case 'FAILED':
      return 'POSTING_FAILED';
    case 'PENDING':
      return 'POSTING';
    case 'POSTED':
      return toMinorUnits(receipt.unallocatedAmount, 2) > 0 ? 'UNALLOCATED' : 'RECEIVED';
    default:
      return 'NOT_POSTED';
  }
}

export const RECEIPT_LIST_STATE_TONE: Record<
  ReceiptListState,
  'neutral' | 'progress' | 'attention' | 'success' | 'danger' | 'historical'
> = {
  NOT_POSTED: 'neutral',
  POSTING: 'progress',
  POSTING_FAILED: 'danger',
  UNALLOCATED: 'attention',
  RECEIVED: 'success',
  REVERSED: 'historical',
  CANCELLED: 'historical',
};

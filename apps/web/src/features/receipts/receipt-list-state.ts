import { toMinorUnits } from '@/lib/money';

import type { Receipt } from './types';

/**
 * The one state a receipt row shows (ADR-047 list design), from the posting axis and the
 * unallocated balance. "Received · unallocated" is money in the bank not yet matched to an
 * invoice — the thing to finish.
 */
export type ReceiptListState =
  'NOT_POSTED' | 'POSTING' | 'POSTING_FAILED' | 'UNALLOCATED' | 'RECEIVED' | 'REVERSED';

export function receiptListState(
  receipt: Pick<Receipt, 'postingStatus' | 'unallocatedAmount'>,
): ReceiptListState {
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
};

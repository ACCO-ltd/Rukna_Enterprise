import { toMinorUnits } from '@/lib/money';

import type { SupplierPayment } from './types';

/**
 * The one state a payment row shows (ADR-047 list design), derived from the document axis, the
 * posting axis and the unallocated balance — never stored. The payment page keeps both axes.
 * "Paid · unallocated" flags money sent but not yet matched to a bill — the thing to chase.
 */
export type PaymentListState =
  | 'DRAFT'
  | 'APPROVED'
  | 'RELEASED'
  | 'RETURNED'
  | 'POSTING'
  | 'POSTING_FAILED'
  | 'PAID_UNALLOCATED'
  | 'PAID'
  | 'CANCELLED'
  | 'REVERSED';

type PaymentFields = Pick<SupplierPayment, 'documentStatus' | 'postingStatus' | 'unallocatedAmount'>;

export function paymentListState(payment: PaymentFields): PaymentListState {
  if (payment.documentStatus === 'CANCELLED') return 'CANCELLED';
  if (payment.postingStatus === 'REVERSED') return 'REVERSED';
  if (payment.documentStatus === 'DRAFT') return 'DRAFT';
  if (payment.documentStatus === 'REJECTED') return 'RETURNED';
  if (payment.postingStatus === 'FAILED') return 'POSTING_FAILED';
  if (payment.postingStatus === 'PENDING') return 'POSTING';
  if (payment.postingStatus === 'POSTED') {
    return toMinorUnits(payment.unallocatedAmount, 2) > 0 ? 'PAID_UNALLOCATED' : 'PAID';
  }
  return payment.documentStatus === 'RELEASED' ? 'RELEASED' : 'APPROVED';
}

export const PAYMENT_LIST_STATE_TONE: Record<
  PaymentListState,
  'neutral' | 'progress' | 'attention' | 'success' | 'danger' | 'historical'
> = {
  DRAFT: 'neutral',
  APPROVED: 'progress',
  RELEASED: 'progress',
  RETURNED: 'attention',
  POSTING: 'progress',
  POSTING_FAILED: 'danger',
  PAID_UNALLOCATED: 'attention',
  PAID: 'success',
  CANCELLED: 'historical',
  REVERSED: 'historical',
};

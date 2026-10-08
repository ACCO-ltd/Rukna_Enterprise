/**
 * ADR-045 §6 — where paying for an award stands (`payment.state` on the request detail). Pure; the
 * first matching rule wins.
 *
 *   no live order (none, DRAFT, CANCELLED)                 → AWAITING_ORDER
 *   an advance / payment waiting for DoA approval          → AWAITING_APPROVAL
 *   an APPROVED payment on a dual-controlled account       → AWAITING_SIGNATURES
 *   PO CLOSED, or its settlement SETTLED                   → SETTLED
 *   nothing funded yet                                     → READY_TO_PAY
 *   a SUBMITTED store document and goods received          → RECEIPT_TO_RECORD
 *   cash with the buyer and no receipt sent / recorded     → CASH_WITH_BUYER
 *   goods not (fully) received                             → WAITING_FOR_GOODS
 *   otherwise                                              → SETTLING
 *
 * Spec deviation (recorded): SETTLED is checked before READY_TO_PAY / AWAITING_ORDER for a CLOSED
 * order — the spec's "no OPEN PO → AWAITING_ORDER" would otherwise swallow a settled order.
 */
export type PaymentState =
  | 'AWAITING_ORDER'
  | 'READY_TO_PAY'
  | 'AWAITING_APPROVAL'
  | 'AWAITING_SIGNATURES'
  | 'CASH_WITH_BUYER'
  | 'WAITING_FOR_GOODS'
  | 'RECEIPT_TO_RECORD'
  | 'SETTLING'
  | 'SETTLED';

export type ReceivingStatus = 'NOT_RECEIVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED';

export interface PaymentStateFacts {
  poStatus: string | null;
  settlementSettled: boolean;
  pendingApproval: boolean;
  awaitingSignatures: boolean;
  /** Σ live funding (advances net of returns, payments) — compared with zero only. */
  fundedPositive: boolean;
  /** Σ outstanding of the PO's live posted advances. */
  advanceOutstandingPositive: boolean;
  submittedStoreDocument: boolean;
  /** A SUBMITTED or RECORDED store document exists (the buyer has accounted for the purchase). */
  anyStoreDocument: boolean;
  receivingStatus: ReceivingStatus;
}

export function paymentState(f: PaymentStateFacts): PaymentState {
  if (f.poStatus !== 'OPEN' && f.poStatus !== 'CLOSED') return 'AWAITING_ORDER';
  if (f.pendingApproval) return 'AWAITING_APPROVAL';
  if (f.awaitingSignatures) return 'AWAITING_SIGNATURES';
  if (f.poStatus === 'CLOSED' || f.settlementSettled) return 'SETTLED';
  if (!f.fundedPositive) return 'READY_TO_PAY';
  if (f.submittedStoreDocument && f.receivingStatus !== 'NOT_RECEIVED') return 'RECEIPT_TO_RECORD';
  if (f.advanceOutstandingPositive && !f.anyStoreDocument) return 'CASH_WITH_BUYER';
  if (f.receivingStatus !== 'RECEIVED') return 'WAITING_FOR_GOODS';
  return 'SETTLING';
}

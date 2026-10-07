/**
 * ADR-044 — no manual bypass of a quotation round. While an MR's quotation request is live and its
 * award has not been ordered, the only way to put that MR on a purchase order is the request's own
 * "Raise the order" (which the award approves). A manual PO would set the price the round exists
 * to set, and skip both finance's choice and the award's approval.
 *
 * Pure. Blocking states: COLLECTING, AWAITING_DECISION, RETURNED, AWARD_PENDING_APPROVAL, and
 * AWARDED with no order raised (none linked, or the linked one cancelled). A CANCELLED request,
 * or an AWARDED one whose order is live, does not block (the latter's remaining quantity, if any,
 * may be ordered normally).
 */

export interface LiveQuotationFacts {
  id: string;
  status: string;
  /** Status of the PO linked to the award, or null when none is linked. */
  purchaseOrderStatus: string | null;
}

const IN_PROGRESS = new Set(['COLLECTING', 'AWAITING_DECISION', 'RETURNED', 'AWARD_PENDING_APPROVAL']);

export function quotationBlocksManualOrder(
  request: LiveQuotationFacts | null,
  raisingQuotationRequestId?: string,
): boolean {
  if (!request || request.id === raisingQuotationRequestId) return false;
  if (IN_PROGRESS.has(request.status)) return true;
  if (request.status === 'AWARDED') {
    return request.purchaseOrderStatus === null || request.purchaseOrderStatus === 'CANCELLED';
  }
  return false;
}

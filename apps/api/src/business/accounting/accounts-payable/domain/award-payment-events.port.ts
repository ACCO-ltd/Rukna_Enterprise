import type { Prisma } from '@prisma/client';

/**
 * ADR-045 §5 — what the award-payment commands announce, written INSIDE the command's transaction
 * (in-app notification + queued WhatsApp alert). Implemented by the quotations module
 * (QuotationPaymentNotifier) so Accounts Payable never imports procurement's notifier directly;
 * absent (unit wiring) = silent.
 */
export const AWARD_PAYMENT_EVENTS = Symbol('AwardPaymentEvents');

export interface AwardPaymentEvents {
  /** A buyer advance was released (posted): CASH_RELEASED to its recipient; PAYMENT_NEEDED resolved. */
  cashReleased(
    tx: Prisma.TransactionClient,
    e: { organizationId: string; quotationRequestId: string; advanceId: string; recipientUserId: string; actorUserId: string },
  ): Promise<void>;
  /** A supplier payment made from an award was posted: SUPPLIER_PAID to the collectors; PAYMENT_NEEDED resolved. */
  supplierPaid(
    tx: Prisma.TransactionClient,
    e: { organizationId: string; quotationRequestId: string; paymentId: string; actorUserId: string },
  ): Promise<void>;
  /** A store document was recorded into a bill: its RECEIPT_TO_RECORD rows are resolved. */
  receiptRecorded(tx: Prisma.TransactionClient, e: { organizationId: string; storeDocumentId: string }): Promise<void>;
}

/**
 * ADR-045 §6 — the request's `payment` read model, returned by the money commands (implemented by
 * the quotations module; absent = the commands return their document only).
 */
export const AWARD_PAYMENT_READ_MODEL = Symbol('AwardPaymentReadModel');

export interface AwardPaymentReadModel {
  paymentOf(identity: import('@erp/types').RequestIdentity, quotationRequestId: string): Promise<unknown>;
}

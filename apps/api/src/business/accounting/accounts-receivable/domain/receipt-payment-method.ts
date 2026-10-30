/**
 * RC-6 — how a client paid, recorded on the receipt (`payment_receipts.payment_method`) and shown on
 * the receipt, its PDF and the invoice's payments. The same words as supplier payments use.
 */
export const RECEIPT_PAYMENT_METHODS = ['BANK_TRANSFER', 'CHEQUE', 'CASH', 'MOBILE_MONEY', 'CARD'] as const;

export type ReceiptPaymentMethod = (typeof RECEIPT_PAYMENT_METHODS)[number];

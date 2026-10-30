import type { ReceiptPaymentMethod } from '@/lib/api-types';

/** RC-6 — how a client paid; the order the form offers them in. Mirrors the API's list. */
export const RECEIPT_PAYMENT_METHODS: readonly ReceiptPaymentMethod[] = [
  'BANK_TRANSFER',
  'CHEQUE',
  'CASH',
  'MOBILE_MONEY',
  'CARD',
];

export function isReceiptPaymentMethod(value: string | null | undefined): value is ReceiptPaymentMethod {
  return RECEIPT_PAYMENT_METHODS.includes(value as ReceiptPaymentMethod);
}

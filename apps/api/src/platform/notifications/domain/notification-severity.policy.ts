import type { NotificationKind, NotificationSeverity } from '@erp/types';

import type { InvoiceOverdueBucket } from './dedupe-key.js';

/**
 * ADR-031 — kind (+ bucket) → severity. Severity is a derived property of the condition, never stored
 * upstream and never chosen by a caller, so it lives here as a pure function.
 *
 * - A stage due within the reminder window is a WARNING (act soon).
 * - A stage past its due date is URGENT (act now).
 * - An overdue client invoice escalates by age: WARNING at 1/30 days, URGENT at 60/90.
 */
export function deriveNotificationSeverity(
  kind: NotificationKind,
  bucket?: InvoiceOverdueBucket,
): NotificationSeverity {
  switch (kind) {
    case 'STAGE_PAYMENT_DUE':
      return 'WARNING';
    case 'STAGE_PAYMENT_OVERDUE':
      return 'URGENT';
    case 'CLIENT_INVOICE_OVERDUE':
      return bucket === 60 || bucket === 90 ? 'URGENT' : 'WARNING';
    // ADR-044 §10 — finance has quotes to choose / procurement has another quote to fetch: both
    // are someone's next action. An award is news, not a demand.
    case 'QUOTES_READY':
    case 'ANOTHER_QUOTE_REQUESTED':
      return 'WARNING';
    case 'QUOTATION_AWARDED':
      return 'INFO';
    // ADR-045 §5 — money to pay / a receipt to record / a rejected receipt to redo are someone's
    // next action; cash released and a supplier paid are news the recipient acts on in the market.
    case 'PAYMENT_NEEDED':
    case 'RECEIPT_TO_RECORD':
    case 'RECEIPT_REJECTED':
      return 'WARNING';
    case 'CASH_RELEASED':
    case 'SUPPLIER_PAID':
      return 'INFO';
    default: {
      // Exhaustiveness guard: a new kind must declare its severity here.
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

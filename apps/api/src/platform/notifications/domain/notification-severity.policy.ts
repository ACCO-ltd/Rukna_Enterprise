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
    default: {
      // Exhaustiveness guard: a new kind must declare its severity here.
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

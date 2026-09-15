/**
 * ADR-031 — dedupe-key builders and the overdue-invoice bucket ladder.
 *
 * The dedupe key is the idempotency seam: the generator UPSERTs one row per (recipient, key), so the
 * same live condition on two runs touches the same row rather than creating a duplicate. Keys are
 * stable strings, never parsed back — they are opaque identity, not data.
 *
 * Invoice overdue-ness is bucketed (1/30/60/90) so that a single invoice produces at most one row per
 * severity band as it ages, and each band is its own key (re-armed as the invoice crosses a threshold).
 */

/** The overdue-days band an invoice falls into. Widening the ladder = one edit here + the severity policy. */
export type InvoiceOverdueBucket = 1 | 30 | 60 | 90;

export const dedupeKey = {
  /** A stage due within the reminder window (STAGE_PAYMENT_DUE). */
  stageDue(installmentId: string): string {
    return `stage-due:${installmentId}`;
  },
  /** A stage past its due date (STAGE_PAYMENT_OVERDUE). */
  stageOverdue(installmentId: string): string {
    return `stage-overdue:${installmentId}`;
  },
  /** A posted client invoice overdue by at least `bucket` days (CLIENT_INVOICE_OVERDUE). */
  invoiceOverdue(invoiceId: string, bucket: InvoiceOverdueBucket): string {
    return `invoice-overdue:${invoiceId}:${bucket}`;
  },
};

/**
 * Map a whole-days-overdue count onto its bucket floor. `daysOverdue` is expected to be > 0 (the
 * caller only asks once an invoice is genuinely past due); anything 1..29 lands in bucket 1.
 */
export function invoiceBucket(daysOverdue: number): InvoiceOverdueBucket {
  if (daysOverdue >= 90) return 90;
  if (daysOverdue >= 60) return 60;
  if (daysOverdue >= 30) return 30;
  return 1;
}

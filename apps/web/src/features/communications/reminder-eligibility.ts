/**
 * When "Send reminder" (ADR-042 WhatsApp V1 step 4) is offered for a client invoice. Mirrors the
 * server's refusals so the command is never shown for a reminder the API would reject: an issued
 * invoice (numbered, posted, not cancelled or reversed) with something still outstanding.
 */
export interface ReminderEligibilityFacts {
  invoiceNumber: string | null;
  postingStatus: string;
  documentStatus: string;
  /** Decimal string. */
  outstandingAmount: string | null;
}

export function canSendReminder(invoice: ReminderEligibilityFacts): boolean {
  return (
    Boolean(invoice.invoiceNumber) &&
    invoice.postingStatus === 'POSTED' &&
    invoice.documentStatus !== 'CANCELLED' &&
    hasOutstanding(invoice.outstandingAmount)
  );
}

/** More than zero, read from the decimal string (no float rounding of "0.004"-style input). */
export function hasOutstanding(amount: string | null | undefined): boolean {
  const text = amount?.trim() ?? '';
  if (!text || text.startsWith('-')) return false;
  return /[1-9]/.test(text);
}

const DAY_MS = 86_400_000;

/**
 * Whole UTC calendar days past the due date (0 when not yet due or no due date) — the server's
 * collection rule (`daysPastDue`), used only to word the dialog; the server picks the template.
 */
export function daysOverdue(dueDate: string | null | undefined, now: Date = new Date()): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return 0;
  const a = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const b = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.max(0, Math.round((a - b) / DAY_MS));
}

import type { ClientInvoice } from './types';

/**
 * Whether a client invoice is overdue: posted and live (not cancelled or reversed), past its
 * due date, with money still outstanding. The same three facts the server's
 * CLIENT_INVOICE_OVERDUE notification is raised on (ADR-031).
 *
 * `today` is a `yyyy-MM-dd` wire date, passed in so the rule is testable and never depends on
 * the time of day. Comparing the outstanding amount to zero is a sign test, not arithmetic —
 * the money policy in `lib/format.ts` still holds.
 */
export function isInvoiceOverdue(
  invoice: Pick<ClientInvoice, 'documentStatus' | 'postingStatus' | 'dueDate' | 'outstandingAmount'>,
  today: string,
): boolean {
  if (invoice.documentStatus !== 'APPROVED' || invoice.postingStatus !== 'POSTED') return false;
  if (!invoice.dueDate) return false;
  if (invoice.dueDate.slice(0, 10) >= today) return false;
  return Number(invoice.outstandingAmount) > 0;
}

/** Today as a `yyyy-MM-dd` wire date, in the viewer's local calendar. */
export function todayWireDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

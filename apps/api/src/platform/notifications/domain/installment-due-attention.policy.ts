/**
 * ADR-031 — pure due-date attention policy for a payment installment.
 *
 * Mirrors the web client's `dueStatus` (apps/web/src/features/commercial/presentation.ts) exactly so
 * the bell and the payment-schedule table never disagree by a day. The count is taken on UTC calendar
 * dates — the same basis the API stores (`@db.Date`) and `formatDate` renders — so a timezone never
 * shifts the boundary. This is deliberately a pure function of two dates: `now` is injected so the
 * mapping is deterministically unit-testable.
 */

/** Days before the due date (inclusive) within which a stage counts as DUE_SOON. */
export const INSTALLMENT_DUE_SOON_DAYS = 7;

export type InstallmentDueAttention = 'NONE' | 'DUE_SOON' | 'OVERDUE';

const MS_PER_DAY = 86_400_000;

/**
 * Whole calendar days from `now` to `dueDate`, on UTC dates. Negative when the due date is in the past.
 * Exported so callers (the invoice source, contextData) can reuse the identical arithmetic.
 */
export function utcCalendarDaysUntil(dueDate: Date, now: Date): number {
  const dueUtc = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((dueUtc - nowUtc) / MS_PER_DAY);
}

/**
 * A stage's due-date attention. `days < 0` is OVERDUE; `0 <= days <= windowDays` is DUE_SOON (due
 * today falls here, matching the web `today`/`soon` split which both render a warning chip); anything
 * further out is NONE.
 */
export function deriveInstallmentDueAttention(
  dueDate: Date,
  now: Date,
  windowDays: number = INSTALLMENT_DUE_SOON_DAYS,
): InstallmentDueAttention {
  const days = utcCalendarDaysUntil(dueDate, now);
  if (days < 0) return 'OVERDUE';
  if (days <= windowDays) return 'DUE_SOON';
  return 'NONE';
}

import type { StatusTone } from '@erp/ui';
import type { CommercialMetric, PaymentInstallmentBillStatus } from '@erp/types';

/**
 * Pure presentation policy for the Commercial workspace. Kept out of components so the
 * mapping from a backend state to a blank-with-reason is unit-testable — an ERP that renders an
 * untrusted figure as a confident number is the failure this guards against.
 *
 * Status tones do not live here: contract, variation, installment and invoice statuses take their
 * tone from the platform status registry (`@/lib/status-registry`, ADR-034).
 */

export type MetricDisplay =
  | { kind: 'value'; amount: string; currency: string | null }
  | { kind: 'blank'; reasonKey: 'restricted' | 'unavailable' | 'failed' };

/**
 * How to render a metric. A genuine zero is a value (`"0.00"`); restricted / unavailable /
 * failed are blanks that must explain themselves and must never render as `0`.
 */
export function metricDisplay(metric: CommercialMetric): MetricDisplay {
  switch (metric.state) {
    case 'OK':
    case 'ZERO':
      return { kind: 'value', amount: metric.amount ?? '0.00', currency: metric.currency };
    case 'RESTRICTED':
      return { kind: 'blank', reasonKey: 'restricted' };
    case 'UNAVAILABLE':
      return { kind: 'blank', reasonKey: 'unavailable' };
    case 'FAILED':
    default:
      return { kind: 'blank', reasonKey: 'failed' };
  }
}

/**
 * True once an installment has an invoice raised against it (invoiced or wholly/partly paid),
 * as opposed to NEXT/UPCOMING which are not yet billed. Shared by the schedule table and the
 * Overview cockpit's "N of M invoiced" count so the two never drift.
 */
export function isBilledInstallment(status: PaymentInstallmentBillStatus): boolean {
  return status === 'BILLED' || status === 'PARTIALLY_PAID' || status === 'PAID';
}

export interface DueStatus {
  tone: StatusTone;
  /** i18n key suffix under `commercial.paymentSchedule.due.*`. */
  key: 'overdue' | 'today' | 'soon' | 'upcoming';
  /** Whole calendar days until due — negative when overdue. */
  days: number;
}

/**
 * A payment installment's due-date urgency, derived client-side from its calendar `dueDate`.
 *
 * Returns null when there is no due date (most stages carry none). Otherwise the whole-day
 * difference from today drives a tone + label key: past due is danger, due today or within a week is
 * attention, anything further out is a quiet `upcoming` (callers render no chip for it — the date
 * column already states it). Days are counted on UTC calendar dates to match how the API stores and
 * `formatDate` renders them, so the count never drifts a day by timezone.
 *
 * This is a UI cue only — no reminder is sent (there is no notification service). `now` is injectable
 * so the mapping is deterministically unit-testable.
 */
export function dueStatus(
  dueDate: string | null | undefined,
  now: Date = new Date(),
): DueStatus | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;

  const MS_PER_DAY = 86_400_000;
  const dueUtc = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((dueUtc - nowUtc) / MS_PER_DAY);

  if (days < 0) return { tone: 'danger', key: 'overdue', days };
  if (days === 0) return { tone: 'attention', key: 'today', days };
  if (days <= 7) return { tone: 'attention', key: 'soon', days };
  return { tone: 'neutral', key: 'upcoming', days };
}

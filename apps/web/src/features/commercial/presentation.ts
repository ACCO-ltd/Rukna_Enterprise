import type { BadgeTone } from '@erp/ui';
import type {
  ClientInvoiceSettlementStatus,
  CommercialMetric,
  CommercialSettlementState,
  GuaranteeAttentionState,
  PaymentInstallmentBillStatus,
} from '@erp/types';

/**
 * Pure presentation policy for the Commercial workspace. Kept out of components so the
 * mapping from a backend state to a colour or a blank-with-reason is unit-testable — an ERP
 * that renders an untrusted figure as a confident number is the failure this guards against.
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

/** Contract lifecycle → badge tone. Terminal states read as historical, ACTIVE as live. */
export function contractStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'ACTIVE':
      return 'live';
    case 'DRAFT':
      return 'neutral';
    case 'UNDER_REVIEW':
    case 'PENDING_SIGNATURE':
    case 'FINAL_ACCOUNT_PENDING':
      return 'warning';
    case 'CLOSED':
    case 'CANCELLED':
    case 'TERMINATED':
      return 'historical';
    default:
      return 'neutral';
  }
}

export function settlementTone(state: CommercialSettlementState): BadgeTone {
  switch (state) {
    case 'PAID':
      return 'live';
    case 'PARTIALLY_PAID':
      return 'warning';
    case 'UNPAID':
      return 'danger';
    case 'UNINVOICED':
    default:
      return 'neutral';
  }
}

/**
 * A client invoice's state → badge tone.
 *
 * `AWAITING_POSTING` is deliberately not a warning: an approved invoice the GL has not taken yet
 * is a normal step in the day, not a problem. `UNPAID` is not danger either — whether unpaid is
 * bad depends entirely on the due date, and the row states that separately. Only a genuinely
 * cancelled document reads as inert.
 */
export function invoiceStatusTone(status: ClientInvoiceSettlementStatus): BadgeTone {
  switch (status) {
    case 'PAID':
      return 'live';
    case 'PARTIALLY_PAID':
      return 'warning';
    case 'AWAITING_POSTING':
      return 'info';
    case 'UNPAID':
      return 'accent';
    case 'CANCELLED':
      return 'historical';
    case 'DRAFT':
    default:
      return 'neutral';
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

/**
 * ADR-023 payment installment bill status → badge tone. NEXT is the actionable one (accent);
 * UPCOMING is quiet; the paid states mirror `settlementTone`.
 */
export function paymentInstallmentTone(status: PaymentInstallmentBillStatus): BadgeTone {
  switch (status) {
    case 'PAID':
      return 'live';
    case 'PARTIALLY_PAID':
      return 'warning';
    case 'BILLED':
      return 'info';
    case 'NEXT':
      return 'accent';
    case 'UPCOMING':
    default:
      return 'neutral';
  }
}

export function guaranteeAttentionTone(attention: GuaranteeAttentionState): BadgeTone {
  switch (attention) {
    case 'EXPIRED':
      return 'danger';
    case 'EXPIRING_SOON':
      return 'warning';
    case 'NONE':
    default:
      return 'live';
  }
}

export function guaranteeStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'ACTIVE':
      return 'live';
    case 'CALLED':
      return 'danger';
    case 'EXPIRED':
      return 'warning';
    case 'DISCHARGED':
    default:
      return 'historical';
  }
}

/**
 * VariationOrder lifecycle → badge tone (ADR-026 CONST-VAR-004). DRAFT is inert grey;
 * PENDING_INTERNAL is progressing; INTERNAL_APPROVED is an in-force interim step; only
 * CLIENT_APPROVED reads as "live" (the one status that moves the governing contract value);
 * REJECTED/WITHDRAWN are commercially inert terminals shown as historical, not alarming red —
 * a withdrawn variation is a closed matter, not a failure the reader must act on.
 */
export function variationStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'DRAFT':
      return 'neutral';
    case 'PENDING_INTERNAL':
      return 'info';
    case 'INTERNAL_APPROVED':
      return 'accent';
    case 'CLIENT_APPROVED':
      return 'live';
    case 'REJECTED':
    case 'WITHDRAWN':
      return 'historical';
    default:
      return 'neutral';
  }
}

export function attentionSeverityTone(severity: 'URGENT' | 'WARNING' | 'INFO'): BadgeTone {
  switch (severity) {
    case 'URGENT':
      return 'danger';
    case 'WARNING':
      return 'warning';
    case 'INFO':
    default:
      return 'info';
  }
}

export interface DueStatus {
  tone: BadgeTone;
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
 * a warning, anything further out is a quiet `upcoming` (callers render no chip for it — the date
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
  if (days === 0) return { tone: 'warning', key: 'today', days };
  if (days <= 7) return { tone: 'warning', key: 'soon', days };
  return { tone: 'neutral', key: 'upcoming', days };
}

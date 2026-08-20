import type { BadgeTone } from '@erp/ui';
import type {
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

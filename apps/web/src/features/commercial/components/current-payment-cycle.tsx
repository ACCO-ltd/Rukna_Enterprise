import type { CommercialCycleStage } from '@erp/types';

/**
 * Payment-cycle helpers.
 *
 * The `CurrentPaymentCycle` card (Overview's C2) and its stage rail were retired once "what
 * happens next to get paid" moved onto the persistent cycle ribbon and the Payment Schedule tab
 * (S-SH-2). The card is gone; what outlived it are the pure pieces still consumed elsewhere — the
 * cycle-stage → rail-position mappings (covered by `current-payment-cycle.test.ts`) and the
 * fraction → percent formatter used by the payment-terms summary and the payment-plan panel.
 */

/**
 * A MILESTONE contract's cycle position.
 *
 * The read model reports `MILESTONE_SCHEDULE` for the whole plan rather than per-installment
 * stages, so the rail sits on "ready to invoice" — the point the focus installment is at and the
 * one the card's action addresses. It moves further only for stages the schedule genuinely has.
 */
export function milestoneStageIndex(stage: CommercialCycleStage): number {
  if (stage === 'NO_CONTRACT' || stage === 'CONTRACT_DRAFT') return 0;
  if (stage === 'MILESTONE_SCHEDULE') return 2;
  if (stage === 'INVOICE_DRAFT') return 3;
  if (stage === 'AWAITING_PAYMENT' || stage === 'PARTIALLY_PAID') return 4;
  return 5;
}

export function applicationStageIndex(stage: CommercialCycleStage): number {
  if (stage === 'NO_CONTRACT' || stage === 'CONTRACT_DRAFT') return 0;
  if (
    stage === 'READY_FOR_APPLICATION' ||
    stage === 'APPLICATION_DRAFT' ||
    stage === 'APPLICATION_RETURNED'
  )
    return 1;
  if (stage === 'APPLICATION_SUBMITTED' || stage === 'AWAITING_CERTIFICATION') return 2;
  if (stage === 'CERTIFIED' || stage === 'AWAITING_INVOICE') return 3;
  if (stage === 'INVOICE_DRAFT') return 4;
  if (stage === 'AWAITING_PAYMENT' || stage === 'PARTIALLY_PAID') return 5;
  return 6;
}

/** Rates arrive as fractions — `0.2000` is 20%. */
export function formatPercent(fraction: string): string {
  const n = Number(fraction);
  if (!Number.isFinite(n)) return fraction;
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 }).format(n);
}

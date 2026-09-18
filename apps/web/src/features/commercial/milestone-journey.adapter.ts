import type {
  CommercialPaymentSchedule,
  CommercialPaymentScheduleInstallment,
  CommercialPaymentScheduleVariationLine,
} from '@erp/types';

import { isBilledInstallment } from './presentation';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * User-facing commercial state for a milestone, COMPOSED from installment status and
 * programme milestone verification. Never derived from a single persisted enum — the
 * backend statuses are inputs, not outputs.
 *
 * 'ready-to-bill' is produced by this adapter when `inst.readyToBill === true` and
 * the installment is NEXT. The component layer no longer overrides this state.
 *
 * 'invoice-issued' and 'awaiting-payment' are NEVER produced by this adapter. The
 * component layer owns them via invoiceJourneyMap so they are available immediately
 * after issuePackage / recordPackageDelivery succeed, before the next refetch.
 */
export type MilestoneUserState =
  | 'upcoming'            // UPCOMING status (not yet the current stage)
  | 'in-progress'         // NEXT + no linked milestone, or milestone PLANNED
  | 'review-for-billing'  // NEXT + linked milestone VERIFIED → CTA: "Review for billing"
  | 'ready-to-bill'       // NEXT + readyToBill === true (derived from backend field)
  | 'invoice-issued'      // invoice issued (POSTED), not yet sent to client
  | 'awaiting-payment'    // invoice sent to client (delivery recorded), awaiting collection
  | 'invoiced'            // BILLED (invoice exists, not yet collected)
  | 'partially-paid'      // PARTIALLY_PAID
  | 'paid';               // PAID (fully collected)

/**
 * Tracks the post-issue invoice journey in the component layer.
 * Never stored in the adapter — the component layer maintains a
 * Map<installmentId, InvoiceJourneyPhase> updated after real API calls
 * (issuePackage sets phase='issued'; recordPackageDelivery sets phase='sent').
 */
export interface InvoiceJourneyPhase {
  phase: 'issued' | 'sent';
  invoiceId: string;
  invoiceDate: string;
  dueDate: string | null;
  deliveryMethod?: 'whatsapp' | 'email' | 'physical' | 'other';
}

export interface MilestoneVariationItem {
  variationId: string;
  /** e.g. "VO-001" */
  reference: string;
  title: string;
  /** VO net amount. Null when financialsVisible is false. */
  amount: string | null;
  isOmission: boolean;
}

export interface MilestoneItemViewModel {
  id: string;
  sortOrder: number;
  name: string;
  /** Fraction string, e.g. "0.4000" */
  percentage: string;
  /** percentage × schedule.contractValue. Null when financialsVisible is false. */
  baseAmount: string | null;
  triggerType: 'ADVANCE' | 'MILESTONE' | 'TIME_BASED';
  userState: MilestoneUserState;
  /**
   * The date to display on the milestone card.
   * Pre-invoice: this is the installment's `dueDate` (the schedule-set target date).
   * Post-invoice: still `dueDate` (invoice due date comes from the invoice object in Slice 3B).
   */
  expectedDate: string | null;
  /**
   * Controls the label shown beside the date.
   * 'expected' — pre-invoice, never call it "Due".
   * 'due'       — post-invoice (BILLED/PARTIALLY_PAID/PAID).
   * null        — no date available.
   */
  dateLabel: 'expected' | 'due' | null;
  programmeMilestone: {
    id: string;
    code: string;
    name: string;
    status: 'PLANNED' | 'VERIFIED';
  } | null;
  /** VOs allocated to this stage, or unassigned VOs surfaced on the NEXT stage. */
  variationAllocations: MilestoneVariationItem[];
  /** True when the backend has the installment marked ready-to-bill (Slice 3B). */
  readyToBill: boolean;
  /** Invoice reference if the stage has been invoiced. */
  invoiceReference: string | null;
  /**
   * Post-issue journey phase — set by ContractMilestonesTab after real API calls
   * (issuePackage sets 'issued'; recordPackageDelivery sets 'sent').
   * The adapter always returns null; the component layer overrides it.
   */
  invoiceJourney: InvoiceJourneyPhase | null;
}

export interface MilestoneJourneyViewModel {
  currency: string;
  /** schedule.contractValue — the original/base contract value before variations. */
  originalContractValue: string | null;
  /** Σ variationLines[*].amount. Null when financialsVisible is false. */
  approvedVariationsTotal: string | null;
  /** originalContractValue + approvedVariationsTotal. Null when either is null. */
  governingContractValue: string | null;
  financialsVisible: boolean;
  milestones: MilestoneItemViewModel[];
  /** Index into `milestones` of the NEXT installment. -1 when none. */
  currentIndex: number;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

/**
 * Pure adapter: CommercialPaymentSchedule → MilestoneJourneyViewModel.
 *
 * No React. No side effects. Fully unit-testable with plain objects.
 *
 * Variation allocation rules:
 *   - BILLED/PAID/PARTIALLY_PAID stage: VOs where stageInstallmentId === stage.id
 *   - NEXT stage: same as above, PLUS unassigned VOs (stageInstallmentId === null)
 *   - UPCOMING stage: no VOs shown (avoids cluttering the forward plan)
 */
export function toMilestoneJourneyViewModel(
  schedule: CommercialPaymentSchedule,
  financialsVisible: boolean,
): MilestoneJourneyViewModel {
  const sorted = [...schedule.installments].sort((a, b) => a.sortOrder - b.sortOrder);
  const currentIndex = sorted.findIndex((i) => i.status === 'NEXT');

  const approvedVariationsTotal = computeVariationsTotal(schedule.variationLines, financialsVisible);
  const originalContractValue = financialsVisible ? (schedule.contractValue ?? null) : null;
  const governingContractValue = computeGoverning(originalContractValue, approvedVariationsTotal);

  const milestones = sorted.map((inst, idx) => {
    const isNext = idx === currentIndex;
    return toItemViewModel(inst, isNext, schedule, financialsVisible);
  });

  return {
    currency: schedule.currency,
    originalContractValue,
    approvedVariationsTotal,
    governingContractValue,
    financialsVisible,
    milestones,
    currentIndex,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function toItemViewModel(
  inst: CommercialPaymentScheduleInstallment,
  isNext: boolean,
  schedule: CommercialPaymentSchedule,
  financialsVisible: boolean,
): MilestoneItemViewModel {
  const billed = isBilledInstallment(inst.status);
  const userState = resolveUserState(inst, isNext);
  const dateLabel = resolveDateLabel(inst, billed);
  const variationAllocations = resolveVariations(inst, isNext, schedule, financialsVisible);
  const baseAmount = computeBaseAmount(inst, schedule, financialsVisible);

  return {
    id: inst.id,
    sortOrder: inst.sortOrder,
    name: inst.name,
    percentage: inst.percentage,
    baseAmount,
    triggerType: inst.triggerType as MilestoneItemViewModel['triggerType'],
    userState,
    expectedDate: inst.dueDate,
    dateLabel,
    programmeMilestone: inst.programmeMilestone
      ? {
          id: inst.programmeMilestone.id,
          code: inst.programmeMilestone.code,
          name: inst.programmeMilestone.name,
          status: inst.programmeMilestone.status as 'PLANNED' | 'VERIFIED',
        }
      : null,
    variationAllocations,
    readyToBill: inst.readyToBill ?? false,
    invoiceReference: null, // Slice 3B will populate this from billing data
    invoiceJourney: null, // never set here; ContractMilestonesTab overrides after API calls
  };
}

function resolveUserState(
  inst: CommercialPaymentScheduleInstallment,
  isNext: boolean,
): MilestoneUserState {
  switch (inst.status) {
    case 'PAID':
      return 'paid';
    case 'PARTIALLY_PAID':
      return 'partially-paid';
    case 'BILLED':
      return 'invoiced';
    case 'NEXT':
      if (inst.readyToBill) return 'ready-to-bill';
      if (inst.programmeMilestone?.status === 'VERIFIED') return 'review-for-billing';
      return 'in-progress';
    default:
      return 'upcoming';
  }
}

function resolveDateLabel(
  inst: CommercialPaymentScheduleInstallment,
  billed: boolean,
): 'expected' | 'due' | null {
  if (!inst.dueDate) return null;
  return billed ? 'due' : 'expected';
}

function resolveVariations(
  inst: CommercialPaymentScheduleInstallment,
  isNext: boolean,
  schedule: CommercialPaymentSchedule,
  financialsVisible: boolean,
): MilestoneVariationItem[] {
  if (inst.status === 'UPCOMING' && !isNext) return [];

  return schedule.variationLines
    .filter((line) => {
      if (line.stageInstallmentId === inst.id) return true;
      // Unassigned VOs surface only on the NEXT (current) stage
      if (isNext && line.stageInstallmentId === null) return true;
      return false;
    })
    .map((line) => toVariationItem(line, financialsVisible));
}

function toVariationItem(
  line: CommercialPaymentScheduleVariationLine,
  financialsVisible: boolean,
): MilestoneVariationItem {
  return {
    variationId: line.variationId,
    reference: line.reference,
    title: line.title,
    amount: financialsVisible ? (line.amount ?? null) : null,
    isOmission: line.amount !== null ? Number(line.amount) < 0 : false,
  };
}

function computeBaseAmount(
  inst: CommercialPaymentScheduleInstallment,
  schedule: CommercialPaymentSchedule,
  financialsVisible: boolean,
): string | null {
  if (!financialsVisible) return null;
  if (!schedule.contractValue) return null;
  const base = Number(inst.percentage) * Number(schedule.contractValue);
  return base.toFixed(2);
}

function computeVariationsTotal(
  lines: CommercialPaymentScheduleVariationLine[],
  financialsVisible: boolean,
): string | null {
  if (!financialsVisible) return null;
  if (lines.length === 0) return null;
  // Return null if any line has a null amount (financials partially hidden)
  const amounts = lines.map((l) => l.amount);
  if (amounts.some((a) => a === null)) return null;
  const total = amounts.reduce((sum, a) => sum + Number(a), 0);
  return total.toFixed(2);
}

function computeGoverning(
  original: string | null,
  variations: string | null,
): string | null {
  if (original === null) return null;
  if (variations === null) return null;
  return (Number(original) + Number(variations)).toFixed(2);
}

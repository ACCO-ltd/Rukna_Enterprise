/**
 * CONST-COM-011 (strict, owner decision 2026-09-28) — may this payment-schedule stage be billed?
 *
 * One rule, three callers: the invoice generator (`generateFromInstallment`, which the billing
 * package also goes through), `markReadyToBill`, and the commercial cycle that the ribbon and the
 * Overview card read. Before this existed the cycle blocked a stage with no linked milestone while
 * the two commands let it through, so the screen said "blocked" over a door the server left open.
 *
 * - A **work-completion** stage (`MILESTONE` trigger — Structure, Partition & Plastering …) is
 *   billable only when it is linked to a programme milestone that has been VERIFIED on site. A
 *   missing link is not a pass: leaving it empty must never bypass site verification.
 * - Stages whose trigger is not completed work (`ADVANCE`, `TIME_BASED`) are not gated here; they
 *   need their own trigger and evidence, defined separately.
 *
 * Lives in accounts-receivable because the invoice generator owns the final gate; construction
 * may import accounting (ARCH-BOUNDARY-001), never the reverse.
 */
export type InstallmentBillingBlocker = 'MILESTONE_NOT_LINKED' | 'MILESTONE_NOT_VERIFIED';

export interface InstallmentBillingFacts {
  triggerType: string;
  programmeMilestoneId?: string | null;
  programmeMilestone?: { status: string } | null;
}

export function installmentBillingBlocker(
  installment: InstallmentBillingFacts,
): InstallmentBillingBlocker | null {
  if (installment.triggerType !== 'MILESTONE') return null;
  const linked = Boolean(installment.programmeMilestoneId) || Boolean(installment.programmeMilestone);
  if (!linked) return 'MILESTONE_NOT_LINKED';
  if (installment.programmeMilestone?.status !== 'VERIFIED') return 'MILESTONE_NOT_VERIFIED';
  return null;
}

/** The reason in words, for a refused command. */
export function installmentBillingBlockerMessage(
  blocker: InstallmentBillingBlocker,
  stageName: string,
): string {
  return blocker === 'MILESTONE_NOT_LINKED'
    ? `"${stageName}" is a work-completion stage with no programme milestone linked. Link it to the ` +
        'milestone that evidences the work, and verify that milestone on site, before billing.'
    : `The programme milestone linked to "${stageName}" is not yet verified on site; it cannot be billed.`;
}

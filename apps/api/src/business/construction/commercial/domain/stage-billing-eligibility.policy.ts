import type {
  EligibilityStep,
  StageBillingBlockedReason,
  StageBillingEligibility,
  StageBillingEligibilityStepKey,
} from '@erp/types';

import {
  installmentBillingBlocker,
  type InstallmentBillingBlocker,
  type InstallmentBillingFacts,
} from '../../../accounting/accounts-receivable/domain/installment-billing-eligibility.js';
import {
  periodPostingBlock,
  type PeriodPostingBlock,
  type PeriodPostingFacts,
} from '../../../accounting/accounting-core/domain/period-posting.policy.js';
import { deriveInvoiceState, redateForIssue } from './commercial-workspace.policy.js';

/**
 * Milestone billing — may this payment-schedule stage be prepared / issued? (ADR-043 Phase 2.)
 *
 * `stagePrepareBlock` IS the prepare command's guard (`CommercialBillingService.preparePackage`
 * calls it and throws the coded 400 it names). The issue side is the same two rules the issue path
 * applies when it posts the drafts: `installmentBillingBlocker(at: 'post')` (in
 * `ClientInvoiceService.post`) and the ledger's period gate (`periodPostingBlock`, in
 * `PeriodValidator`) for the date the issue posts at (`redateForIssue`: never before today).
 */

/** The journal category a client invoice posts under (EVT-AR-001). */
export const CLIENT_INVOICE_JOURNAL_CATEGORY = 'ACCOUNTS_RECEIVABLE';

export type StagePrepareBlock = 'CONTRACT_NOT_ACTIVE' | InstallmentBillingBlocker | 'STAGE_ALREADY_INVOICED';

export interface StagePrepareFacts {
  contractStatus: string;
  installment: InstallmentBillingFacts;
  /** The stage's invoice, if any (a cancelled one does not count). */
  invoice: { documentStatus: string } | null;
}

/** The prepare command's guards, in its order: contract ACTIVE → CONST-COM-011 → no live invoice. */
export function stagePrepareBlock(facts: StagePrepareFacts): StagePrepareBlock | null {
  if (facts.contractStatus !== 'ACTIVE') return 'CONTRACT_NOT_ACTIVE';
  const blocker = installmentBillingBlocker({ ...facts.installment, contractStatus: facts.contractStatus });
  if (blocker) return blocker;
  if (facts.invoice && facts.invoice.documentStatus !== 'CANCELLED') return 'STAGE_ALREADY_INVOICED';
  return null;
}

/** The date an issue posts at: the draft's invoice date, moved up to today when it is earlier. */
export function issuePostingDate(invoiceDate: Date | null, today: Date): Date {
  if (!invoiceDate) return new Date(Date.parse(today.toISOString().slice(0, 10) + 'T00:00:00Z'));
  return redateForIssue(invoiceDate, null, today)?.invoiceDate ?? invoiceDate;
}

export interface StageBillingFacts {
  installmentId: string;
  contractStatus: string;
  installment: InstallmentBillingFacts & { readyToBillAt: Date | string | null };
  /** The stage's live invoice (`isLiveStageInvoice`), or null. */
  invoice: { documentStatus: string; postingStatus: string } | null;
  /** The period covering `issuePostingDate(...)` — where an issue would post. */
  issuePeriod: PeriodPostingFacts | null;
}

type Step = EligibilityStep<StageBillingEligibilityStepKey>;

function step(
  key: StageBillingEligibilityStepKey,
  owner: Step['owner'],
  status: Step['status'],
  code: string | null = null,
  detail: string | null = null,
): Step {
  return { key, owner, status, code: status === 'DONE' || status === 'NOT_APPLICABLE' ? null : code, detail };
}

export function stageBillingEligibility(facts: StageBillingFacts): StageBillingEligibility {
  const { installment, contractStatus } = facts;
  const state = deriveInvoiceState(facts.invoice);
  const prepareBlock = stagePrepareBlock({ contractStatus, installment, invoice: facts.invoice });
  const postBlocker = installmentBillingBlocker({ ...installment, contractStatus }, { at: 'post' });
  const periodBlock: PeriodPostingBlock | null =
    state === 'ISSUED' ? null : periodPostingBlock(facts.issuePeriod, CLIENT_INVOICE_JOURNAL_CATEGORY);
  const isMilestone = installment.triggerType === 'MILESTONE';
  const linked = Boolean(installment.programmeMilestoneId) || Boolean(installment.programmeMilestone);
  const issued = state === 'ISSUED';

  const steps: Step[] = [];

  // Contract executed (ACTIVE). Once issued the contract may have moved on — that is history.
  steps.push(
    issued || contractStatus === 'ACTIVE'
      ? step('CONTRACT_ACTIVE', 'CONSTRUCTION', 'DONE')
      : step('CONTRACT_ACTIVE', 'CONSTRUCTION', 'BLOCKED', 'CONTRACT_NOT_ACTIVE', contractStatus),
  );

  // CONST-COM-011: a work-completion stage needs a linked, site-verified programme milestone.
  if (!isMilestone) {
    steps.push(step('MILESTONE_LINKED', 'CONSTRUCTION', 'NOT_APPLICABLE'));
    steps.push(step('MILESTONE_VERIFIED', 'CONSTRUCTION', 'NOT_APPLICABLE'));
  } else {
    steps.push(
      linked || issued
        ? step('MILESTONE_LINKED', 'CONSTRUCTION', 'DONE')
        : step('MILESTONE_LINKED', 'CONSTRUCTION', 'BLOCKED', 'MILESTONE_NOT_LINKED'),
    );
    const verified = installment.programmeMilestone?.status === 'VERIFIED';
    steps.push(
      verified || issued
        ? step('MILESTONE_VERIFIED', 'CONSTRUCTION', 'DONE')
        : step(
            'MILESTONE_VERIFIED',
            'CONSTRUCTION',
            linked ? 'BLOCKED' : 'PENDING',
            'MILESTONE_NOT_VERIFIED',
            installment.programmeMilestone?.status ?? null,
          ),
    );
  }

  // Ready to bill — Construction's signal. Not a gate on prepare: preparing records it (D2).
  steps.push(
    facts.installment.readyToBillAt || state
      ? step('READY_TO_BILL', 'CONSTRUCTION', 'DONE')
      : step('READY_TO_BILL', 'CONSTRUCTION', 'PENDING', 'NOT_READY'),
  );

  // Prepared (draft) → period open for the issue date → issued (posted).
  steps.push(
    state ? step('INVOICE_PREPARED', 'FINANCE', 'DONE') : step('INVOICE_PREPARED', 'FINANCE', 'PENDING', 'NOT_PREPARED'),
  );
  steps.push(
    issued
      ? step('PERIOD_OPEN', 'FINANCE', 'DONE')
      : periodBlock
        ? step('PERIOD_OPEN', 'FINANCE', 'BLOCKED', periodBlock, facts.issuePeriod?.name ?? null)
        : step('PERIOD_OPEN', 'FINANCE', 'DONE', null, facts.issuePeriod?.name ?? null),
  );
  steps.push(
    issued ? step('INVOICE_ISSUED', 'FINANCE', 'DONE') : step('INVOICE_ISSUED', 'FINANCE', 'PENDING', 'NOT_ISSUED'),
  );

  const canPrepare = prepareBlock === null;
  const canIssue = state === 'DRAFT' && postBlocker === null && periodBlock === null;

  let blockedReason: StageBillingBlockedReason | null = null;
  if (issued) blockedReason = 'STAGE_ISSUED';
  else if (state === 'DRAFT') blockedReason = postBlocker ?? periodBlock;
  else if (prepareBlock && prepareBlock !== 'STAGE_ALREADY_INVOICED') blockedReason = prepareBlock;
  // An open period is needed to issue what is prepared: say so before anyone prepares.
  else if (!prepareBlock && periodBlock) blockedReason = periodBlock;

  return { installmentId: facts.installmentId, canPrepare, canIssue, blockedReason, steps };
}

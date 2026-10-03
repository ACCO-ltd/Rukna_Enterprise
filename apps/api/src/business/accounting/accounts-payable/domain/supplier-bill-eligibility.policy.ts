import { Decimal } from '@prisma/client/runtime/library';
import type {
  EligibilityStep,
  SupplierBillBlockedReason,
  SupplierBillEligibility,
  SupplierBillEligibilityStepKey,
  SupplierBillPaymentState,
} from '@erp/types';

import {
  periodPostingBlock,
  type PeriodPostingBlock,
  type PeriodPostingFacts,
} from '../../accounting-core/domain/period-posting.policy.js';

/**
 * Supplier bill → payment controls as pure decisions (ADR-043 Phase 2, "one source of truth").
 *
 * The commands (`SupplierBillService.post`, `SupplierPaymentService.create / post / signRelease`)
 * call these functions and map a non-null result to the exception they have always thrown; the
 * "why can't I pay this?" read model (`supplierBillEligibility`) is built from the SAME functions,
 * so the screen can never say "ready" over a refusal or "blocked" over an open door.
 */

/** The journal category a supplier bill posts under (EVT-AP-001) — what the period gate tests. */
export const SUPPLIER_BILL_JOURNAL_CATEGORY = 'ACCOUNTS_PAYABLE';

/** ADR-007: a PO-backed bill posts only once its 3-way match is complete or its exception approved. */
export const POSTABLE_MATCH_STATUSES: readonly string[] = ['MATCHED', 'MATCHED_WITH_TOLERANCE', 'APPROVED_EXCEPTION'];

/** ADR-022 CONST-DOA-005: distinct bank signatures that release a payment. */
export const RELEASE_SIGNATURES_REQUIRED = 2;

// ─── Post a bill ────────────────────────────────────────────────────────────────

export interface BillPostingFacts {
  documentStatus: string;
  postingStatus: string;
  matchStatus: string;
  purchaseOrderRevisionId: string | null;
}

export type BillPostBlock =
  | 'BILL_NOT_SUBMITTED'
  | 'BILL_AWAITING_APPROVAL'
  | 'BILL_REJECTED'
  | 'BILL_CANCELLED'
  | 'BILL_ALREADY_POSTED'
  | 'BILL_REVERSED'
  | 'MATCH_NOT_RUN'
  | 'MATCH_EXCEPTION'
  | 'MATCH_DISPUTED';

const NOT_APPROVED_BY_STATUS: Record<string, BillPostBlock> = {
  DRAFT: 'BILL_NOT_SUBMITTED',
  SUBMITTED: 'BILL_AWAITING_APPROVAL',
  REJECTED: 'BILL_REJECTED',
  CANCELLED: 'BILL_CANCELLED',
};

/** The four codes the post command answers with "Bill must be APPROVED before posting". */
export function isNotApprovedBlock(block: BillPostBlock): boolean {
  return Object.values(NOT_APPROVED_BY_STATUS).includes(block);
}

export function isMatchBlock(block: BillPostBlock): boolean {
  return block === 'MATCH_NOT_RUN' || block === 'MATCH_EXCEPTION' || block === 'MATCH_DISPUTED';
}

/**
 * May the bill be posted? Checked in the post command's order: approved → not already in the
 * ledger → match complete (PO-backed bills only). The accounting-period gate is separate
 * (`periodPostingBlock`) because the ledger applies it inside the posting transaction.
 */
export function billPostingBlock(bill: BillPostingFacts): BillPostBlock | null {
  if (bill.documentStatus !== 'APPROVED') {
    return NOT_APPROVED_BY_STATUS[bill.documentStatus] ?? 'BILL_AWAITING_APPROVAL';
  }
  if (bill.postingStatus === 'POSTED') return 'BILL_ALREADY_POSTED';
  // A reversed bill has a posting and its mirror in the ledger; posting it again would re-flip it
  // to POSTED against the old journal (the posting port returns the existing entry). Record a new bill.
  if (bill.postingStatus === 'REVERSED') return 'BILL_REVERSED';
  if (bill.purchaseOrderRevisionId && !POSTABLE_MATCH_STATUSES.includes(bill.matchStatus)) {
    if (bill.matchStatus === 'EXCEPTION') return 'MATCH_EXCEPTION';
    if (bill.matchStatus === 'DISPUTED') return 'MATCH_DISPUTED';
    return 'MATCH_NOT_RUN';
  }
  return null;
}

// ─── Settle (pay) a bill ────────────────────────────────────────────────────────

export type BillSettlementBlock = 'BILL_NOT_POSTED' | 'NOTHING_OUTSTANDING' | 'EXCEEDS_OUTSTANDING';

/**
 * May a payment be allocated to the bill? Only a POSTED bill is a live AP liability (AP is
 * credited at EVT-AP-001), and an allocation may not exceed the balance no payment covers yet.
 * With `amount` the command's check (EXCEEDS_OUTSTANDING); without it the read model's
 * "is there anything left to pay" (NOTHING_OUTSTANDING).
 */
export function billSettlementBlock(
  bill: { postingStatus: string; outstandingAmount: Decimal | string | number },
  amount?: Decimal,
): BillSettlementBlock | null {
  if (bill.postingStatus !== 'POSTED') return 'BILL_NOT_POSTED';
  const outstanding = new Decimal(bill.outstandingAmount.toString());
  if (amount !== undefined) return amount.gt(outstanding) ? 'EXCEEDS_OUTSTANDING' : null;
  return outstanding.lte(0) ? 'NOTHING_OUTSTANDING' : null;
}

// ─── Release and post a payment ─────────────────────────────────────────────────

export type PaymentPostBlock = 'PAYMENT_ALREADY_POSTED' | 'PAYMENT_NOT_RELEASED' | 'PAYMENT_NOT_APPROVED';

/**
 * May the payment be posted? An account under bank-signatory dual control must reach RELEASED
 * (≥2 signatures); an account without signatories posts from APPROVED.
 */
export function paymentPostingBlock(
  payment: { documentStatus: string; postingStatus: string },
  underDualControl: boolean,
): PaymentPostBlock | null {
  if (payment.postingStatus === 'POSTED') return 'PAYMENT_ALREADY_POSTED';
  if (underDualControl) return payment.documentStatus === 'RELEASED' ? null : 'PAYMENT_NOT_RELEASED';
  return payment.documentStatus === 'APPROVED' ? null : 'PAYMENT_NOT_APPROVED';
}

/** The signature that reaches the threshold releases the payment. */
export function isReleaseComplete(signatures: number): boolean {
  return signatures >= RELEASE_SIGNATURES_REQUIRED;
}

// ─── Paid / pending ─────────────────────────────────────────────────────────────

export interface BillAllocationFacts {
  allocatedAmount: Decimal | string | number;
  /** The allocation's own posting status (POSTED = money has left). */
  postingStatus: string;
  paymentId: string;
  paymentDate: Date | string | null;
}

export interface BillPaymentSummary {
  paid: Decimal;
  pending: Decimal;
  /** Distinct payments with a posted allocation. */
  paidPaymentCount: number;
  /** Latest payment date among posted allocations, YYYY-MM-DD. */
  lastPaymentDate: string | null;
}

const PENDING_ALLOCATION = new Set(['NOT_POSTED', 'PENDING']);

/**
 * Paid = Σ POSTED allocations; pending = Σ allocations on payments not posted yet (already
 * deducted from the bill's outstanding amount). One rule for the bill page's payments panel and
 * procurement's payment status (ADR-043 decision 4).
 */
export function summarizeBillPayments(allocations: readonly BillAllocationFacts[]): BillPaymentSummary {
  let paid = new Decimal(0);
  let pending = new Decimal(0);
  const paidPayments = new Set<string>();
  let last: string | null = null;
  for (const allocation of allocations) {
    const amount = new Decimal(allocation.allocatedAmount.toString());
    if (allocation.postingStatus === 'POSTED') {
      paid = paid.plus(amount);
      paidPayments.add(allocation.paymentId);
      const day = allocation.paymentDate ? new Date(allocation.paymentDate).toISOString().slice(0, 10) : null;
      if (day && (!last || day > last)) last = day;
    } else if (PENDING_ALLOCATION.has(allocation.postingStatus)) {
      pending = pending.plus(amount);
    }
  }
  return { paid, pending, paidPaymentCount: paidPayments.size, lastPaymentDate: last };
}

/** The bill's payment state in one word, for procurement and lists. */
export function billPaymentState(
  bill: { postingStatus: string; totalAmount: Decimal | string | number },
  summary: Pick<BillPaymentSummary, 'paid' | 'pending'>,
): SupplierBillPaymentState {
  if (bill.postingStatus === 'REVERSED') return 'REVERSED';
  if (bill.postingStatus !== 'POSTED' && bill.postingStatus !== 'OPENING_BALANCE') return 'NOT_POSTED';
  const total = new Decimal(bill.totalAmount.toString());
  if (summary.paid.gte(total) && total.gt(0)) return 'PAID';
  if (summary.paid.gt(0)) return 'PARTIALLY_PAID';
  if (summary.pending.gt(0)) return 'PAYMENT_IN_PROGRESS';
  return 'UNPAID';
}

// ─── "Why can't I pay this?" ────────────────────────────────────────────────────

export interface BillEligibilityFacts {
  bill: BillPostingFacts & {
    id: string;
    outstandingAmount: Decimal | string | number;
    returnReason?: string | null;
    lastPostingErrorCode?: string | null;
  };
  /** The period covering the bill date — the one the post would land in. */
  postingPeriod: PeriodPostingFacts | null;
  /** Every payment allocation to the bill, with its payment's state. */
  allocations: ReadonlyArray<{
    postingStatus: string;
    payment: { documentStatus: string; postingStatus: string; underDualControl: boolean; signatures: number };
  }>;
}

type Step = EligibilityStep<SupplierBillEligibilityStepKey>;

function step(
  key: SupplierBillEligibilityStepKey,
  owner: Step['owner'],
  status: Step['status'],
  code: string | null = null,
  detail: string | null = null,
): Step {
  return { key, owner, status, code: status === 'DONE' || status === 'NOT_APPLICABLE' ? null : code, detail };
}

const LEDGER_STATES = new Set(['POSTED', 'OPENING_BALANCE']);
const DEAD_PAYMENT = new Set(['REJECTED', 'CANCELLED']);

/** A payment that will still move money against this bill: allocated, not posted, not abandoned. */
function isInFlight(a: BillEligibilityFacts['allocations'][number]): boolean {
  return (
    PENDING_ALLOCATION.has(a.postingStatus) &&
    !DEAD_PAYMENT.has(a.payment.documentStatus) &&
    a.payment.postingStatus !== 'POSTED' &&
    a.payment.postingStatus !== 'REVERSED'
  );
}

export function supplierBillEligibility(facts: BillEligibilityFacts): SupplierBillEligibility {
  const { bill } = facts;
  const postBlock = billPostingBlock(bill);
  const inLedger = LEDGER_STATES.has(bill.postingStatus);
  const reversed = bill.postingStatus === 'REVERSED';
  const periodBlock: PeriodPostingBlock | null =
    inLedger || reversed ? null : periodPostingBlock(facts.postingPeriod, SUPPLIER_BILL_JOURNAL_CATEGORY);
  const settlementBlock = billSettlementBlock(bill);
  const outstanding = new Decimal(bill.outstandingAmount.toString());
  const inFlight = facts.allocations.filter(isInFlight);

  const steps: Step[] = [];

  // 1. Submitted (the AP clerk enters and submits the bill).
  const doc = bill.documentStatus;
  steps.push(
    doc === 'DRAFT'
      ? step('SUBMITTED', 'FINANCE', 'PENDING', 'BILL_NOT_SUBMITTED', bill.returnReason ? `Returned for correction: ${bill.returnReason}` : null)
      : doc === 'REJECTED'
        ? step('SUBMITTED', 'FINANCE', 'BLOCKED', 'BILL_REJECTED')
        : doc === 'CANCELLED'
          ? step('SUBMITTED', 'FINANCE', 'BLOCKED', 'BILL_CANCELLED')
          : step('SUBMITTED', 'FINANCE', 'DONE'),
  );

  // 2. 3-way match (PO-backed bills only; runs automatically at submit).
  if (!bill.purchaseOrderRevisionId) {
    steps.push(step('MATCHED', 'PROCUREMENT', 'NOT_APPLICABLE'));
  } else if (POSTABLE_MATCH_STATUSES.includes(bill.matchStatus)) {
    steps.push(step('MATCHED', 'PROCUREMENT', 'DONE', null, bill.matchStatus));
  } else if (bill.matchStatus === 'EXCEPTION') {
    steps.push(step('MATCHED', 'PROCUREMENT', 'BLOCKED', 'MATCH_EXCEPTION'));
  } else if (bill.matchStatus === 'DISPUTED') {
    steps.push(step('MATCHED', 'PROCUREMENT', 'BLOCKED', 'MATCH_DISPUTED'));
  } else {
    steps.push(step('MATCHED', 'PROCUREMENT', 'PENDING', 'MATCH_NOT_RUN'));
  }

  // 3. Approved.
  steps.push(
    doc === 'APPROVED'
      ? step('APPROVED', 'APPROVER', 'DONE')
      : doc === 'REJECTED' || doc === 'CANCELLED'
        ? step('APPROVED', 'APPROVER', 'BLOCKED', NOT_APPROVED_BY_STATUS[doc])
        : step('APPROVED', 'APPROVER', 'PENDING', NOT_APPROVED_BY_STATUS[doc] ?? 'BILL_AWAITING_APPROVAL'),
  );

  // 4. The accounting period the bill posts into (bill date) accepts AP postings.
  if (inLedger) steps.push(step('PERIOD_OPEN', 'FINANCE', 'DONE'));
  else if (reversed) steps.push(step('PERIOD_OPEN', 'FINANCE', 'NOT_APPLICABLE'));
  else {
    steps.push(
      periodBlock
        ? step('PERIOD_OPEN', 'FINANCE', 'BLOCKED', periodBlock, facts.postingPeriod?.name ?? null)
        : step('PERIOD_OPEN', 'FINANCE', 'DONE', null, facts.postingPeriod?.name ?? null),
    );
  }

  // 5. Posted to the ledger.
  steps.push(
    inLedger
      ? step('POSTED', 'FINANCE', 'DONE')
      : reversed
        ? step('POSTED', 'FINANCE', 'BLOCKED', 'BILL_REVERSED')
        : bill.postingStatus === 'FAILED'
          ? step('POSTED', 'FINANCE', 'PENDING', 'POSTING_FAILED', bill.lastPostingErrorCode ?? null)
          : step('POSTED', 'FINANCE', 'PENDING', 'BILL_NOT_POSTED'),
  );

  // 6–8. Payment: approved → released (dual control) → posted.
  if (reversed) {
    steps.push(step('PAYMENT_APPROVED', 'APPROVER', 'NOT_APPLICABLE'));
    steps.push(step('PAYMENT_RELEASED', 'SIGNATORIES', 'NOT_APPLICABLE'));
    steps.push(step('PAID', 'FINANCE', 'NOT_APPLICABLE'));
  } else if (bill.postingStatus !== 'POSTED') {
    steps.push(step('PAYMENT_APPROVED', 'APPROVER', 'PENDING', 'BILL_NOT_POSTED'));
    steps.push(step('PAYMENT_RELEASED', 'SIGNATORIES', 'PENDING', 'BILL_NOT_POSTED'));
    steps.push(step('PAID', 'FINANCE', 'PENDING', 'BILL_NOT_POSTED'));
  } else if (inFlight.length === 0) {
    if (outstanding.lte(0)) {
      steps.push(step('PAYMENT_APPROVED', 'APPROVER', 'DONE'));
      steps.push(step('PAYMENT_RELEASED', 'SIGNATORIES', 'DONE'));
      steps.push(step('PAID', 'FINANCE', 'DONE'));
    } else {
      steps.push(step('PAYMENT_APPROVED', 'FINANCE', 'PENDING', 'NO_PAYMENT_RECORDED'));
      steps.push(step('PAYMENT_RELEASED', 'SIGNATORIES', 'PENDING', 'NO_PAYMENT_RECORDED'));
      steps.push(step('PAID', 'FINANCE', 'PENDING', 'NO_PAYMENT_RECORDED'));
    }
  } else {
    const awaitingApproval = inFlight.filter((a) => a.payment.documentStatus === 'DRAFT');
    steps.push(
      awaitingApproval.length > 0
        ? step('PAYMENT_APPROVED', 'APPROVER', 'PENDING', 'PAYMENT_AWAITING_APPROVAL', `${awaitingApproval.length} payment(s) waiting for approval`)
        : step('PAYMENT_APPROVED', 'APPROVER', 'DONE'),
    );
    const dual = inFlight.filter((a) => a.payment.underDualControl);
    const unreleased = dual.filter((a) => a.payment.documentStatus !== 'RELEASED');
    steps.push(
      dual.length === 0
        ? step('PAYMENT_RELEASED', 'SIGNATORIES', 'NOT_APPLICABLE')
        : unreleased.length > 0
          ? step(
              'PAYMENT_RELEASED',
              'SIGNATORIES',
              'PENDING',
              'PAYMENT_AWAITING_RELEASE',
              `${Math.min(...unreleased.map((a) => a.payment.signatures))} of ${RELEASE_SIGNATURES_REQUIRED} signatures`,
            )
          : step('PAYMENT_RELEASED', 'SIGNATORIES', 'DONE'),
    );
    steps.push(step('PAID', 'FINANCE', 'PENDING', 'PAYMENT_NOT_POSTED'));
  }

  const canPost = postBlock === null && periodBlock === null;
  const canPay = settlementBlock === null;

  let blockedReason: SupplierBillBlockedReason | null = null;
  if (bill.postingStatus !== 'POSTED') {
    // The next action is posting (or nothing, for a reversed bill).
    if (postBlock && postBlock !== 'BILL_ALREADY_POSTED') blockedReason = postBlock;
    else if (periodBlock) blockedReason = periodBlock;
  } else if (!canPay) {
    // Posted with nothing uncovered: the balance sits on a payment in flight, or it is paid.
    const pendingPayment = steps.find(
      (s) => s.status === 'PENDING' && (s.key === 'PAYMENT_APPROVED' || s.key === 'PAYMENT_RELEASED' || s.key === 'PAID'),
    );
    blockedReason = (pendingPayment?.code as SupplierBillBlockedReason | undefined) ?? 'FULLY_PAID';
  }

  return {
    billId: bill.id,
    canPost,
    canPay,
    blockedReason,
    steps,
    outstandingAmount: outstanding.toFixed(2),
    paymentsInFlight: inFlight.length,
    signaturesRequired: RELEASE_SIGNATURES_REQUIRED,
  };
}

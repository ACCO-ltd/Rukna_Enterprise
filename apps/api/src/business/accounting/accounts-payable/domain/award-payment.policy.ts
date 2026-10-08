import { Decimal } from '@prisma/client/runtime/library';

/**
 * ADR-045 — paying from a quotation award: the money rules, pure (no I/O). Every amount is a
 * Decimal on the 2-dp grid; every date is a source-document date (never the clock).
 */

const ZERO = new Decimal(0);
const sum = (values: ReadonlyArray<Decimal>) => values.reduce((s, v) => s.add(v), ZERO);
export const floor2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_DOWN);
export const round4 = (d: Decimal) => d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

// ── Funding cap (§1) ────────────────────────────────────────────────────────────────────────────

export interface FundingAdvance {
  amount: Decimal;
  /** Σ returns recorded on it. */
  returned: Decimal;
  /** False when REVERSED or CANCELLED (a DRAFT waiting for approval is live: it holds the room). */
  live: boolean;
}

export interface FundingPurchaseAllocation {
  amount: Decimal;
  /** False when its payment is REVERSED / CANCELLED / REJECTED. */
  live: boolean;
}

export interface FundingBillAllocation {
  amount: Decimal;
  live: boolean;
  /** The paying payment also has a purchase allocation to this PO (then it is counted there). */
  paymentFundsPoDirectly: boolean;
}

export interface FundingInputs {
  /** The PO's ordered amount (active revision Σ qty × unit price). */
  ordered: Decimal;
  /**
   * Σ totals of the PO's POSTED bills. A posted bill above the order passed the price-exception
   * approval (or the matching tolerance), so the room to fund grows to it (product owner Q3).
   */
  postedBillsTotal?: Decimal;
  advances: ReadonlyArray<FundingAdvance>;
  purchaseAllocations: ReadonlyArray<FundingPurchaseAllocation>;
  billAllocations: ReadonlyArray<FundingBillAllocation>;
}

export interface FundingPosition {
  /** max(ordered, posted bills) — what may be funded at most. */
  cap: Decimal;
  funded: Decimal;
  /** cap − funded, never negative. */
  remaining: Decimal;
}

/**
 * funded = Σ live advances (amount − returns) + Σ live purchase allocations + Σ live bill
 * allocations made by payments that do not also fund the PO directly (a prepayment later applied
 * to the bill is counted once).
 */
export function fundingPosition(input: FundingInputs): FundingPosition {
  const advances = sum(input.advances.filter((a) => a.live).map((a) => a.amount.sub(a.returned)));
  const direct = sum(input.purchaseAllocations.filter((a) => a.live).map((a) => a.amount));
  const viaBills = sum(
    input.billAllocations.filter((a) => a.live && !a.paymentFundsPoDirectly).map((a) => a.amount),
  );
  const funded = advances.add(direct).add(viaBills);
  const posted = input.postedBillsTotal ?? ZERO;
  const cap = posted.greaterThan(input.ordered) ? posted : input.ordered;
  const remaining = cap.sub(funded);
  return { cap, funded, remaining: remaining.isNegative() ? ZERO : remaining };
}

/** Would funding `requested` more keep funded ≤ cap? Equality is allowed. */
export function fundingAllows(position: FundingPosition, requested: Decimal): boolean {
  return position.funded.add(requested).lessThanOrEqualTo(position.cap);
}

// ── Advance outstanding (§2, §6) ────────────────────────────────────────────────────────────────

export interface OutstandingAdvance {
  amount: Decimal;
  /** POSTED with no journal: marked posted before GL posting existed (§7). */
  legacy: boolean;
}

export interface OutstandingApplication {
  amount: Decimal;
  postingStatus: string;
}

/**
 * What the buyer still holds. A posted advance: amount − Σ POSTED applications − Σ returns. A
 * legacy advance keeps today's evidence arithmetic: amount − Σ every evidence row − Σ returns.
 */
export function advanceOutstanding(
  advance: OutstandingAdvance,
  applications: ReadonlyArray<OutstandingApplication>,
  returns: ReadonlyArray<{ amount: Decimal }>,
): Decimal {
  const applied = sum(
    applications.filter((a) => advance.legacy || a.postingStatus === 'POSTED').map((a) => a.amount),
  );
  return advance.amount.sub(applied).sub(sum(returns.map((r) => r.amount)));
}

/** A legacy advance: POSTED before posting reached the GL (no journal) — labelled, never re-posted. */
export function isLegacyAdvance(advance: { postingStatus: string; postedJournalEntryId: string | null }): boolean {
  return advance.postingStatus === 'POSTED' && advance.postedJournalEntryId === null;
}

// ── Applying an advance to a bill (EVT-AP-008) ─────────────────────────────────────────────────

export type ApplicationBlock = 'APPLICATION_EXCEEDS_OUTSTANDING' | 'APPLICATION_AMOUNT_INVALID';

/**
 * The amount to apply: min(bill outstanding, advance outstanding) by default; a requested amount
 * must be positive and fit both.
 */
export function applicationAmount(
  billOutstanding: Decimal,
  advanceOutstanding: Decimal,
  requested?: Decimal,
): { amount: Decimal } | { block: ApplicationBlock } {
  const room = billOutstanding.lessThan(advanceOutstanding) ? billOutstanding : advanceOutstanding;
  if (requested === undefined) {
    return room.greaterThan(0) ? { amount: room } : { block: 'APPLICATION_EXCEEDS_OUTSTANDING' };
  }
  if (requested.lessThanOrEqualTo(0) || requested.decimalPlaces() > 2) return { block: 'APPLICATION_AMOUNT_INVALID' };
  return requested.greaterThan(room) ? { block: 'APPLICATION_EXCEEDS_OUTSTANDING' } : { amount: requested };
}

/** The application's accounting date: the later of the two source documents' dates. */
export function applicationDate(billDate: Date, advancedAt: Date): Date {
  return billDate.getTime() >= advancedAt.getTime() ? billDate : advancedAt;
}

// ── Receipt split (§2 settle step 1) ────────────────────────────────────────────────────────────

export interface ReceiptLineInput {
  id: string;
  /** The quantity billed on this line (accepted, not yet billed). */
  quantity: Decimal;
  /** The PO unit price — the weight is quantity × unit price. */
  poUnitPrice: Decimal;
}

export interface ReceiptLineSplit {
  id: string;
  quantity: Decimal;
  /** 2 dp; Σ = total exactly. */
  amount: Decimal;
  /** round₄(amount / quantity) — what the match compares with the PO price. */
  unitPrice: Decimal;
}

/**
 * The typed receipt total split across the billed lines by their PO value: each share floored to
 * the cent, the rounding remainder on the largest line, so Σ = total exactly and no line is
 * negative (the remainder is ≥ 0 and added). Lines with no PO value share by quantity.
 */
export function splitReceiptTotal(total: Decimal, lines: ReadonlyArray<ReceiptLineInput>): ReceiptLineSplit[] {
  if (lines.length === 0) return [];
  const total2 = total.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  let weights = lines.map((l) => l.quantity.mul(l.poUnitPrice));
  if (!sum(weights).greaterThan(0)) weights = lines.map((l) => l.quantity);
  const weightSum = sum(weights);
  const amounts = lines.map((_, i) => floor2(total2.mul(weights[i]).div(weightSum)));
  const remainder = total2.sub(sum(amounts));
  let largest = 0;
  weights.forEach((w, i) => {
    if (w.greaterThan(weights[largest])) largest = i;
  });
  amounts[largest] = amounts[largest].add(remainder);
  return lines.map((l, i) => ({
    id: l.id,
    quantity: l.quantity,
    amount: amounts[i],
    unitPrice: l.quantity.greaterThan(0) ? round4(amounts[i].div(l.quantity)) : ZERO,
  }));
}

// ── Release blockers (draft endpoints) ──────────────────────────────────────────────────────────

export type ReleaseBlocker =
  | 'PAYMENT_PO_NOT_OPEN'
  | 'PAYMENT_PATH_MISMATCH'
  | 'NOTHING_TO_FUND'
  | 'POSTING_ACCOUNT_NOT_CONFIGURED:STAFF_ADVANCE'
  | 'NO_CASH_ACCOUNT'
  | 'VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT';

export interface ReleaseFacts {
  requestAwarded: boolean;
  poOpen: boolean;
  pathMatches: boolean;
  remainingToFund: Decimal;
  /** BUYER_CASH only: the STAFF_ADVANCE profile resolves on the default date. */
  staffAdvanceConfigured?: boolean;
  /** At least one account the command could draw on. */
  usableAccounts: number;
  /** FINANCE_PAYS_SUPPLIER only: the caller maintains the supplier (and the rule is active). */
  callerIsVendorMaintainer?: boolean;
}

/** The blocker codes for a draft, most fundamental first; [] = ready to pay. */
export function releaseBlockers(f: ReleaseFacts): ReleaseBlocker[] {
  const blockers: ReleaseBlocker[] = [];
  if (!f.requestAwarded || !f.poOpen) blockers.push('PAYMENT_PO_NOT_OPEN');
  if (!f.pathMatches) blockers.push('PAYMENT_PATH_MISMATCH');
  if (!f.remainingToFund.greaterThan(0)) blockers.push('NOTHING_TO_FUND');
  if (f.staffAdvanceConfigured === false) blockers.push('POSTING_ACCOUNT_NOT_CONFIGURED:STAFF_ADVANCE');
  if (f.usableAccounts === 0) blockers.push('NO_CASH_ACCOUNT');
  if (f.callerIsVendorMaintainer) blockers.push('VENDOR_MAINTAINER_CANNOT_CREATE_PO_OR_PROCESS_PAYMENT');
  return blockers;
}

// ── Accounts that may fund buyer cash (§2) ──────────────────────────────────────────────────────

export type CashAccountBlock = 'ACCOUNT_NOT_USABLE' | 'CURRENCY_MISMATCH' | 'ACCOUNT_REQUIRES_DUAL_CONTROL';

/** An ACTIVE account that allows payments, in the PO's currency, with no active signatories. */
export function cashAccountBlock(
  account: { status: string; allowsPayments: boolean; currencyCode: string },
  activeSignatories: number,
  currencyCode: string,
): CashAccountBlock | null {
  if (account.status !== 'ACTIVE' || !account.allowsPayments) return 'ACCOUNT_NOT_USABLE';
  if (account.currencyCode !== currencyCode) return 'CURRENCY_MISMATCH';
  if (activeSignatories > 0) return 'ACCOUNT_REQUIRES_DUAL_CONTROL';
  return null;
}

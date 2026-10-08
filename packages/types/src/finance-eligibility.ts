/**
 * ADR-043 Phase 2 — "why is this blocked?" read models.
 *
 * Every step below is a rule a command already enforces; the read model is computed by the SAME
 * pure policy functions the commands call, so the screen can never offer what the server refuses
 * (or hide what it allows). See `docs/design/finance-projects-contract.md` → Eligibility.
 */

/** Where a step stands. NOT_APPLICABLE = the rule does not apply to this document (e.g. no PO). */
export type EligibilityStepStatus = 'DONE' | 'PENDING' | 'BLOCKED' | 'NOT_APPLICABLE';

/** Who moves a step forward — a team, not a person. */
export type EligibilityOwner = 'FINANCE' | 'APPROVER' | 'PROCUREMENT' | 'SIGNATORIES' | 'CONSTRUCTION';

export interface EligibilityStep<K extends string = string> {
  key: K;
  status: EligibilityStepStatus;
  owner: EligibilityOwner;
  /** Machine reason while the step is not DONE / NOT_APPLICABLE (the UI words it); null otherwise. */
  code: string | null;
  /** Server detail worth showing as-is (a period name, "1 of 2 signatures", a posting error). */
  detail: string | null;
}

// ─── Supplier bill ──────────────────────────────────────────────────────────────

export type SupplierBillEligibilityStepKey =
  | 'SUBMITTED'
  | 'MATCHED'
  | 'APPROVED'
  | 'PERIOD_OPEN'
  | 'POSTED'
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_RELEASED'
  | 'PAID';

/**
 * The one reason the bill's next action (post while unposted, pay once posted) is refused.
 * Post: BILL_NOT_SUBMITTED / BILL_AWAITING_APPROVAL / BILL_REJECTED / BILL_CANCELLED (the post
 * command's "must be APPROVED" 400), BILL_REVERSED (409), MATCH_* (the 3-way-match 400),
 * NO_PERIOD / PERIOD_CLOSED / PERIOD_LOCKED (the ledger's period 400), OPENING_BALANCE_BILL (409).
 * Pay: BILL_NOT_POSTED (only POSTED or OPENING_BALANCE bills are paid — an opening-balance bill's
 * balance is already on AP control), OPENING_BALANCE_AP_NOT_RECONCILED (409 — the carried-over
 * payables do not tie to the AP control account the payment debits), PAYMENT_AWAITING_APPROVAL /
 * PAYMENT_AWAITING_RELEASE / PAYMENT_NOT_POSTED (the whole balance is on a payment still in
 * flight), FULLY_PAID.
 */
export type SupplierBillBlockedReason =
  | 'BILL_NOT_SUBMITTED'
  | 'BILL_AWAITING_APPROVAL'
  | 'BILL_REJECTED'
  | 'BILL_CANCELLED'
  | 'BILL_REVERSED'
  /** Imported from the previous system: already in the ledger via the opening-balance journal; never posted again. */
  | 'OPENING_BALANCE_BILL'
  /** Opening-balance bill whose carried-over payables do not tie to the AP control account (refused, 409). */
  | 'OPENING_BALANCE_AP_NOT_RECONCILED'
  | 'MATCH_NOT_RUN'
  | 'MATCH_EXCEPTION'
  | 'MATCH_DISPUTED'
  | 'NO_PERIOD'
  | 'PERIOD_CLOSED'
  | 'PERIOD_LOCKED'
  | 'BILL_NOT_POSTED'
  | 'PAYMENT_AWAITING_APPROVAL'
  | 'PAYMENT_AWAITING_RELEASE'
  | 'PAYMENT_NOT_POSTED'
  | 'FULLY_PAID';

/** `GET /bills/:id/eligibility` (gate `manage:payable`, the bill's own gate). */
export interface SupplierBillEligibility {
  billId: string;
  /** The post command would accept the bill now. */
  canPost: boolean;
  /** A new payment may be allocated to the bill now (POSTED with an uncovered balance). */
  canPay: boolean;
  blockedReason: SupplierBillBlockedReason | null;
  steps: Array<EligibilityStep<SupplierBillEligibilityStepKey>>;
  /** Balance not yet covered by any payment (draft payments included), decimal string. */
  outstandingAmount: string;
  /** Payments allocated to the bill that have not posted yet (draft / approved / released). */
  paymentsInFlight: number;
  /** Bank signatures a payment needs to be released (ADR-022 CONST-DOA-005). */
  signaturesRequired: number;
}

// ─── Payment-schedule stage (milestone billing) ─────────────────────────────────

export type StageBillingEligibilityStepKey =
  | 'CONTRACT_ACTIVE'
  | 'MILESTONE_LINKED'
  | 'MILESTONE_VERIFIED'
  | 'READY_TO_BILL'
  | 'INVOICE_PREPARED'
  | 'PERIOD_OPEN'
  | 'INVOICE_ISSUED';

/**
 * Prepare: CONTRACT_NOT_ACTIVE / MILESTONE_NOT_LINKED / MILESTONE_NOT_VERIFIED (the prepare
 * command's coded 400s). Issue: NO_PERIOD / PERIOD_CLOSED / PERIOD_LOCKED, CONTRACT_NOT_ACTIVE
 * (an advance whose contract was never executed). STAGE_ISSUED = already billed.
 */
export type StageBillingBlockedReason =
  | 'CONTRACT_NOT_ACTIVE'
  | 'MILESTONE_NOT_LINKED'
  | 'MILESTONE_NOT_VERIFIED'
  | 'NO_PERIOD'
  | 'PERIOD_CLOSED'
  | 'PERIOD_LOCKED'
  | 'STAGE_ISSUED';

/**
 * `GET /projects/:projectId/commercial/installments/:installmentId/billing-eligibility`, and the
 * same object on every payment-schedule row (`CommercialPaymentScheduleInstallment.billingEligibility`).
 */
export interface StageBillingEligibility {
  installmentId: string;
  /** "Prepare invoice" would be accepted now (no live invoice, contract active, gate passed). */
  canPrepare: boolean;
  /** "Issue invoice" would be accepted now (a draft exists and the period is open). */
  canIssue: boolean;
  blockedReason: StageBillingBlockedReason | null;
  steps: Array<EligibilityStep<StageBillingEligibilityStepKey>>;
}

// ─── Procurement: supplier-bill payment status (ADR-043 decision 4) ─────────────

export type SupplierBillPaymentState =
  | 'NOT_POSTED'
  | 'UNPAID'
  | 'PAYMENT_IN_PROGRESS'
  | 'PARTIALLY_PAID'
  | 'PAID'
  // ADR-045 — settled (in full) by the buyer's cash advance applied to it (EVT-AP-008).
  | 'PAID_BY_BUYER_CASH'
  | 'REVERSED';

export interface PurchaseOrderBillPaymentRow {
  billId: string;
  billNumber: string | null;
  supplierInvoiceNumber: string;
  billDate: string;
  dueDate: string;
  currencyCode: string;
  documentStatus: string;
  postingStatus: string;
  totalAmount: string;
  /** Σ POSTED payment allocations. */
  paidAmount: string;
  /** Σ allocations on payments not yet posted. */
  pendingAmount: string;
  /** The bill's stored balance not covered by any payment (same figure as the bills list). */
  outstandingAmount: string;
  /** Latest payment date among POSTED allocations; null when nothing is paid. */
  lastPaymentDate: string | null;
  paymentStatus: SupplierBillPaymentState;
  /** ADR-045 — Σ POSTED buyer-cash applications (included in paidAmount). */
  paidByBuyerCashAmount?: string;
  /** ADR-045 — the buyer-cash applications to the bill. */
  advanceApplications?: Array<{ advanceId: string; amount: string; allocationDate: string | null; postingStatus: string }>;
}

/**
 * `GET /procurement/purchase-orders/:id/bill-payments` — gate `view:procurement` +
 * `view:commitment-ledger` (Procurement Manager, Construction Director, Finance; NOT Project
 * Manager / Site Engineer, who stay money-blind on supplier payments).
 */
export interface PurchaseOrderBillPaymentsResponse {
  purchaseOrderId: string;
  bills: PurchaseOrderBillPaymentRow[];
}

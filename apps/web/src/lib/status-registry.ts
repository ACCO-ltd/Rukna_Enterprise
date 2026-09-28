import type { StatusTone } from '@erp/ui';

/**
 * The status registry — the single place a lifecycle status gets its tone (ADR-034).
 *
 * Every status word in the product maps to exactly one of six semantic tones:
 *
 *   neutral    draft or not started
 *   progress   submitted, pending, open, partially done
 *   attention  needs action, exception, expiring, returned
 *   success    approved, posted, active, matched, verified
 *   danger     rejected, failed, overdue, disputed
 *   historical closed, cancelled, superseded, reversed, withdrawn, archived
 *
 * The same string can mean different things on different records — ACTIVE is a project
 * doing its job (progress) but a master-data row being usable (success) — so tones are
 * looked up per vocabulary, never from a bare string. Screens must not keep their own
 * status→colour maps; add the vocabulary here instead.
 */
export const STATUS_REGISTRY = {
  project: {
    DRAFT: 'neutral',
    ACTIVE: 'progress',
    PRACTICAL_COMPLETION: 'progress',
    CLOSEOUT: 'attention',
    CLOSED: 'historical',
    CANCELLED: 'historical',
  },
  contract: {
    DRAFT: 'neutral',
    UNDER_REVIEW: 'progress',
    PENDING_SIGNATURE: 'attention',
    ACTIVE: 'progress',
    FINAL_ACCOUNT_PENDING: 'attention',
    CLOSED: 'historical',
    CANCELLED: 'historical',
    TERMINATED: 'danger',
  },
  boqVersion: {
    DRAFT: 'neutral',
    BASELINED: 'success',
    COMMITTED: 'success',
    SNAPSHOT: 'neutral',
    SUPERSEDED: 'historical',
    CANCELLED: 'historical',
  },
  /** A project cost budget version (`ProjectCostBudgetStatusValue`); DRAFT is labelled "Working". */
  costBudget: {
    DRAFT: 'neutral',
    BASELINED: 'success',
    SUPERSEDED: 'historical',
  },
  variation: {
    DRAFT: 'neutral',
    PENDING_INTERNAL: 'progress',
    INTERNAL_APPROVED: 'progress',
    CLIENT_APPROVED: 'success',
    REJECTED: 'danger',
    WITHDRAWN: 'historical',
  },
  ipa: {
    DRAFT: 'neutral',
    PENDING_INTERNAL_APPROVAL: 'progress',
    RETURNED_FOR_REVISION: 'attention',
    APPROVED_FOR_SUBMISSION: 'success',
    SUBMITTED: 'progress',
    CANCELLED: 'historical',
  },
  ipc: {
    CERTIFIED: 'success',
    PARTIALLY_CERTIFIED: 'attention',
    REJECTED: 'danger',
  },
  clientInvoice: {
    DRAFT: 'neutral',
    APPROVED: 'success',
    CANCELLED: 'historical',
  },
  /** `postingStatus` on every financial document — an axis independent of document status. */
  posting: {
    NOT_POSTED: 'neutral',
    PENDING: 'progress',
    POSTED: 'success',
    FAILED: 'danger',
    REVERSED: 'historical',
    OPENING_BALANCE: 'neutral',
  },
  /** Customer receipts, supplier payments and buyer advances (`PaymentDocStatus`). */
  payment: {
    DRAFT: 'neutral',
    APPROVED: 'success',
    RELEASED: 'success',
    REJECTED: 'danger',
    CANCELLED: 'historical',
  },
  supplierBill: {
    DRAFT: 'neutral',
    SUBMITTED: 'progress',
    APPROVED: 'success',
    REJECTED: 'danger',
    CANCELLED: 'historical',
  },
  billMatch: {
    NOT_RUN: 'neutral',
    MATCHED: 'success',
    MATCHED_WITH_TOLERANCE: 'attention',
    EXCEPTION: 'danger',
    APPROVED_EXCEPTION: 'success',
    DISPUTED: 'danger',
  },
  journal: {
    DRAFT: 'neutral',
    SUBMITTED: 'progress',
    APPROVED: 'success',
    REJECTED: 'danger',
    POSTED: 'success',
    REVERSED: 'historical',
  },
  materialRequest: {
    DRAFT: 'neutral',
    SUBMITTED: 'progress',
    APPROVED: 'success',
    PARTIALLY_ORDERED: 'progress',
    FULLY_ORDERED: 'success',
    CANCELLED: 'historical',
    CLOSED: 'historical',
  },
  purchaseOrder: {
    DRAFT: 'neutral',
    OPEN: 'progress',
    CLOSED: 'historical',
    CANCELLED: 'historical',
  },
  poRevision: {
    DRAFT: 'neutral',
    SUBMITTED: 'progress',
    APPROVED: 'success',
    ACTIVE: 'success',
    SUPERSEDED: 'historical',
    CANCELLED: 'historical',
  },
  grn: {
    DRAFT: 'neutral',
    SUBMITTED: 'progress',
    POSTED: 'success',
    EXCEPTION_PENDING: 'attention',
    CANCELLED: 'historical',
  },
  grnLineQuality: {
    PENDING_INSPECTION: 'neutral',
    ACCEPTED: 'success',
    PARTIALLY_ACCEPTED: 'attention',
    REJECTED: 'danger',
  },
  dpr: {
    DRAFT: 'neutral',
    SUBMITTED: 'progress',
    APPROVED: 'success',
    RETURNED: 'attention',
    REOPENED: 'progress',
  },
  projectDocument: {
    DRAFT: 'neutral',
    ISSUED: 'success',
    SUPERSEDED: 'historical',
    WITHDRAWN: 'historical',
    ARCHIVED: 'historical',
  },
  /** Computed on read, shown as a separate chip beside the document status. */
  documentValidity: {
    NO_EXPIRY: 'neutral',
    NOT_YET_VALID: 'neutral',
    VALID: 'success',
    EXPIRING_SOON: 'attention',
    EXPIRED: 'danger',
  },
  approval: {
    PENDING: 'progress',
    APPROVED: 'success',
    REJECTED: 'danger',
    CANCELLED: 'historical',
  },
  fiscalPeriod: {
    DRAFT: 'neutral',
    OPEN: 'progress',
    LOCKED: 'attention',
    CLOSED: 'historical',
    REOPENED: 'progress',
  },
  /** Clients, suppliers, materials, districts, accounts, bank accounts, users. */
  masterData: {
    ACTIVE: 'success',
    INACTIVE: 'historical',
    SUSPENDED: 'attention',
    DISCONTINUED: 'historical',
    CLOSED: 'historical',
    SUPERSEDED: 'historical',
  },
  /** `FiscalYearStatus` — the year as a whole; its months use `fiscalPeriod`. */
  fiscalYear: {
    DRAFT: 'neutral',
    OPEN: 'progress',
    LOCKED: 'attention',
    CLOSED: 'historical',
  },
  /** How much of a certificate the client has paid (`SettlementState`, derived client-side). */
  ipcSettlement: {
    UNPAID: 'neutral',
    PARTIALLY_PAID: 'progress',
    PAID: 'success',
    OVER_ALLOCATED: 'danger',
  },
  /** Whether a certificate is the one in force for its application (`isEffective`). */
  ipcEffectiveness: {
    EFFECTIVE: 'success',
    SUPERSEDED: 'historical',
  },
  /** One revision of a project document (`DocumentRevisionStatus`). */
  documentRevision: {
    DRAFT: 'neutral',
    ISSUED: 'success',
    SUPERSEDED: 'historical',
    WITHDRAWN: 'historical',
  },
  /** A project requirement's approval question (`RequirementApprovalStatus`). */
  requirementApproval: {
    DRAFT: 'neutral',
    SUBMITTED: 'progress',
    APPROVED: 'success',
    CANCELLED: 'historical',
    CLOSED: 'historical',
  },
  /** A requirement's (or line's) ordering question (`RequirementFulfillmentStatus`). */
  requirementFulfilment: {
    NOT_ORDERED: 'neutral',
    PARTIALLY_ORDERED: 'progress',
    FULLY_ORDERED: 'success',
  },
  /** A purchase order's advance funding (`PoFundingStatus`). */
  poFunding: {
    NOT_FUNDED: 'neutral',
    PARTIALLY_FUNDED: 'progress',
    FUNDED: 'success',
  },
  /** Goods received against a PO or one of its lines (`PoReceivingStatus`/`PoLineReceivingStatus`). */
  poReceiving: {
    NOT_RECEIVED: 'neutral',
    PARTIALLY_RECEIVED: 'progress',
    RECEIVED: 'success',
  },
  /** A PO's settlement reconciliation (`PoSettlementStatus`). */
  poSettlement: {
    OPEN: 'progress',
    ACTION_REQUIRED: 'attention',
    SETTLED: 'success',
  },
  /**
   * ADR-023 per-installment billing status (`PaymentInstallmentBillStatus`), plus two display
   * states the Commercial tab derives from the same read model (never from its own rules):
   * READY = NEXT with no `billingBlocker` and no invoice yet ("Ready to bill"); DRAFT = the stage's
   * invoice is prepared but not issued. A blocked NEXT stage reads as UPCOMING plus its reason.
   */
  paymentInstallment: {
    UPCOMING: 'neutral',
    NEXT: 'neutral',
    READY: 'progress',
    DRAFT: 'neutral',
    BILLED: 'progress',
    PARTIALLY_PAID: 'progress',
    PAID: 'success',
  },
  /** A row of the Commercial Billing "To do" list (`CommercialTodoKind`). */
  commercialTodo: {
    OVERDUE_INVOICE: 'danger',
    READY_TO_INVOICE: 'progress',
    DRAFT_INVOICE: 'neutral',
    ISSUED_NOT_SENT: 'attention',
    BLOCKED_STAGE: 'neutral',
  },
  /** The milestone journey card's user-facing state (`MilestoneUserState`, derived by the adapter). */
  milestoneJourney: {
    upcoming: 'neutral',
    'in-progress': 'progress',
    'review-for-billing': 'attention',
    'ready-to-bill': 'success',
    'invoice-draft': 'attention',
    'invoice-issued': 'progress',
    'awaiting-payment': 'progress',
    invoiced: 'progress',
    'partially-paid': 'progress',
    paid: 'success',
  },
  /** Commercial overview "next invoice" stage (`OverviewCycleStage`). */
  commercialCycle: {
    NO_CONTRACT: 'neutral',
    REVIEW_FOR_BILLING: 'attention',
    READY_TO_BILL: 'success',
    ALL_BILLED: 'progress',
    ALL_COMPLETE: 'success',
  },
  /** A client invoice's collection state on Billing & Collection (`CollectionPaymentState`). */
  invoiceCollection: {
    DRAFT: 'neutral',
    AWAITING_PAYMENT: 'progress',
    PARTIALLY_PAID: 'progress',
    PAID: 'success',
    OVERDUE: 'danger',
    CANCELLED: 'historical',
    /** Approved but not yet in the ledger (backend `AWAITING_POSTING`). */
    AWAITING_POSTING: 'attention',
  },
  /** Whether an approved variation has been realised in billing (`VariationBillingState`). */
  variationBilling: {
    APPROVED_NOT_BILLED: 'attention',
    INVOICE_DRAFT: 'neutral',
    INVOICED: 'success',
    OMISSION_BILLED: 'success',
  },
  /** Server-judged urgency on notifications and attention items (`NotificationSeverity`, finance attention). */
  severity: {
    INFO: 'neutral',
    WARNING: 'attention',
    URGENT: 'danger',
    CRITICAL: 'danger',
  },
  /** Finance overview control checks (`FinanceControlState`). */
  financeControl: {
    OK: 'success',
    ATTENTION: 'attention',
    UNAVAILABLE: 'neutral',
  },
  /** Plan-vs-actual schedule health (`ProgressScheduleStatus`). */
  scheduleHealth: {
    AHEAD: 'success',
    ON_TRACK: 'success',
    BEHIND: 'attention',
    INSUFFICIENT_DATA: 'neutral',
  },
  /** ADR-021 physical-vs-financial signal (`PhysicalFinancialSignalResponse['status']`). */
  costSignal: {
    ALIGNED: 'success',
    PROGRESS_AHEAD: 'progress',
    COST_AHEAD: 'attention',
    INSUFFICIENT_DATA: 'neutral',
  },
  /** Collection-vs-progress signal (`CollectionProgressSignalResponse['status']`). */
  collectionSignal: {
    ALIGNED: 'success',
    CASH_AHEAD: 'progress',
    WORK_AHEAD: 'attention',
    INSUFFICIENT_DATA: 'neutral',
  },
  /** A programme milestone (`ProgrammeMilestoneResponse['status']`). */
  programmeMilestone: {
    PLANNED: 'neutral',
    VERIFIED: 'success',
  },
  /** ADR-027 approval-policy version lifecycle (`ApprovalPolicyStatus`). */
  approvalPolicy: {
    DRAFT: 'neutral',
    IN_REVIEW: 'progress',
    SCHEDULED: 'progress',
    ACTIVE: 'success',
    SUPERSEDED: 'historical',
    RETIRED: 'historical',
  },
} as const satisfies Record<string, Record<string, StatusTone>>;

export type StatusVocabulary = keyof typeof STATUS_REGISTRY;

/**
 * Fallback for a status rendered without a vocabulary (legacy call sites) or a value a
 * vocabulary does not know yet. Chosen to agree with the vocabularies above wherever the
 * word means the same thing everywhere.
 */
const GENERIC: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  NOT_STARTED: 'neutral',
  NOT_RUN: 'neutral',
  PENDING: 'progress',
  SUBMITTED: 'progress',
  UNDER_REVIEW: 'progress',
  OPEN: 'progress',
  IN_PROGRESS: 'progress',
  PENDING_INTERNAL_APPROVAL: 'progress',
  PARTIALLY_PAID: 'progress',
  PARTIALLY_ORDERED: 'progress',
  MOBILIZING: 'progress',
  RETURNED: 'attention',
  RETURNED_FOR_REVISION: 'attention',
  EXCEPTION: 'attention',
  EXCEPTION_PENDING: 'attention',
  EXPIRING_SOON: 'attention',
  PENDING_SIGNATURE: 'attention',
  FINAL_ACCOUNT_PENDING: 'attention',
  PARTIALLY_CERTIFIED: 'attention',
  SUSPENDED: 'attention',
  UNPAID: 'attention',
  APPROVED: 'success',
  APPROVED_FOR_SUBMISSION: 'success',
  ACTIVE: 'success',
  POSTED: 'success',
  PAID: 'success',
  MATCHED: 'success',
  VERIFIED: 'success',
  CERTIFIED: 'success',
  COMPLETED: 'success',
  BASELINED: 'success',
  COMMITTED: 'success',
  EXECUTED: 'success',
  RELEASED: 'success',
  ISSUED: 'success',
  REJECTED: 'danger',
  FAILED: 'danger',
  OVERDUE: 'danger',
  DISPUTED: 'danger',
  EXPIRED: 'danger',
  TERMINATED: 'danger',
  CLOSED: 'historical',
  CANCELLED: 'historical',
  SUPERSEDED: 'historical',
  REVERSED: 'historical',
  WITHDRAWN: 'historical',
  ARCHIVED: 'historical',
  REPLACED: 'historical',
  INACTIVE: 'historical',
  // No vocabulary on purpose: ACCO does not use guarantees, so guarantee lifecycle and
  // attention words resolve here (ACTIVE, EXPIRED, EXPIRING_SOON) or fall to neutral.
};

/** Resolves a status to its tone. Unknown values fall back to `neutral`, never to a guess. */
export function statusTone(
  status: string | null | undefined,
  vocabulary?: StatusVocabulary,
): StatusTone {
  if (!status) return 'neutral';
  if (vocabulary) {
    const table = STATUS_REGISTRY[vocabulary] as Record<string, StatusTone>;
    const tone = table[status];
    if (tone) return tone;
  }
  return GENERIC[status] ?? 'neutral';
}

/** Display words that differ from the humanised enum value. */
const LABEL_OVERRIDES: Partial<Record<StatusVocabulary, Record<string, string>>> = {
  project: { DRAFT: 'Preparation' },
};

/**
 * The status word. Screens with translations pass their own label; this is the fallback so
 * a badge is readable before i18n keys exist: `PENDING_INTERNAL` → "Pending internal".
 */
export function statusLabel(status: string, vocabulary?: StatusVocabulary): string {
  const override = vocabulary ? LABEL_OVERRIDES[vocabulary]?.[status] : undefined;
  if (override) return override;
  const words = status.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

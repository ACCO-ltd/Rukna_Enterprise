import type {
  ContractStatus,
  BillingModel,
  AdvanceType,
  PaymentTrigger,
  DocumentCategory,
  DprStatus,
  ProgrammeMilestoneStatus,
  GuaranteeStatus,
  IpaStatus,
  IpcStatus,
  ClientStatus,
  BoqVersionStatus,
  MeasurementMethod,
  PricingBasis,
} from './enums.js';

// ADR-025: district registry — org-scoped reference data, the site segment of a project code.
export interface DistrictResponse {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDistrictInput {
  code: string;
  name: string;
}

export interface UpdateDistrictInput {
  name?: string;
  active?: boolean;
}

export interface ProjectWorkspaceSummaryResponse {
  projectId: string;
  setup: {
    identityComplete: boolean;
    boqExists: boolean;
    boqBaselined: boolean;
    mainContractApplicable: boolean;
    mainContractExists: boolean;
    teamReady: boolean;
    completedSteps: number;
    totalSteps: number;
  };
  responsibility: {
    projectManager: { id: string; name: string } | null;
    teamCount: number;
  };
  programme: {
    startDate: string | null;
    expectedEndDate: string | null;
    daysRemaining: number | null;
  };
  mainContract: {
    id: string;
    contractNumber: string;
    status: `${ContractStatus}`;
    startDate: string | null;
    expectedEndDate: string | null;
    contractValue: string | null;
    currency: string | null;
  } | null;
  financialsVisible: boolean;
  recentActivity: Array<{
    id: string;
    action: string;
    sourceCommand: string | null;
    occurredAt: string;
    actor: { id: string; name: string };
  }>;
}

export type ProjectWorkspaceGuidanceKind =
  | 'PROGRAMME_DATES_MISSING'
  | 'BOQ_BASELINE_REQUIRED'
  | 'MAIN_CONTRACT_BLOCKED'
  | 'MAIN_CONTRACT_REQUIRED'
  | 'DELIVERY_TEAM_INCOMPLETE';

export interface ProjectWorkspaceGuidanceItemResponse {
  id: string;
  severity: 'URGENT' | 'WARNING' | 'INFO';
  kind: ProjectWorkspaceGuidanceKind;
  actionUrl: string | null;
  responsibleRole: 'PROJECT_MANAGER' | 'QUANTITY_SURVEYOR' | 'CONTRACT_ADMINISTRATOR' | null;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export interface ClientContactResponse {
  id: string;
  clientId: string;
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  isPrimary: boolean;
}

export interface ClientResponse {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  taxNumber?: string;
  defaultCurrency?: string;
  status: ClientStatus;
  contacts: ClientContactResponse[];
  createdAt: string;
  updatedAt: string;
}

// ─── Contract sub-entities ────────────────────────────────────────────────────

export interface ContractRetentionTermsResponse {
  contractId: string;
  retentionRate: string;
  retentionCap: string;
  retentionSplitOnPC: string;
  retentionReleasedAt?: string;
}

export interface ContractAdvanceTermResponse {
  id: string;
  contractId: string;
  advanceType: AdvanceType;
  description?: string;
  amount?: string;
  percentage?: string;
  recoveryRate: string;
}

export interface ContractGuaranteeResponse {
  id: string;
  contractId: string;
  guaranteeType: string;
  /** The instrument's own reference, e.g. "BG-003". Absent on rows predating the column. */
  reference?: string;
  issuer: string;
  beneficiary: string;
  amount: string;
  currency: string;
  issueDate: string;
  expiryDate: string;
  status: GuaranteeStatus;
  notes?: string;
}

export interface ContractMilestoneResponse {
  id: string;
  contractId: string;
  name: string;
  description?: string;
  dueDate?: string;
  completedAt?: string;
  completedBy?: string;
  sortOrder: number;
  createdAt: string;
}

// ADR-023: one installment of a payment-schedule (MILESTONE) contract. `percentage` is a
// fraction string (0..1), e.g. "0.4000"; the amount is derived (percentage × contractValue).
export interface ContractPaymentInstallmentResponse {
  id: string;
  contractId: string;
  sortOrder: number;
  name: string;
  percentage: string;
  triggerType: PaymentTrigger;
  dueOffsetDays?: number;
  dueDate?: string;
  milestoneLabel?: string;
}

// Request shape the contract-creation form sends. `percentage` is a fraction number (0..1).
export interface PaymentInstallmentInput {
  sortOrder: number;
  name: string;
  percentage: number;
  triggerType: PaymentTrigger;
  dueOffsetDays?: number;
  dueDate?: string;
  milestoneLabel?: string;
}

// ADR-021/023: firewall-safe IPA pre-fill — suggested claim per BOQ leaf from verified progress.
export interface IpaPrefillLine {
  boqNodeId: string;
  code: string;
  description: string;
  measurableQuantity: string;
  verifiedToDate: string;
  previousEffectiveCertified: string;
  /** Suggested total-to-date claim (verified, clamped to [prev-certified, BOQ measurable]). */
  suggestedCumulativeClaim: string;
  /** Suggested this-period claim (cumulative − previously certified). */
  suggestedPeriodClaim: string;
}
export interface IpaPrefillResponse {
  contractId: string;
  projectId: string;
  source: 'VERIFIED_PROGRESS';
  suggestions: IpaPrefillLine[];
}

// ADR-021/023: physical-vs-financial early warning for the Finance/Overview cockpit.
export interface PhysicalFinancialSignalResponse {
  projectId: string;
  physicalPercent: number;
  actualCost: string;
  forecastCost: string;
  /** actualCost ÷ forecastCost × 100. Null when there is no forecast cost yet. */
  costConsumedPercent: number | null;
  /** physicalPercent − costConsumedPercent (positive = built ahead of spend). */
  divergence: number | null;
  status: 'ALIGNED' | 'COST_AHEAD' | 'PROGRESS_AHEAD' | 'INSUFFICIENT_DATA';
  /** From the roll-up: false when work-package weights don't total 100%. */
  weightsComplete: boolean;
}

// ADR-021/023: collection-vs-progress early warning — cash collected vs work built.
export interface CollectionProgressSignalResponse {
  projectId: string;
  physicalPercent: number;
  contractValue: string | null;
  receivedRevenue: string | null;
  /** receivedRevenue ÷ contractValue × 100. Null when there is no contract value yet. */
  collectedPercent: number | null;
  /** collectedPercent − physicalPercent (positive = cash ahead of work). */
  divergence: number | null;
  status: 'ALIGNED' | 'CASH_AHEAD' | 'WORK_AHEAD' | 'INSUFFICIENT_DATA';
  /** From the roll-up: false when work-package weights don't total 100%. */
  weightsComplete: boolean;
}

// ADR-021 CONST-PROG-007: work-package roll-up → weighted project physical %.
export interface WorkPackageRollupLine {
  id: string;
  code: string;
  name: string;
  responsibleOwner: string | null;
  /** Fraction of project weight (0..1). */
  weight: string;
  percentComplete: number;
  leafCount: number;
}
export interface ProjectRollupResponse {
  projectId: string;
  /** Weighted project physical % (0..100). Understated when weights are incomplete. */
  physicalPercent: number;
  weightsTotal: string;
  /** True when the package weights total 100%. */
  weightsComplete: boolean;
  packages: WorkPackageRollupLine[];
}

// ADR-021 Progress: a verified-progress line per BOQ leaf (from approved DPRs).
export interface ProjectProgressLine {
  boqNodeId: string;
  code: string;
  description: string;
  measurableQuantity: string;
  verifiedToDate: string;
  /** Whole percent (verified ÷ measurable), null when the BOQ line has no measurable quantity. */
  percentComplete: number | null;
}

export interface ProgressMeasurementResponse {
  id: string;
  dprId: string;
  boqNodeId: string;
  quantity: string;
  notes?: string;
}

export interface DailyProgressReportResponse {
  id: string;
  projectId: string;
  reportDate: string;
  status: `${DprStatus}`;
  weather?: string;
  labourCount?: number;
  equipmentNote?: string;
  narrative?: string;
  delayReason?: string;
  preparedBy: string;
  submittedBy?: string;
  approvedBy?: string;
}

// ADR-021 phase 2: a programme delivery milestone (baseline/forecast/actual dates, PLANNED -> VERIFIED).
export interface ProgrammeMilestoneResponse {
  id: string;
  projectId: string;
  code: string;
  name: string;
  status: `${ProgrammeMilestoneStatus}`;
  baselineDate: string;
  forecastDate: string | null;
  actualDate: string | null;
  sortOrder: number;
  contractMilestoneId: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

// Documents tab (ADR-014): a standalone project document + its stored-file metadata.
export interface ProjectDocumentResponse {
  id: string;
  projectId: string;
  platformFileId: string;
  category: `${DocumentCategory}`;
  title: string;
  uploadedBy: string;
  createdAt: string;
  platformFile: {
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    /** PlatformFileStatus: PENDING | READY. */
    status: string;
  };
}

export interface ContractResponse {
  id: string;
  organizationId: string;
  projectId: string;
  clientId: string;
  boqVersionId: string;
  contractNumber: string;
  contractValue: string;
  currency: string;
  billingModel: BillingModel;
  status: ContractStatus;
  startDate?: string;
  expectedEndDate?: string;
  clientNameSnapshot?: string;
  clientTaxSnapshot?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  retentionTerms?: ContractRetentionTermsResponse;
  advanceTerms: ContractAdvanceTermResponse[];
  guarantees: ContractGuaranteeResponse[];
  milestones: ContractMilestoneResponse[];
  paymentInstallments: ContractPaymentInstallmentResponse[];
}

// ─── IPA ──────────────────────────────────────────────────────────────────────

export interface IpaItemResponse {
  id: string;
  applicationId: string;
  boqNodeId: string;
  measurementMethodSnapshot: string;
  unitRateSnapshot: string;
  currencySnapshot: string;
  cumulativeClaimed: string;
  previousEffectiveCertified: string;
  periodQuantity: string;
  periodAmount: string;
}

export interface IpaDeductionResponse {
  id: string;
  applicationId: string;
  deductionType: string;
  sourceTermId?: string;
  rate?: string;
  basis: string;
  amount: string;
}

export interface IpaResponse {
  id: string;
  organizationId: string;
  contractId: string;
  status: IpaStatus;
  applicationNumber?: number;
  applicationRef?: string;
  periodFrom?: string;
  periodTo?: string;
  submittedAt?: string;
  submittedBy?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  items: IpaItemResponse[];
  deductions: IpaDeductionResponse[];
  // Server-computed — always present on GET /ipa/:id
  totalPeriodAmount: string;
  totalDeductions: string;
  netPayable: string;
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

export interface IpcItemResponse {
  id: string;
  certificateId: string;
  applicationItemId: string;
  certifiedQuantity: string;
  certifiedAmount: string;
  varianceQuantity: string;
  varianceReason?: string;
}

export interface IpcDeductionResponse {
  id: string;
  certificateId: string;
  deductionType: string;
  sourceTermId?: string;
  rate?: string;
  basis: string;
  amount: string;
}

export interface IpcResponse {
  id: string;
  organizationId: string;
  applicationId: string;
  certificateNumber: number;
  certificateRef?: string;
  status: IpcStatus;
  isEffective: boolean;
  effectiveAt?: string;
  certifiedTotal: string;
  currency: string;
  issuedAt?: string;
  issuedBy?: string;
  supersededAt?: string;
  supersededById?: string;
  supersessionReason?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  items: IpcItemResponse[];
  deductions: IpcDeductionResponse[];
  // Server-computed — always present on GET /ipc/:id
  totalCertifiedAmount: string;
  totalDeductions: string;
  netCertified: string;
}

// ─── Payment Status (derived — no status field stored on IPC) ─────────────────

export type IpcPaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export interface IpcPaymentStatusResponse {
  totalAllocated: string;
  netCertified: string;
  status: IpcPaymentStatus;
}

// ─── Finance ──────────────────────────────────────────────────────────────────

export interface ReceiptAllocationResponse {
  id: string;
  receiptId: string;
  certificateId: string;
  allocatedAmount: string;
  allocatedAt: string;
  allocatedBy: string;
}

export interface PaymentReceiptResponse {
  id: string;
  organizationId: string;
  clientId: string;
  receiptDate: string;
  amount: string;
  currency: string;
  reference?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  allocations: ReceiptAllocationResponse[];
}

// ─── BOQ (ADR-016) ────────────────────────────────────────────────────────────
//
// Closes B12. The web app used to hand-maintain these shapes in
// `apps/web/src/features/boq/types.ts` and `src/lib/api-types.ts`.
//
// Every quantity, rate and amount is a decimal **string** — CONST-BOQ-014. A JSON number
// cannot represent a rate exactly, and these values are multiplied and summed hundreds of
// times per BOQ.

export interface BoqVersionResponse {
  id: string;
  boqId: string;
  versionNumber: number;
  status: `${BoqVersionStatus}`;
  notes?: string;
  /** The baseline this revision was copied from. Null on the first version. */
  derivedFromVersionId?: string;
  preparedBy?: string;
  submittedBy?: string;
  submittedAt?: string;
  baselinedAt?: string;
  baselinedBy?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BoqResponse {
  id: string;
  projectId: string;
  organizationId: string;
  /** CONST-BOQ-013 — the BOQ's single unit of account. */
  currency: string;
  originalBaselineVersionId?: string;
  currentApprovedVersionId?: string;
  currentDraftVersionId?: string;
  createdAt: string;
  updatedAt: string;
  versions: BoqVersionResponse[];
}

export interface BoqTreeNodeResponse {
  id: string;
  boqId: string;
  versionId: string;
  parentId: string | null;
  path: string;
  depth: number;
  sortOrder: number;
  code: string;
  description: string;
  isLeaf: boolean;
  measurementMethod: `${MeasurementMethod}`;
  pricingBasis: `${PricingBasis}`;
  unit: string | null;
  quantity: string | null;
  unitRate: string | null;
  currency: string;
  totalAmount: string | null;
  originNodeId: string | null;
  sourceType: 'BASELINE' | 'VARIATION';
  sourceChangeOrderId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  children: BoqTreeNodeResponse[];

  // Server-computed — always present on GET …/tree
  /** Leaf: its own amount. Section: the sum of its descendants. Null when unpriced. */
  computedTotal: string | null;
}

export type BoqReadinessBlockerKind =
  | 'NO_BILLABLE_ITEMS'
  | 'DUPLICATE_CODE'
  | 'MISSING_UNIT'
  | 'MISSING_QUANTITY'
  | 'MISSING_RATE'
  | 'CURRENCY_MISMATCH'
  | 'STRUCTURE_INVALID'
  | 'VARIATION_REQUIRED';

export interface BoqReadinessBlocker {
  kind: BoqReadinessBlockerKind;
  /** Null for version-wide blockers such as an empty BOQ. */
  nodeId: string | null;
  code: string | null;
  description: string | null;
  message: string;
}

export interface BoqReadinessWarning {
  kind: 'ZERO_QUANTITY' | 'ZERO_RATE' | 'EMPTY_SECTION' | 'INACTIVE_ITEM';
  nodeId: string;
  code: string;
  message: string;
}

export interface BoqBaselineReadinessResponse {
  ready: boolean;
  sectionCount: number;
  itemCount: number;
  pricedItemCount: number;
  incompleteItemCount: number;
  duplicateCodeCount: number;
  totalAmount: string | null;
  currency: string;
  blockers: BoqReadinessBlocker[];
  warnings: BoqReadinessWarning[];
}

/** What the signed-in user may do here. Resolved server-side; the API stays the boundary. */
export interface BoqCapabilities {
  canView: boolean;
  canManage: boolean;
  canBaseline: boolean;
  /** False when rate and amount fields are omitted from this response. */
  canViewCommercials: boolean;
}

export interface BoqVersionSummary extends BoqVersionResponse {
  totalAmount: string | null;
  itemCount: number;
  /** True when Contract.boqVersionId points at this version. */
  isContractBaseline: boolean;
}

export interface BoqRevisionSummary {
  basedOnVersionId: string;
  basedOnVersionNumber: number;
  changedItemCount: number;
  /** Signed: positive is an increase against the baseline it derives from. */
  netDelta: string | null;
}

/**
 * The BOQ workspace read model — one query instead of the four the screen used to stitch
 * together. Deliberately deep: pricing completeness, readiness and the contract reference
 * are business judgements, and the frontend must render them rather than re-derive them.
 */
export interface BoqWorkspaceResponse {
  projectId: string;
  boq: BoqResponse | null;
  currency: string;
  /** The editable version, if one is open. */
  draft: BoqVersionSummary | null;
  /** The current approved baseline. */
  approved: BoqVersionSummary | null;
  /** The version the main contract references — may be older than `approved`. */
  contractBaseline: BoqVersionSummary | null;
  versions: BoqVersionSummary[];
  /** Readiness of the draft, or of the approved version when there is no draft. */
  readiness: BoqBaselineReadinessResponse | null;
  revision: BoqRevisionSummary | null;
  capabilities: BoqCapabilities;
}

// ─── Commercial workspace read models (ADR-017, Gate B) ─────────────────────────
//
// Backend-owned response contracts for the Commercial workspace. The frontend consumes
// these and MUST NOT rebuild any financial policy (CONST-COM-004/007) or lifecycle table
// (CONST-COM-001) client-side. Every monetary value is a decimal string.

/**
 * A financial figure is never a bare number. It carries provenance and a state so the UI can
 * tell apart a genuine zero, data the user may not see, data that could not be loaded, and
 * data that does not exist yet.
 */
export type CommercialMetricState = 'OK' | 'ZERO' | 'UNAVAILABLE' | 'RESTRICTED' | 'FAILED';

export interface CommercialMetric {
  state: CommercialMetricState;
  /** Present only when state is OK or ZERO. */
  amount: string | null;
  currency: string | null;
  /** How many source records back this figure (invoices, certificates, allocations). */
  sourceCount: number;
  /** Route the UI can navigate to for the breakdown, or null. */
  drillTo: string | null;
  /** ISO timestamp the figure was computed as-of, or null. */
  asOf: string | null;
}

export type GuaranteeAttentionState = 'NONE' | 'EXPIRING_SOON' | 'EXPIRED';

export interface CommercialGuaranteeSummary {
  id: string;
  guaranteeType: string;
  reference: string | null;
  issuer: string;
  beneficiary: string;
  amount: string;
  currency: string;
  issueDate: string;
  expiryDate: string;
  /** Stored legal lifecycle. */
  status: `${GuaranteeStatus}`;
  /** Backend-derived from the expiry date against the server clock (A7). */
  attention: GuaranteeAttentionState;
}

/** What the signed-in user may do in the Commercial workspace. Backend commands still enforce. */
export interface CommercialCapabilities {
  canViewFinancials: boolean;
  canEditContract: boolean;
  canAdvanceContract: boolean;
  canCreateApplication: boolean;
  canManageApplication: boolean;
  canReviewApplication: boolean;
  canIssueCertificate: boolean;
  canGenerateInvoice: boolean;
  canPostInvoice: boolean;
  canManageGuarantee: boolean;
  canRecordReceipt: boolean;
  canAllocateReceipt: boolean;
}

export type CommercialAttentionKind =
  | 'NO_MAIN_CONTRACT'
  | 'GUARANTEE_EXPIRING'
  | 'GUARANTEE_EXPIRED'
  | 'UNINVOICED_CERTIFICATE'
  | 'RECONCILIATION_FAILED';

export interface CommercialAttentionItem {
  id: string;
  severity: 'URGENT' | 'WARNING' | 'INFO';
  kind: CommercialAttentionKind;
  actionUrl: string | null;
  responsibleRole: string | null;
  /** Id of the entity the item concerns (guarantee, certificate…), or null. */
  contextId: string | null;
}

export interface CommercialContractSummary {
  id: string;
  contractNumber: string;
  status: `${ContractStatus}`;
  clientName: string;
  startDate: string | null;
  expectedEndDate: string | null;
  /** Withheld (null) without financial visibility, exactly as the metrics are. */
  contractValue: string | null;
  currency: string;
  billingModel: `${BillingModel}`;
  /** The baselined BOQ version this contract is measured against. */
  boqVersionNumber: number | null;
}

/**
 * The certification chain, as counts.
 *
 * Three numbers rather than a funnel chart: a surveyor reads "9 applications → 8 effective
 * certificates → 7 posted invoices" and immediately knows one application is uncertified and
 * one certificate is uninvoiced. Counts are visible without financial permission — how many
 * documents exist is not a commercial secret; what they are worth is.
 */
export interface CommercialCertificationSummary {
  applicationsSubmitted: number;
  effectiveCertificates: number;
  postedInvoices: number;
}

export interface CommercialOutstandingInvoice {
  id: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  outstandingAmount: string;
  currency: string;
  /**
   * Positive when past due, computed against the **server** clock.
   *
   * Whether an invoice is overdue is a commercial fact, not a rendering choice — a browser
   * with a wrong clock must not be able to decide it. Same reasoning as
   * `guarantee-attention-policy.ts` for expiry.
   */
  daysOverdue: number;
}

export interface CommercialReceivablesSummary {
  /** received ÷ invoiced, as a whole percent. Null when nothing is invoiced yet. */
  collectionRate: number | null;
  /** Posted invoices still carrying a balance, soonest due first. Capped server-side. */
  outstandingInvoices: CommercialOutstandingInvoice[];
}

export interface CommercialRetentionSummary {
  retentionRate: string;
  retentionCap: string;
  retentionSplitOnPC: string;
}

export interface CommercialAdvanceSummary {
  id: string;
  advanceType: `${AdvanceType}`;
  description: string | null;
  amount: string | null;
  percentage: string | null;
  recoveryRate: string;
}

export interface CommercialActivityItem {
  id: string;
  action: string;
  sourceCommand: string | null;
  occurredAt: string;
  actor: { id: string; name: string };
}

export interface CommercialSummaryResponse {
  projectId: string;
  currency: string | null;
  financialsVisible: boolean;
  mainContract: CommercialContractSummary | null;
  metrics: {
    contractValue: CommercialMetric;
    certifiedGross: CommercialMetric;
    certifiedNet: CommercialMetric;
    invoiced: CommercialMetric;
    received: CommercialMetric;
    outstanding: CommercialMetric;
    /**
     * Certified net on effective certificates with no posted invoice — work that has been
     * agreed and is not yet asking to be paid for. The one figure that is nobody's job by
     * default, which is why it earns a place beside the settlement chain.
     */
    uninvoicedCertified: CommercialMetric;
  };
  certification: CommercialCertificationSummary;
  receivables: CommercialReceivablesSummary;
  /** Read-first contractual terms only — no held/released/recovered values (Gate C C5). */
  retention: CommercialRetentionSummary | null;
  advances: CommercialAdvanceSummary[];
  guarantees: CommercialGuaranteeSummary[];
  attention: CommercialAttentionItem[];
  capabilities: CommercialCapabilities;
  recentActivity: CommercialActivityItem[];
  asOf: string;
}

// ─── Applications & Certificates chain (B3) ─────────────────────────────────────

export type CommercialSettlementState = 'UNINVOICED' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export type CommercialNextAction =
  | 'SUBMIT_APPLICATION'
  | 'REVIEW_APPLICATION'
  | 'ISSUE_CERTIFICATE'
  | 'GENERATE_INVOICE'
  | 'POST_INVOICE'
  | 'RECORD_RECEIPT'
  | 'NONE';

export interface CommercialApplicationRow {
  ipaId: string;
  applicationNumber: number | null;
  applicationRef: string | null;
  ipaStatus: `${IpaStatus}`;
  periodFrom: string | null;
  periodTo: string | null;
  /** Null when the caller may not see financials. */
  claimedAmount: string | null;
  // Effective certificate (CONST-COM-003)
  ipcId: string | null;
  ipcStatus: `${IpcStatus}` | null;
  certifiedGross: string | null;
  deductions: string | null;
  certifiedNet: string | null;
  supersededCertificateCount: number;
  // Client invoice (AR-owned)
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceDocumentStatus: string | null;
  invoicePostingStatus: string | null;
  invoicedAmount: string | null;
  // Settlement (AR-owned — CONST-COM-004)
  receivedAmount: string | null;
  outstandingAmount: string | null;
  settlement: CommercialSettlementState;
  nextAction: CommercialNextAction;
}

export interface CommercialApplicationsResponse {
  projectId: string;
  contractId: string | null;
  financialsVisible: boolean;
  applications: CommercialApplicationRow[];
  capabilities: CommercialCapabilities;
  asOf: string;
}

export type CommercialCycleStage =
  | 'NO_CONTRACT'
  | 'CONTRACT_DRAFT'
  | 'READY_FOR_APPLICATION'
  | 'APPLICATION_DRAFT'
  | 'APPLICATION_SUBMITTED'
  | 'APPLICATION_RETURNED'
  | 'AWAITING_CERTIFICATION'
  | 'CERTIFIED'
  | 'AWAITING_INVOICE'
  | 'INVOICE_DRAFT'
  | 'AWAITING_PAYMENT'
  | 'PARTIALLY_PAID'
  | 'SETTLED'
  // ADR-023: a MILESTONE (payment-schedule) contract's cycle is its payment plan, not the IPA chain.
  | 'MILESTONE_SCHEDULE'
  | 'TERMINAL';

// ADR-023: per-installment billing status, derived from the installment's own linked invoice
// (sourceInstallmentId). NEXT is the first un-invoiced installment (where "Generate invoice" lives);
// UPCOMING are the later un-invoiced ones; BILLED means an invoice exists but nothing is collected
// yet; PARTIALLY_PAID / PAID reflect posted receipts against that invoice.
export type PaymentInstallmentBillStatus =
  | 'PAID'
  | 'PARTIALLY_PAID'
  | 'BILLED'
  | 'NEXT'
  | 'UPCOMING';

export interface CommercialPaymentScheduleInstallment {
  id: string;
  sortOrder: number;
  name: string;
  /** Fraction string, e.g. "0.4000". Structural — always visible. */
  percentage: string;
  /** Derived: percentage × contract value. Null when the caller cannot view financials. */
  amount: string | null;
  /** Waterfalled from total collected. Null when the caller cannot view financials. */
  amountPaid: string | null;
  triggerType: `${PaymentTrigger}`;
  milestoneLabel: string | null;
  dueOffsetDays: number | null;
  dueDate: string | null;
  status: PaymentInstallmentBillStatus;
  /**
   * CONST-COM-011: the programme milestone this installment's billing is gated on, or null when
   * unlinked. When present and not `VERIFIED`, "Generate invoice" must be blocked in the UI (the
   * API enforces the same gate).
   */
  programmeMilestone: PaymentInstallmentMilestoneLink | null;
}

/** A programme milestone linked to a payment installment (CONST-COM-011 evidence gate). */
export interface PaymentInstallmentMilestoneLink {
  id: string;
  code: string;
  name: string;
  status: `${ProgrammeMilestoneStatus}`;
}

export interface CommercialPaymentSchedule {
  currency: string;
  /** Null when the caller cannot view financials. */
  contractValue: string | null;
  /** Null when the caller cannot view financials. */
  totalCollected: string | null;
  installments: CommercialPaymentScheduleInstallment[];
}

export type CommercialCycleAction =
  | 'CREATE_CONTRACT'
  | 'EDIT_CONTRACT'
  | 'ADVANCE_CONTRACT'
  | 'CREATE_APPLICATION'
  | 'CONTINUE_APPLICATION'
  | 'SUBMIT_APPLICATION'
  | 'REVISE_APPLICATION'
  | 'REVIEW_APPLICATION'
  | 'ISSUE_CERTIFICATE'
  | 'GENERATE_INVOICE'
  | 'POST_INVOICE'
  | 'RECORD_RECEIPT'
  | 'ALLOCATE_RECEIPT'
  | 'VIEW_HISTORY';

export type CommercialCycleBlocker =
  | 'MAIN_CONTRACT_MISSING'
  | 'CONTRACT_NOT_ACTIVE'
  | 'CONTRACT_TERMINAL'
  | 'APPLICATION_AWAITING_APPROVAL'
  | 'CERTIFICATE_MISSING'
  | 'INVOICE_NOT_POSTED'
  | 'RECEIPT_WORKFLOW_UNAVAILABLE'
  | 'PERMISSION_REQUIRED';

export interface CommercialCurrentCycleResponse {
  projectId: string;
  contract: {
    id: string;
    contractNumber: string;
    status: `${ContractStatus}`;
    clientId: string;
    clientName: string;
  } | null;
  stage: CommercialCycleStage;
  application: CommercialApplicationRow | null;
  /** ADR-023: present when the contract's billingModel is MILESTONE (stage === 'MILESTONE_SCHEDULE'). */
  paymentSchedule?: CommercialPaymentSchedule | null;
  nextAction: {
    kind: CommercialCycleAction;
    href: string;
  } | null;
  blockers: CommercialCycleBlocker[];
  capabilities: CommercialCapabilities;
  responsibleRole:
    | 'PROJECT_MANAGER'
    | 'QUANTITY_SURVEYOR'
    | 'SITE_ENGINEER'
    | 'COMMERCIAL_MANAGER'
    | 'FINANCE_REVIEWER'
    | 'VIEWER'
    | 'CONTRACT_ADMINISTRATOR'
    | null;
  asOf: string;
}

// ─── Project Financial Position (ADR-013) ───────────────────────────────────────

/**
 * The PM/control view of a project's money: posted actuals **and** remaining committed cost, so
 * forecast margin is honest. Distinct from the Project Actual P&L (posted GL only) — commitments
 * never enter the accounting P&L. All amounts are decimal strings in the contract currency.
 *
 * Cost figures are always present (they do not need a contract). Contract-derived figures
 * (`contractValue`, revenue, `forecastMargin`) are null when the project has no main contract.
 */
export interface ProjectFinancialPositionResponse {
  projectId: string;
  currency: string | null;
  hasContract: boolean;
  contractValue: string | null;
  certifiedRevenue: string | null;
  invoicedRevenue: string | null;
  receivedRevenue: string | null;
  outstandingReceivables: string | null;
  /** Posted GL cost attributed to the project (COST_OF_SALES + EXPENSE), project-to-date. */
  actualCost: string;
  /** Commitment ledger COMMITTED + ACCRUED — open commitments not yet posted to the GL. */
  remainingCommitments: string;
  /** actualCost + remainingCommitments. */
  forecastCost: string;
  /** contractValue − forecastCost. Null without a contract. */
  forecastMargin: string | null;
  asOf: string;
}

export type BoqChangeKind =
  | 'ADDED'
  | 'REMOVED'
  | 'DESCRIPTION_CHANGED'
  | 'QUANTITY_CHANGED'
  | 'RATE_CHANGED'
  | 'AMOUNT_CHANGED'
  | 'MOVED'
  | 'VARIATION_ORIGINATED';

export interface BoqNodeChange {
  kinds: BoqChangeKind[];
  /** Node id in the left (older) version. Null when the node was added. */
  leftNodeId: string | null;
  /** Node id in the right (newer) version. Null when the node was removed. */
  rightNodeId: string | null;
  code: string;
  description: string;
  isLeaf: boolean;
  oldQuantity: string | null;
  newQuantity: string | null;
  oldUnitRate: string | null;
  newUnitRate: string | null;
  oldAmount: string | null;
  newAmount: string | null;
  /** newAmount − oldAmount. Null when neither side has an amount. */
  amountDelta: string | null;
  /** Percentage change against the old amount. Null when the old amount is absent or zero. */
  amountDeltaPercent: string | null;
}

export interface BoqCompareResponse {
  leftVersionId: string;
  leftVersionNumber: number;
  rightVersionId: string;
  rightVersionNumber: number;
  currency: string;
  leftTotal: string | null;
  rightTotal: string | null;
  netDelta: string | null;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  changes: BoqNodeChange[];
}

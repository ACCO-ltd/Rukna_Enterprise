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
  VariationOrderStatus,
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

// ── ADR-019 Phase B (CONST-PLC-005/009): queryable project-lifecycle readiness ──
// The forward guarded commands (+ cancel) a project can be evaluated for readiness against.
export type ProjectLifecycleCommand =
  | 'start'
  | 'practical-completion'
  | 'closeout'
  | 'close'
  | 'cancel';

// CONST-PLC-006 — a condition is MANDATORY (transition impossible until satisfied) or WAIVABLE
// (blocked by default; an authorized, audited override unblocks the specific condition). B1
// reports both truthfully; B2 acts on the severity.
export type ReadinessConditionSeverity = 'MANDATORY' | 'WAIVABLE';

export interface ProjectReadinessConditionResponse {
  code: string;
  severity: ReadinessConditionSeverity;
  satisfied: boolean;
  detail: string;
}

export interface ProjectReadinessResponse {
  command: ProjectLifecycleCommand;
  targetStatus: string;
  ready: boolean;
  conditions: ProjectReadinessConditionResponse[];
  // Conditions the ADR names for this command whose source domain is not yet queryable from the
  // project (e.g. final-account / commitments / inventory / retention on close). Listed by code
  // so the contract is self-documenting rather than silently omitting them.
  deferred: string[];
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

// ─── Progress over time (Round-2 BE-1): snapshots + provisional planned baseline ──
//
// A ProgressSnapshot freezes what ADR-021 already computes (weighted physical roll-up,
// verified-to-date, cost-consumed from the physical-vs-financial signal) at a point in time.
// It is immutable once written (progress may be restated via a DPR reopen — ADR-021
// CONST-PROG-010 — so the snapshot is the auditable "as reported" record, never recomputed).

/** How a snapshot was captured. MANUAL = on-demand; PERIOD_CLOSE = month-end hook (BE-2 seam). */
export type ProgressSnapshotSourceType = 'MANUAL' | 'PERIOD_CLOSE';

/** An immutable frozen progress reading for one project at one period-end date. */
export interface ProgressSnapshotResponse {
  id: string;
  projectId: string;
  /** The "as of" date this reading is reported against (accounting-date style). */
  periodEndDate: string;
  accountingPeriodId: string | null;
  physicalPercent: number;
  verifiedPercent: number;
  /** From the physical-vs-financial signal; null when there is no cost data. */
  costConsumedPercent: number | null;
  source: ProgressSnapshotSourceType;
  capturedAt: string;
  capturedById: string;
}

/** Schedule status derived from the latest actual vs the planned baseline at that date. */
export type ProgressScheduleStatus = 'AHEAD' | 'ON_TRACK' | 'BEHIND' | 'INSUFFICIENT_DATA';

/** One point on the planned baseline curve. */
export interface ProgressCurvePoint {
  periodEndDate: string;
  plannedPercent: number;
}

/** One actual reading (from a snapshot) on the progress curve. */
export interface ProgressActualPoint {
  periodEndDate: string;
  physicalPercent: number;
  verifiedPercent: number;
  /** Null when the snapshot had no cost data. */
  costPercent: number | null;
}

/**
 * The planned-vs-actual S-curve read model. `baseline` is provisional (Option-C: a linear ramp
 * from Project.startDate → expectedEndDate) for BE-1; the real Option-A/B baseline lands in BE-2
 * without changing this contract. `status`/`scheduleVariancePercent` compare the latest actual
 * physical % to the planned % at that date.
 */
export interface ProgressCurveResponse {
  projectId: string;
  baseline: ProgressCurvePoint[];
  actual: ProgressActualPoint[];
  /** latest actual physical − planned at that date; null when there is insufficient data. */
  scheduleVariancePercent: number | null;
  status: ProgressScheduleStatus;
  /** True while the baseline is the Option-C provisional placeholder (BE-1). */
  baselineProvisional: boolean;
}

/** Overall (project-level) period-over-period comparison from the two most-recent snapshots. */
export interface ProgressPeriodComparisonResponse {
  projectId: string;
  previousPeriodEndDate: string | null;
  currentPeriodEndDate: string | null;
  /** Null when fewer than two snapshots exist. */
  physical: { previous: number; current: number; delta: number } | null;
  verified: { previous: number; current: number; delta: number } | null;
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
  /** The preparer's "firstName lastName", resolved read-side from preparedBy; undefined if the user is not found. */
  preparedByName?: string;
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
//
// ADR-024 ACC-SET-001 (D2): settlement is measured against the VAT-inclusive ClientInvoice
// total, never the pre-VAT netCertified. Every figure is reported separately so no two tax
// bases are ever compared. UNINVOICED distinguishes "certified but not yet billed" from
// "billed and unpaid" (matches CommercialSettlementState).

export type IpcPaymentStatus = 'UNINVOICED' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export interface IpcPaymentStatusResponse {
  /** Pre-VAT: certified items − deductions. */
  netCertified: string;
  /** VAT on the invoice; '0.00' when not invoiced. */
  vatAmount: string;
  /** VAT-inclusive invoice total; null when the IPC has no live invoice. */
  invoiceTotal: string | null;
  /** Σ posted receipt allocations against the invoice (VAT-inclusive cash). */
  totalReceived: string;
  /** invoiceTotal − totalReceived (≥ 0); null when not invoiced. */
  outstanding: string | null;
  /** totalReceived / invoiceTotal × 100; '0' when not invoiced. */
  paidPercent: string;
  status: IpcPaymentStatus;
  /**
   * @deprecated ACC-SET-001 — alias of `totalReceived`, kept for the current settlement panel.
   * Removed with FE-1.
   */
  totalAllocated: string;
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

// ─── BOQ import (ADR-016, Phase 2) ──────────────────────────────────────────────
//
// Bulk entry. The browser parses the spreadsheet (SheetJS), the user maps columns, and
// posts the mapped rows here — the API never receives a file. The server rebuilds the tree
// from the dotted codes, validates every row, and either creates the whole BOQ in one
// transaction or rejects the import untouched (all-or-nothing). Decimals stay strings
// (CONST-BOQ-014).

/** How an import lands against a DRAFT that already holds nodes. */
export type BoqImportMode = 'REPLACE' | 'APPEND';

/**
 * One already-mapped spreadsheet row. The browser has applied the column mapping, so these
 * are the BOQ's own field names, not the sheet's headers. `rowNumber` is the 1-based line in
 * the source sheet, echoed back in any finding so the user can locate the offending row.
 * `sheetAmount` is the sheet's own total column when present — never stored (the amount is
 * always recomputed as quantity × unitRate), only used to flag a mis-mapped column.
 */
export interface BoqImportRow {
  rowNumber: number;
  code: string;
  description: string;
  unit?: string | null;
  quantity?: string | null;
  unitRate?: string | null;
  sheetAmount?: string | null;
}

export interface BoqImportRequest {
  mode: BoqImportMode;
  /** Opt-in (Q7): also upsert each imported leaf into the item library. */
  addToLibrary: boolean;
  rows: BoqImportRow[];
}

/** Findings that block the import — nothing is created while any of these stand. */
export type BoqImportViolationCode =
  | 'MISSING_CODE'
  | 'MISSING_DESCRIPTION'
  | 'INVALID_CODE'
  | 'DUPLICATE_CODE'
  | 'NON_NUMERIC_QUANTITY'
  | 'NON_NUMERIC_RATE'
  | 'NEGATIVE_QUANTITY'
  | 'NEGATIVE_RATE'
  | 'QUANTITY_SCALE'
  | 'RATE_SCALE'
  | 'MAX_DEPTH_EXCEEDED'
  | 'TOO_MANY_ROWS';

export interface BoqImportViolation {
  code: BoqImportViolationCode;
  /** 1-based sheet row, or null for whole-import findings (e.g. TOO_MANY_ROWS). */
  rowNumber: number | null;
  /** The offending node code, when the finding is about one. */
  nodeCode: string | null;
  message: string;
}

/** Findings that inform but do not block — the import proceeds with these surfaced. */
export type BoqImportWarningCode =
  | 'SECTION_CARRIES_PRICING'
  | 'UNKNOWN_UNIT'
  | 'UNPRICED_ITEM'
  | 'AUTO_CREATED_SECTION'
  | 'AMOUNT_MISMATCH';

export interface BoqImportWarning {
  code: BoqImportWarningCode;
  rowNumber: number | null;
  nodeCode: string | null;
  message: string;
}

/** Returned by a successful commit (Slice 2). */
export interface BoqImportResult {
  versionId: string;
  versionNumber: number;
  mode: BoqImportMode;
  createdSectionCount: number;
  createdItemCount: number;
  /** Ancestor sections synthesised from the codes because the sheet omitted them. */
  autoCreatedSectionCount: number;
  addedToLibraryCount: number;
  warnings: BoqImportWarning[];
}

/** One node as the preview will render it — a dry-run of the same planner the commit runs. */
export interface BoqImportPreviewNode {
  code: string;
  /** null for a root; otherwise the parent's code (a planned node or an existing one). */
  parentCode: string | null;
  description: string;
  isLeaf: boolean;
  depth: number;
  unit: string | null;
  quantity: string | null;
  unitRate: string | null;
  totalAmount: string | null;
  autoCreated: boolean;
}

/** What an import would create, plus every finding — computed without committing anything. */
export interface BoqImportPreview {
  ok: boolean;
  mode: BoqImportMode;
  sectionCount: number;
  itemCount: number;
  autoCreatedSectionCount: number;
  nodes: BoqImportPreviewNode[];
  violations: BoqImportViolation[];
  warnings: BoqImportWarning[];
}

// ─── BOQ change history (BOQ refinement Phase 1) ─────────────────────────────────

export type BoqChangeAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'MOVE' | 'IMPORT';

/**
 * One entry in a BOQ's change log — "who changed what, and what was it before". For a value edit,
 * `field` / `oldValue` / `newValue` are set (e.g. field `unitRate`, `80.00` → `85.00`); structural
 * events (add / delete / move) and imports carry a human `detail` instead. `nodeId` / `code` are
 * null on a version-wide event such as an import.
 */
export interface BoqChangeEventResponse {
  id: string;
  versionId: string;
  nodeId: string | null;
  code: string | null;
  action: BoqChangeAction;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  detail: string | null;
  actorUserId: string;
  /** Resolved "First Last" for display; null if the user can't be found. */
  actorName: string | null;
  createdAt: string;
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

/**
 * ADR-026 CONST-VAR-005/-006/-006a — the derived contract-value figures. `Contract.contractValue`
 * (the executed baseline) is NEVER mutated; these are all computed from the VariationOrder set.
 *
 *   governing = original + Σ (net of CLIENT_APPROVED variations)
 *   pending   = Σ (net of PENDING_INTERNAL + INTERNAL_APPROVED variations)   — reported, never folded in
 *
 * Values are money strings, or null without financial visibility (same posture as the metrics).
 * `pending` is management information (CONST-VAR-006a) — never added into `governing`.
 */
export interface CommercialContractValue {
  originalContractValue: string | null;
  approvedVariationsTotal: string | null;
  governingContractValue: string | null;
  pendingVariations: string | null;
}

/**
 * Retention held and advance recovered to date.
 *
 * Both are sums over the deductions on **effective** certificates, categorised the same way the
 * IPC calculation policy categorises them (`RETENTION` / `ADVANCE_RECOVERY`). `applicable` is
 * false when the contract's billing model cannot produce either — the caller must render that as
 * "not applicable", never as zero.
 */
export interface CommercialSecurityPosition {
  applicable: boolean;
  /** Decimal string. Null when not applicable, or without financial visibility. */
  retentionHeld: string | null;
  /** Decimal string. Null when not applicable, or without financial visibility. */
  advanceRecovered: string | null;
  /**
   * Advance still to recover: the advance terms' total value less `advanceRecovered`. Null when
   * the contract has no advance term carrying an explicit amount — a percentage-only term has no
   * principal to count down from until one is derived, and guessing it would be a fabrication.
   */
  advanceOutstanding: string | null;
}

export interface CommercialSummaryResponse {
  projectId: string;
  currency: string | null;
  financialsVisible: boolean;
  mainContract: CommercialContractSummary | null;
  // ADR-026: derived Original / Approved / Governing / Pending contract value. Null when there is
  // no main contract.
  contractValue: CommercialContractValue | null;
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
  /** The negotiated contractual terms. The balances they produce are `securityPosition`. */
  retention: CommercialRetentionSummary | null;
  advances: CommercialAdvanceSummary[];
  /**
   * What the terms above have actually produced to date, derived from the deductions on
   * effective certificates (the only place either is recorded). Both are null for a MILESTONE
   * contract — ADR-023 CONST-COM-013/014: a payment-schedule contract deducts neither, so a
   * zero would answer a question that does not apply.
   */
  securityPosition: CommercialSecurityPosition;
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

// ─── Billing & Collection (project-scoped AR position) ──────────────────────────
//
// The client-facing money-in view for one project's main contract: what has been invoiced,
// what has been collected against those invoices, and what is still owed. Every figure is on
// the **invoice-total basis** (VAT-inclusive) — settlement is measured against what the client
// was actually asked to pay, never against a pre-VAT certified or plan amount. `subtotal` and
// `vatAmount` are carried alongside so a screen that shows both can label the basis.

/**
 * Mirrors the AR `InvoiceDocStatus` / `PostingStatus` Prisma enums. Declared here rather than
 * imported from `./enums.js` because those are accounting enums and `@erp/types` does not yet
 * publish them; the commercial workspace only ever reads them.
 */
export type ClientInvoiceDocStatus = 'DRAFT' | 'APPROVED' | 'CANCELLED';

export type ArPostingStatus =
  | 'NOT_POSTED'
  | 'PENDING'
  | 'POSTED'
  | 'FAILED'
  | 'REVERSED'
  | 'OPENING_BALANCE';

/** Where a client invoice came from. `NONE` = a migration-loaded invoice with no source document. */
export type ClientInvoiceSourceKind = 'INSTALLMENT' | 'IPC' | 'NONE';

export interface ClientInvoiceSource {
  kind: ClientInvoiceSourceKind;
  /** The source document's human reference — the installment name, or the IPA ref behind the IPC. */
  label: string | null;
  /** The source record's id, for a drill-through. Null for `NONE`. */
  id: string | null;
}

/**
 * How an invoice stands with the client. Derived server-side from the document's own lifecycle
 * plus its allocated receipts — never re-derived in the browser.
 *
 * `DRAFT` and `CANCELLED` mirror `documentStatus`; `AWAITING_POSTING` is an approved invoice the
 * GL has not taken yet (a real commercial claim, not yet an accounting fact). The three
 * settlement states apply only once the invoice is POSTED.
 */
export type ClientInvoiceSettlementStatus =
  | 'DRAFT'
  | 'AWAITING_POSTING'
  | 'UNPAID'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED';

export interface CommercialInvoiceRow {
  id: string;
  invoiceNumber: string | null;
  source: ClientInvoiceSource;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  /** Pre-VAT. Null without financial visibility. */
  subtotal: string | null;
  /** Null without financial visibility. */
  vatAmount: string | null;
  /** VAT-inclusive — the settlement basis. Null without financial visibility. */
  totalAmount: string | null;
  /** Sum of posted allocations against this invoice. Null without financial visibility. */
  paidAmount: string | null;
  /** AR-maintained balance. Null without financial visibility. */
  outstandingAmount: string | null;
  documentStatus: ClientInvoiceDocStatus;
  postingStatus: ArPostingStatus;
  status: ClientInvoiceSettlementStatus;
  /**
   * Whole UTC days past `dueDate`, measured against the **server** clock, and 0 when not yet due
   * or already settled. Whether a client is late is a commercial fact with consequences; a
   * browser with a skewed clock does not get a vote.
   */
  daysOverdue: number;
}

/** One receipt's allocation against one of this contract's invoices. */
export interface CommercialReceiptAllocationRow {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  allocatedAmount: string | null;
  allocationDate: string;
}

/**
 * A client payment that has landed against this contract.
 *
 * `PaymentReceipt` is client-scoped, not project-scoped — a receipt is money from a client, and
 * only its allocations tie it to a particular contract. This list is therefore exactly "receipts
 * with at least one posted allocation against an invoice of this contract". `unallocatedAmount`
 * is the receipt's own client-level unapplied balance, not a project figure; it is reported so
 * unapplied cash is never hidden, and labelled as client-level wherever it is shown.
 */
export interface CommercialReceiptRow {
  id: string;
  receiptDate: string;
  currency: string;
  totalAmount: string | null;
  allocatedAmount: string | null;
  unallocatedAmount: string | null;
  /** Sum of this receipt's posted allocations against *this contract's* invoices. */
  allocatedToThisContract: string | null;
  paymentMethod: string | null;
  reference: string | null;
  postingStatus: ArPostingStatus;
  allocations: CommercialReceiptAllocationRow[];
}

/** One ageing bucket over posted invoices still carrying a balance. */
export interface CommercialAgingBucket {
  bucket: 'NOT_DUE' | 'DAYS_1_30' | 'DAYS_31_60' | 'DAYS_61_90' | 'DAYS_90_PLUS';
  amount: string | null;
  invoiceCount: number;
}

/**
 * The project's billing position. All four figures are on the invoice-total basis and count
 * **posted** invoices only — a draft invoice is not yet a claim on the client.
 */
export interface CommercialBillingPosition {
  invoiced: string | null;
  collected: string | null;
  outstanding: string | null;
  /** Outstanding on posted invoices whose due date has passed. */
  overdue: string | null;
  postedInvoiceCount: number;
  overdueInvoiceCount: number;
  /** Collected over invoiced as a whole percent, or null when nothing has been invoiced. */
  collectionRate: number | null;
}

export interface CommercialBillingResponse {
  projectId: string;
  contractId: string | null;
  currency: string | null;
  billingModel: `${BillingModel}` | null;
  financialsVisible: boolean;
  position: CommercialBillingPosition;
  invoices: CommercialInvoiceRow[];
  receipts: CommercialReceiptRow[];
  /**
   * Unapplied cash on this client's posted receipts. **Client-level, not project-level** — an
   * unallocated receipt has not been attributed to any contract yet, which is precisely why it
   * needs allocating. Null without financial visibility.
   */
  clientUnappliedTotal: string | null;
  aging: CommercialAgingBucket[];
  capabilities: CommercialCapabilities;
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

// ─── Variations & Change Orders (ADR-026, Phase 1) ──────────────────────────────

/**
 * ADR-026 CONST-VAR-002 — a signed line of changed scope. A negative `amount` (from a negative
 * quantity) is an OMISSION. Free-text for Phase 1 (no BOQ node link yet — that is Phase 2).
 */
export interface VariationOrderLineResponse {
  id: string;
  description: string;
  /** May be negative to express an omission. */
  quantity: string;
  unitRate: string;
  /** Signed line amount = quantity × unitRate. Negative for an omission. */
  amount: string;
  sortOrder: number;
}

/**
 * ADR-026 CONST-VAR-001 — a VariationOrder: a first-class change document owned by one Contract.
 * `netPrice` is derived from the lines (Σ amount) and may be negative; it is the proposed net
 * (CONST-VAR-003) until CLIENT_APPROVED, at which point the figures freeze (CONST-VAR-010).
 */
export interface VariationOrderResponse {
  id: string;
  contractId: string;
  reference: string;
  status: `${VariationOrderStatus}`;
  title: string;
  description: string | null;
  /** Proposed only (CONST-VAR-003) — never moves the completion date automatically. */
  proposedTimeImpactDays: number | null;
  /** Σ of the line amounts. Signed; negative for a net omission. */
  netPrice: string;
  lines: VariationOrderLineResponse[];
  createdBy: string;
  submittedBy: string | null;
  submittedAt: string | null;
  internalApprovedBy: string | null;
  internalApprovedAt: string | null;
  clientApprovedBy: string | null;
  clientApprovedAt: string | null;
  clientApprovalReference: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  reason: string | null;
  /**
   * ADR-026 CONST-VAR-007 (Phase 2): whether this client-approved VO's scope has been materialised
   * into the BOQ as VARIATION-tagged nodes on a revision. `boqNodeCount` is how many such nodes
   * (leaves + the group section) carry its provenance; `boqAppliedVersionId` is the revision they
   * landed on. All null/false/0 until the apply-to-BOQ command runs.
   */
  appliedToBoq: boolean;
  boqNodeCount: number;
  boqAppliedAt: string | null;
  boqAppliedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A single VariationOrder without its lines — for the per-contract list read.
 *
 * ADR-026 CONST-VAR-011: the at-risk figures ride along on the list row so a reader can tell
 * sanctioned-early work from ordinary pending scope without opening every VO. `atRiskExposure`
 * is the Σ of the recorded exposures (what ACCO accepted by starting), which is deliberately
 * NOT the VO's net price and never enters the contract value.
 */
export type VariationOrderListItem = Omit<VariationOrderResponse, 'lines'> & {
  lineCount: number;
  atRiskAuthorisationCount: number;
  /** Decimal string; "0.00" when there are none. Null without financial visibility. */
  atRiskExposure: string | null;
};

export interface VariationOrderListResponse {
  contractId: string;
  variations: VariationOrderListItem[];
}

/**
 * ADR-026 CONST-VAR-007 (Phase 2) — the result of scoping a client-approved VO into the BOQ. The
 * revision the nodes landed on still follows the normal governed baseline command; this response
 * does NOT imply the Contract Baseline moved (that is the separate adopt-baseline act, OQ-2).
 */
export interface ApplyVariationToBoqResponse {
  variationId: string;
  reference: string;
  projectId: string;
  /** The DRAFT BOQ revision the VARIATION nodes were appended to. */
  boqVersionId: string;
  /** How many VARIATION leaf nodes were created (one per VO line). */
  nodeCount: number;
  appliedAt: string;
}

/**
 * ADR-026 CONST-VAR-007 / OQ-2 (Phase 2) — the result of the deliberate Contract-Baseline repoint.
 * This is what lets certification claims reach the enlarged scope; it is never automatic.
 */
export interface AdoptBaselineResponse {
  contractId: string;
  previousBoqVersionId: string;
  boqVersionId: string;
  boqVersionNumber: number;
  adoptedBy: string;
  adoptedAt: string;
}

// ─── Extension of Time (ADR-026 CONST-VAR-009, Variations Phase 4) ───────────────

/** A cited VariationOrder reference on an Extension of Time — justification, not effect. */
export interface ExtensionOfTimeCitedVariationOrder {
  id: string;
  reference: string;
  status: `${VariationOrderStatus}`;
}

/**
 * ADR-026 CONST-VAR-009 — one Extension-of-Time act: an audited change to the Contract's contractual
 * completion date. The date only ever moves through this explicit human command, never automatically
 * on VariationOrder approval. `previousEndDate` is the date before the act (null if the contract had
 * none); `newEndDate` is the new contractual date it set (the effective "as of" date). `grantedDays`
 * is the derived day-diff previous→new, null when there was no previous date to diff against. Cited
 * VOs are the justification the actor referenced, not the cause of the change.
 */
export interface ExtensionOfTimeResponse {
  id: string;
  contractId: string;
  previousEndDate: string | null;
  newEndDate: string;
  grantedDays: number | null;
  reason: string;
  citedVariationOrders: ExtensionOfTimeCitedVariationOrder[];
  grantedBy: string;
  grantedAt: string;
  createdAt: string;
}

/** The Extension-of-Time history for a contract, newest first. */
export interface ExtensionOfTimeListResponse {
  contractId: string;
  /** The contract's current contractual completion date (reflects the latest EoT), for convenience. */
  currentEndDate: string | null;
  extensions: ExtensionOfTimeResponse[];
}

/**
 * The POST /contracts/:id/extension-of-time command payload. `newEndDate` is the supplied effective
 * date (accounting-date rule — not `new Date()`); `reason` is required; `variationOrderIds` optionally
 * cites VOs on this contract as justification.
 */
export interface GrantExtensionOfTimeRequest {
  newEndDate: string;
  reason: string;
  variationOrderIds?: string[];
}

// ─── Certified & invoiced by variation (ADR-026 CONST-VAR-008, Variations Phase 3) ──

/**
 * ADR-026 CONST-VAR-008 (Phase 3) — the certified & invoiced value of a contract's work-to-date,
 * decomposed by the VariationOrder that introduced the scope. This is a pure READ model: it rides
 * the existing `IpcItem.certifiedAmount → applicationItem(IpaItem).boqNodeId → BoqNode.sourceChangeOrderId
 * → VariationOrder` join and threads NO new column onto IPA/IPC/Invoice.
 *
 * Basis (approved decision): the gross / ex-VAT (subtotal) composition of the certified item lines.
 * `certifiedToDate` sums `certifiedAmount` across items of EFFECTIVE IPCs; `invoicedToDate` sums the
 * same across items of IPCs whose ClientInvoice is POSTED. VAT and certificate-level deductions are
 * NOT VO-attributable — ADR-024 settlement truth (the invoice header total/outstanding) stays
 * AR-owned and untouched (CONST-VAR-012).
 *
 * Money fields are `string | null`: null when the caller lacks `financialPositionView`.
 */
export interface CertifiedInvoicedByVariation {
  /** The VariationOrder's id. */
  variationId: string;
  /** Its `VO-00n` reference. */
  reference: string;
  /** Its header title (for display). */
  title: string;
  /** Σ certifiedAmount of effective-IPC item lines tracing to this VO's BOQ nodes (ex-VAT). */
  certifiedToDate: string | null;
  /** Σ certifiedAmount of POSTED-invoice item lines tracing to this VO's BOQ nodes (ex-VAT). */
  invoicedToDate: string | null;
}

/**
 * The base-scope bucket: certified/invoiced value tracing to BASELINE BOQ nodes
 * (`sourceChangeOrderId === null`). First-class and normal — original contract scope is never
 * forced under a VO. Same gross/ex-VAT basis as the per-VO rows.
 */
export interface CertifiedInvoicedBaseScope {
  certifiedToDate: string | null;
  invoicedToDate: string | null;
}

/**
 * ADR-026 CONST-VAR-008 (Phase 3) — the whole certified & invoiced picture for a contract, split
 * base-scope + per-VO. Reconciliation holds by construction: base + Σ(byVariation) equals the whole
 * certified gross / invoiced gross (`totalCertifiedToDate` / `totalInvoicedToDate`).
 */
export interface CertifiedInvoicedByVariationResponse {
  contractId: string;
  /** True when the caller has `financialPositionView`; false ⇒ every money field is null. */
  canViewFinancials: boolean;
  /** Original-scope value (BASELINE nodes). */
  baseScope: CertifiedInvoicedBaseScope;
  /** Per-VO breakdown, ordered by reference. Includes VOs with zero certified/invoiced to date. */
  byVariation: CertifiedInvoicedByVariation[];
  /** Whole-contract certified gross = baseScope + Σ byVariation (ex-VAT). Null without the capability. */
  totalCertifiedToDate: string | null;
  /** Whole-contract invoiced gross = baseScope + Σ byVariation (ex-VAT). Null without the capability. */
  totalInvoicedToDate: string | null;
}

// ─── At-risk commencement (ADR-026 CONST-VAR-011, Variations Phase 5, Route 7B) ──────

/**
 * ADR-026 CONST-VAR-011 (Phase 5, Route 7B) — the POST /variations/:id/at-risk-commencement payload.
 * Records the audited authorisation to start urgent variation work BEFORE the VO is CLIENT_APPROVED
 * (never an informal verbal instruction — memo Q7B). CD + CFO always; the CEO additionally when the
 * exposure exceeds the config-driven cap (default USD 25,000). Changes NEITHER contract value NOR BOQ.
 */
export interface RecordAtRiskCommencementRequest {
  /** The exposure ACCO accepts by starting early (contract currency). Non-negative. */
  exposureAmount: number;
  /** ISO currency of the exposure. Defaults to the contract currency when omitted. */
  currency?: string;
  /** Why the work must start before the VO is finalised (required). */
  reason: string;
  /** The Construction Director authorising (user id). */
  constructionDirectorUserId: string;
  /** The CFO authorising (user id). */
  cfoUserId: string;
  /** The CEO authorising (user id). REQUIRED above the cap; rejected at or below it. */
  ceoUserId?: string;
}

/**
 * ADR-026 CONST-VAR-011 (Phase 5, Route 7B) — a recorded at-risk commencement authorisation. Money
 * fields are strings (exact decimal). The `capAmount` / `ceoRequired` are the rule outcome snapshotted
 * at authorisation time, so a later cap change never rewrites why the CEO was (or was not) required.
 */
export interface AtRiskCommencementResponse {
  id: string;
  variationOrderId: string;
  /** The VO reference, for display convenience. */
  variationReference: string;
  exposureAmount: string;
  currency: string;
  /** The cap in force when this authorisation was recorded (config-driven, snapshotted). */
  capAmount: string;
  /** Whether the exposure exceeded the cap, i.e. whether the CEO step was required. */
  ceoRequired: boolean;
  constructionDirectorUserId: string;
  cfoUserId: string;
  ceoUserId: string | null;
  reason: string;
  /** The VO status at the moment of authorisation (a pre-CLIENT_APPROVED state). */
  voStatusAtAuthorisation: string;
  authorisedBy: string;
  authorisedAt: string;
  createdAt: string;
}

// ─── Project Procurement (Phase 5) ──────────────────────────────────────────────
//
// The project's view of procurement. The boundary it obeys: **the organisation owns supplier
// documents; the project owns the cost coded onto their lines.** `PurchaseOrder` has no
// `projectId` and neither does `GoodsReceiptNote` — the cost target lives on
// `PurchaseOrderLine` and is inherited read-only by every downstream document, so one PO can
// legitimately serve three sites. Nothing here presents a supplier document as if the project
// owned it; documents are named and linked out to, never operated on.
//
// Every money figure is derived from `CommitmentLedgerEntry`, which already carries projectId,
// boqNodeId, supplierId, purchaseOrderId, stage and the full source-document trace. Reading the
// ledger rather than re-aggregating PO/GRN/bill lists means these figures **cannot** disagree
// with the Project Financial Position — they are the same rows.

/** A cost with no project attribution is corporate overhead and appears in no project view. */
export type ProjectCostStage = 'COMMITTED' | 'ACCRUED' | 'ACTUAL';

/**
 * The three ledger stages plus what they are measured against.
 *
 * `budget*` fields are null when the project has no BASELINED cost budget — which is the normal
 * state of a new project, and must render as "no budget set", never as 0% used.
 */
export interface ProjectCostPosition {
  currency: string | null;
  /** Decimal strings. Null when the caller lacks financial visibility. */
  committed: string | null;
  accrued: string | null;
  actual: string | null;
  /**
   * Committed to a supplier and not yet billed. Says exactly that and nothing more — it is not
   * a forecast, and it is not budget headroom. Derived from the ledger alone, so it exists with
   * or without a budget.
   */
  committedNotBilled: string | null;
  /** The BASELINED budget total, or null when none is set. */
  budgetTotal: string | null;
  /**
   * The two budget remainders, which are **not interchangeable** and must never collapse into
   * one "remaining":
   *
   * - `uncommittedBudget` = budget − committed. What is still free to spend. This is the
   *   cost-control figure — money already on a purchase order is spent as far as headroom goes.
   * - `budgetLessActual` = budget − actual. What has not yet been billed against the budget.
   *   Larger, and dangerous to read as headroom, because it counts committed money as available.
   *
   * Both null without a baselined budget.
   */
  uncommittedBudget: string | null;
  budgetLessActual: string | null;
  /**
   * Ratios, each named for its own numerator. "% of budget" under three different figures would
   * make a reader guess which one a number belongs to.
   */
  committedOfBudgetPercent: number | null;
  accruedOfBudgetPercent: number | null;
  actualOfBudgetPercent: number | null;
}

/** One stage of the requirement→payment pipeline, with its count and its money. */
export interface ProjectProcurementPipelineStage {
  stage: 'REQUIREMENTS' | 'PURCHASE_ORDERS' | 'GOODS_RECEIVED' | 'SUPPLIER_BILLS' | 'PAYMENTS';
  count: number;
  /** The money this stage represents. Null without financial visibility. */
  amount: string | null;
  /** A second count that qualifies the first — "12 approved", "4 not yet ordered". */
  qualifierCount: number | null;
}

/**
 * Something a project manager has to do something about.
 *
 * Ordered by **operational consequence**, not by document lifecycle: whether the site can keep
 * working comes before whether a bill reconciles. `tier` is the server's classification so the
 * ordering cannot drift between screens, and so a UI never invents a severity engine of its own.
 */
export type ProcurementAttentionTier =
  /** The site cannot proceed, or is about to be unable to. */
  | 'SITE_BLOCKING'
  /** Cost has landed but is not yet recognised — accrual and supplier-reconciliation risk. */
  | 'COST_RECOGNITION'
  /** Financial control: matching, tolerance, approval. */
  | 'FINANCIAL_CONTROL'
  /** Hygiene. Real, but must never outrank the three above. */
  | 'ROUTINE';

export type ProcurementAttentionKind =
  | 'APPROVED_NOT_ORDERED'
  | 'OVER_RECEIPT_EXCEPTION'
  | 'RECEIVED_NOT_BILLED'
  | 'BILL_OUTSIDE_TOLERANCE'
  | 'INSPECTION_UNRESOLVED'
  | 'STALE_DRAFT_REQUIREMENT';

export interface ProcurementAttentionItem {
  kind: ProcurementAttentionKind;
  tier: ProcurementAttentionTier;
  count: number;
  /** Total money behind the count, where the kind has one. Null otherwise or when withheld. */
  amount: string | null;
  /** Where to go to act on it. Null when the caller cannot act. */
  actionUrl: string | null;
}

/** A ledger movement, named by the document that caused it. */
export interface ProjectProcurementActivityRow {
  id: string;
  /** The source document's type, as the ledger recorded it. */
  documentType: string;
  /** Its human reference — "PO-0042 (Rev 3)", "GRN-0032". Null for a document since deleted. */
  reference: string | null;
  description: string | null;
  amount: string | null;
  currency: string;
  stage: ProjectCostStage;
  occurredAt: string;
}

export interface ProjectProcurementOverviewResponse {
  projectId: string;
  financialsVisible: boolean;
  position: ProjectCostPosition;
  /** Open requirements, active POs touching this project, open exceptions. */
  openRequirementCount: number;
  requirementsAwaitingProcurement: number;
  /**
   * `PurchaseOrder.status = OPEN`, and named for it. Not "active": the header's OPEN/CLOSED and
   * a revision's DRAFT→ACTIVE lifecycle are different records, and one word for both is how a
   * reader ends up believing an order is approved when only its header is open.
   */
  openPoCount: number;
  /** This project's share of those orders' active revisions — never the whole order value. */
  openPoValue: string | null;
  openExceptionCount: number;
  pipeline: ProjectProcurementPipelineStage[];
  attention: ProcurementAttentionItem[];
  /** Committed vs actual per top-level BOQ section, for the overview chart. */
  costByBoq: ProjectCostByBoqRow[];
  committedBySupplier: ProjectCostBySupplierRow[];
  recentActivity: ProjectProcurementActivityRow[];
  capabilities: ProjectProcurementCapabilities;
  asOf: string;
}

export interface ProjectProcurementCapabilities {
  canViewFinancials: boolean;
  canRaiseRequirement: boolean;
  canManageBudget: boolean;
  canBaselineBudget: boolean;
  /** True only where the caller also holds buyer authority (ADR-022); the tab still links out. */
  canOperateProcurement: boolean;
}

// ─── Cost & Commitments ─────────────────────────────────────────────────────────

/**
 * One row of the cost breakdown, in whichever dimension was requested.
 *
 * `boqNodeId` null with `kind: 'PROJECT_LEVEL'` is the legitimate project cost that has no BOQ
 * line — site office, transport, insurance, temporary facilities. It is project cost and must be
 * shown; it simply does not trace to priced scope. Corporate overhead (no project at all) never
 * reaches this read model.
 */
export interface ProjectCostByBoqRow {
  kind: 'BOQ' | 'PROJECT_LEVEL';
  boqNodeId: string | null;
  /** "001", "003.002". Null for the project-level bucket. */
  code: string | null;
  description: string;
  /** Depth in the BOQ tree, 0 for a top-level section. Drives indentation, not layout. */
  depth: number;
  hasChildren: boolean;
  budget: string | null;
  committed: string | null;
  accrued: string | null;
  actual: string | null;
  /**
   * budget − committed: what is still free to spend on this line. Null without a budget —
   * "remaining" needs something to remain of.
   */
  uncommittedBudget: string | null;
  /**
   * Two explicitly named ratios rather than one "% used". With committed, accrued and actual all
   * on the row, a single unlabelled percentage is a guessing game about which one it divides.
   */
  committedOfBudgetPercent: number | null;
  actualOfBudgetPercent: number | null;
}

export interface ProjectCostBySupplierRow {
  supplierId: string | null;
  supplierName: string;
  committed: string | null;
  accrued: string | null;
  actual: string | null;
  /** Share of the project's committed total, to one decimal. */
  percentOfCommitted: number | null;
}

export interface ProjectCostByCategoryRow {
  spendCategoryId: string | null;
  categoryName: string;
  committed: string | null;
  accrued: string | null;
  actual: string | null;
  percentOfActual: number | null;
}

export interface ProjectProcurementCostResponse {
  projectId: string;
  financialsVisible: boolean;
  position: ProjectCostPosition;
  /** Null when no BASELINED budget exists — the UI says so rather than showing 0%. */
  budgetVersion: number | null;
  byBoq: ProjectCostByBoqRow[];
  bySupplier: ProjectCostBySupplierRow[];
  byCategory: ProjectCostByCategoryRow[];
  recentEntries: ProjectProcurementActivityRow[];
  capabilities: ProjectProcurementCapabilities;
  asOf: string;
}

// ─── Requirements ───────────────────────────────────────────────────────────────

export type MaterialRequestPriorityValue = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

/** Has the requirement been agreed? Derived from `MaterialRequestStatus`, never invented. */
export type RequirementApprovalStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'CANCELLED'
  | 'CLOSED';

/** How much of it has been converted to purchase orders? A separate fact from approval. */
export type RequirementFulfillmentStatus = 'NOT_ORDERED' | 'PARTIALLY_ORDERED' | 'FULLY_ORDERED';

/**
 * A requirement as the project reads it.
 *
 * `estimatedValue` is the requester's estimate (Σ quantity × estimatedUnitPrice), which ADR-022
 * routes approval on. `orderedValue` is real money: Σ over the PO lines allocated to this
 * request, at the PO's own unit price. They are different bases and the UI must not present
 * their difference as a saving — a buyer beating an estimate and a buyer part-ordering look
 * identical in a single number.
 */
export interface ProjectRequirementRow {
  id: string;
  mrNumber: string;
  title: string | null;
  description: string | null;
  /** The raw `MaterialRequestStatus`, kept so nothing is lost in the split below. */
  status: string;
  /**
   * The one enum carries two different questions, and a single "Status" column answers neither
   * cleanly: has this been approved, and how much of it has been ordered. Split server-side so
   * every surface separates them the same way — the same discipline as PO header vs revision.
   */
  approvalStatus: RequirementApprovalStatus;
  fulfillmentStatus: RequirementFulfillmentStatus;
  priority: MaterialRequestPriorityValue;
  /** Rolled up from the lines' spend categories; null when the lines carry none. */
  category: string | null;
  requestedDate: string;
  requiredByDate: string | null;
  lineCount: number;
  /** The currency the estimate is denominated in. Null when the request carries no estimate. */
  currencyCode: string | null;
  estimatedValue: string | null;
  orderedValue: string | null;
  /** estimatedValue − orderedValue, floored at zero. Null when there is no estimate. */
  remainingValue: string | null;
  /** How many purchase orders carry lines allocated to this request. */
  purchaseOrderCount: number;
}

export interface ProjectRequirementsSummary {
  total: number;
  approved: number;
  ordered: number;
  partiallyOrdered: number;
  draftOrOther: number;
}

export interface ProjectRequirementsResponse {
  projectId: string;
  financialsVisible: boolean;
  summary: ProjectRequirementsSummary;
  requirements: ProjectRequirementRow[];
  capabilities: ProjectProcurementCapabilities;
  asOf: string;
}

// ─── Project cost budget ────────────────────────────────────────────────────────

export type ProjectCostBudgetStatusValue = 'DRAFT' | 'BASELINED' | 'SUPERSEDED';

export interface ProjectCostBudgetLineResponse {
  id: string;
  boqNodeId: string | null;
  boqNodeCode: string | null;
  spendCategoryId: string | null;
  spendCategoryName: string | null;
  description: string;
  budgetAmount: string;
  sortOrder: number;
}

export interface ProjectCostBudgetResponse {
  id: string;
  projectId: string;
  versionNumber: number;
  status: ProjectCostBudgetStatusValue;
  currency: string;
  notes: string | null;
  derivedFromId: string | null;
  total: string;
  preparedBy: string;
  baselinedAt: string | null;
  baselinedBy: string | null;
  lines: ProjectCostBudgetLineResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCostBudgetListResponse {
  projectId: string;
  /** The version the project is currently measured against, or null when none is baselined. */
  baselined: ProjectCostBudgetResponse | null;
  budgets: Array<Omit<ProjectCostBudgetResponse, 'lines'> & { lineCount: number }>;
}

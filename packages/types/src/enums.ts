export enum TenantStatus {
  PROVISIONING = 'PROVISIONING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  TERMINATED = 'TERMINATED',
}

export enum WorkflowTransactionType {
  MATERIAL_REQUEST = 'MATERIAL_REQUEST',
  PURCHASE_ORDER = 'PURCHASE_ORDER',
  SUPPLIER_PAYMENT = 'SUPPLIER_PAYMENT',
  STOCK_TRANSFER = 'STOCK_TRANSFER',
  MATERIAL_ISSUE = 'MATERIAL_ISSUE',
  SUBCONTRACT_CERTIFICATE = 'SUBCONTRACT_CERTIFICATE',
  IPC = 'IPC',
  VARIATION = 'VARIATION',
  // Sprint 4 — Accounting
  CLIENT_INVOICE = 'CLIENT_INVOICE',
  SUPPLIER_BILL = 'SUPPLIER_BILL',
  PAYMENT_RECEIPT = 'PAYMENT_RECEIPT',
  MANUAL_JOURNAL = 'MANUAL_JOURNAL',
  // ADR-016 — BOQ version baselining routes through the ADR-011 gate.
  BOQ_BASELINE = 'BOQ_BASELINE',
}

export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum ApprovalActionType {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  DELEGATE = 'DELEGATE',
  ESCALATE = 'ESCALATE',
}

export enum MembershipStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  REMOVED = 'REMOVED',
}

export enum WorkflowTriggerKind {
  DOCUMENT = 'DOCUMENT',
  STATE_TRANSITION = 'STATE_TRANSITION',
}

// ADR-019 CONST-PLC-001: the canonical lifecycle is six states. APPROVED and MOBILIZING
// retired — APPROVED into a workflow authorization event, MOBILIZING into readiness work
// performed while DRAFT (presented as "Preparation" in the UI, CONST-PLC-010).
export enum ProjectStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  PRACTICAL_COMPLETION = 'PRACTICAL_COMPLETION',
  CLOSEOUT = 'CLOSEOUT',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
}

export enum ProjectRole {
  PROJECT_MANAGER = 'PROJECT_MANAGER',
  QUANTITY_SURVEYOR = 'QUANTITY_SURVEYOR',
  SITE_ENGINEER = 'SITE_ENGINEER',
  COMMERCIAL_MANAGER = 'COMMERCIAL_MANAGER',
  FINANCE_REVIEWER = 'FINANCE_REVIEWER',
  VIEWER = 'VIEWER',
}

export enum BoqVersionStatus {
  DRAFT = 'DRAFT',
  BASELINED = 'BASELINED',
  SUPERSEDED = 'SUPERSEDED',
  CANCELLED = 'CANCELLED',
}

export enum CommercialModel {
  CLIENT_CONTRACT = 'CLIENT_CONTRACT',
  INTERNAL_CAPITAL = 'INTERNAL_CAPITAL',
}

// Project type (PTD1-PTD5): the fixed set of project categories. A required-on-create
// classification/reporting attribute that drives no workflow/template/approval and is not part of
// the project code. The value is the enum key; the parenthesised label is the intended UI display.
export enum ProjectCategory {
  COMMERCIAL = 'COMMERCIAL', // Commercial
  RESIDENTIAL = 'RESIDENTIAL', // Residential
  INFRASTRUCTURE_CIVIL = 'INFRASTRUCTURE_CIVIL', // Infrastructure & Civil
  INSTITUTIONAL_PUBLIC = 'INSTITUTIONAL_PUBLIC', // Institutional & Public
  INDUSTRIAL = 'INDUSTRIAL', // Industrial
  RENOVATION_FITOUT = 'RENOVATION_FITOUT', // Renovation & Fit-Out
}

// The UI labels for each ProjectCategory, kept beside the enum so web and API agree on the display
// text without either side hard-coding a second copy.
export const PROJECT_CATEGORY_LABELS: Record<ProjectCategory, string> = {
  [ProjectCategory.COMMERCIAL]: 'Commercial',
  [ProjectCategory.RESIDENTIAL]: 'Residential',
  [ProjectCategory.INFRASTRUCTURE_CIVIL]: 'Infrastructure & Civil',
  [ProjectCategory.INSTITUTIONAL_PUBLIC]: 'Institutional & Public',
  [ProjectCategory.INDUSTRIAL]: 'Industrial',
  [ProjectCategory.RENOVATION_FITOUT]: 'Renovation & Fit-Out',
};

export enum ParticipationModel {
  SOLE = 'SOLE',
  JOINT_VENTURE = 'JOINT_VENTURE',
}

export enum MeasurementMethod {
  QUANTITY = 'QUANTITY',
  PERCENTAGE = 'PERCENTAGE',
  MILESTONE = 'MILESTONE',
}

export enum PricingBasis {
  UNIT_RATE = 'UNIT_RATE',
  LUMP_SUM = 'LUMP_SUM',
}

export enum WorkflowRequirement {
  REQUIRED = 'REQUIRED',
  OPTIONAL = 'OPTIONAL',
  NONE = 'NONE',
}

export enum ClientStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum ContractStatus {
  DRAFT = 'DRAFT',
  UNDER_REVIEW = 'UNDER_REVIEW',
  PENDING_SIGNATURE = 'PENDING_SIGNATURE',
  ACTIVE = 'ACTIVE',
  FINAL_ACCOUNT_PENDING = 'FINAL_ACCOUNT_PENDING',
  CLOSED = 'CLOSED',
  CANCELLED = 'CANCELLED',
  TERMINATED = 'TERMINATED',
}

export enum BillingModel {
  MEASURED_IPC = 'MEASURED_IPC',
  MILESTONE = 'MILESTONE',
  TIME_AND_MATERIAL = 'TIME_AND_MATERIAL',
  HYBRID = 'HYBRID',
}

export enum AdvanceType {
  MOBILIZATION = 'MOBILIZATION',
  MATERIAL_ON_SITE = 'MATERIAL_ON_SITE',
  EQUIPMENT = 'EQUIPMENT',
  OTHER = 'OTHER',
}

// ADR-023: how a payment-schedule installment becomes billable.
export enum PaymentTrigger {
  ADVANCE = 'ADVANCE',
  TIME_BASED = 'TIME_BASED',
  MILESTONE = 'MILESTONE',
}

// ADR-021 Progress: daily-progress-report lifecycle.
export enum DprStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  RETURNED = 'RETURNED',
  // ADR-021 CONST-PROG-010 — an APPROVED report reopened for a controlled correction.
  REOPENED = 'REOPENED',
}

// ADR-021 phase 2: lifecycle of a programme delivery milestone.
export enum ProgrammeMilestoneStatus {
  PLANNED = 'PLANNED',
  VERIFIED = 'VERIFIED',
}

// Documents tab (ADR-014): category of a standalone project document.
export enum DocumentCategory {
  PERMIT = 'PERMIT',
  LICENSE = 'LICENSE',
  DRAWING = 'DRAWING',
  CONTRACT = 'CONTRACT',
  CERTIFICATE = 'CERTIFICATE',
  INSURANCE = 'INSURANCE',
  GUARANTEE = 'GUARANTEE',
  CORRESPONDENCE = 'CORRESPONDENCE',
  PHOTO = 'PHOTO',
  OTHER = 'OTHER',
}

export enum GuaranteeStatus {
  ACTIVE = 'ACTIVE',
  DISCHARGED = 'DISCHARGED',
  EXPIRED = 'EXPIRED',
  CALLED = 'CALLED',
}

export enum IpaStatus {
  DRAFT = 'DRAFT',
  PENDING_INTERNAL_APPROVAL = 'PENDING_INTERNAL_APPROVAL',
  RETURNED_FOR_REVISION = 'RETURNED_FOR_REVISION',
  APPROVED_FOR_SUBMISSION = 'APPROVED_FOR_SUBMISSION',
  SUBMITTED = 'SUBMITTED',
  CANCELLED = 'CANCELLED',
}

export enum IpcStatus {
  CERTIFIED = 'CERTIFIED',
  PARTIALLY_CERTIFIED = 'PARTIALLY_CERTIFIED',
  REJECTED = 'REJECTED',
}

// ADR-026 CONST-VAR-004 — the VariationOrder lifecycle. Only CLIENT_APPROVED counts toward the
// governing contract value (CONST-VAR-005); PENDING_INTERNAL + INTERNAL_APPROVED are Pending
// (CONST-VAR-006); REJECTED / WITHDRAWN are commercially inert terminals.
export enum VariationOrderStatus {
  DRAFT = 'DRAFT',
  PENDING_INTERNAL = 'PENDING_INTERNAL',
  INTERNAL_APPROVED = 'INTERNAL_APPROVED',
  CLIENT_APPROVED = 'CLIENT_APPROVED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
}

export type GovernedEntity =
  | 'Project'
  | 'InterimPaymentApplication'
  | 'PurchaseOrder'
  | 'SupplierBill'
  | 'SupplierPayment'
  // ADR-016 CONST-BOQ-018 — baselining fixes the scope a contract is signed against and
  // every certificate is claimed from, so it belongs behind the same gate.
  | 'BoqVersion'
  // ADR-022 CONST-DOA-008 — a daily progress report is approved by the Project Manager; the
  // Site Engineer only prepares it. The approval routes through the same governance gate.
  | 'DailyProgressReport'
  // ADR-026 CONST-VAR-010 — a VariationOrder's internal approval (PENDING_INTERNAL →
  // INTERNAL_APPROVED) is amount-banded on |net price| through the same governance gate.
  | 'VariationOrder';

/**
 * Wire shapes returned by the Rukna API.
 *
 * ─── Why this file exists ────────────────────────────────────────────────────────
 *
 * `apps/web/CLAUDE.md` says to import shared types rather than redefine them, and that is
 * the right rule. When this file was written, `@erp/types` exported only enums — no DTOs —
 * and `packages/types` is backend-owned, so the frontend could not add them (B12).
 *
 * Rather than scatter a dozen copies of the backend's contract across feature folders,
 * every wire shape lives here. That gives drift ONE place to be found and ONE place to be
 * deleted. Feature `types.ts` files re-export from here so nothing else has to change.
 *
 * ─── DO NOT MIGRATE THIS FILE TO `@erp/types` (checked 2026-08-04) ───────────────
 *
 * `@erp/types` now DOES export DTOs — `packages/types/src/construction.ts`, added in
 * `776b695`, covers the five Sprint 3 aggregates this file mirrors. Adopting them looks
 * like the obvious cleanup. It is a trap.
 *
 * Compared field by field against `apps/api/prisma/schema.prisma`, 13 of those 16
 * interfaces do not match the API — invented fields, omitted fields, renamed fields. See
 * issue #21 for the full table. The shapes in THIS file were read off the schema and the
 * repository `include` clauses, and are correct everywhere the two disagree.
 *
 * The failure mode is quiet, which is why this warning is long:
 *
 *     ReceiptAllocationResponse  declares  notes, createdAt      ← neither exists
 *                               omits     allocatedAt, allocatedBy
 *
 * Both omitted fields are rendered by the receipts allocations panel today. Swapping to
 * the shared type would type-check and break that panel at runtime. `IpcPaymentStatusResponse`
 * is worse — wrong in all five of its fields.
 *
 * Only `IpaResponse`, `IpcItemResponse` and `IpcDeductionResponse` are safe to adopt, and
 * the file cannot be deleted regardless while B12 is open: `@erp/types` still has no
 * Project or BOQ DTO at all.
 *
 * Revisit when #21 is fixed — ideally by generating the DTOs rather than hand-writing them.
 *
 * Tracked in `docs/backend-requests/frontend-blockers.md` under C6 and B12.
 *
 * ─── Serialization rules (these are not the Prisma types) ────────────────────────
 *
 *  - `Decimal` columns serialize as STRINGS, never numbers. `contractValue: "4500000.00"`.
 *    They are formatted for display and never parsed for arithmetic — see src/lib/format.ts.
 *  - `DateTime` and `@db.Date` columns serialize as ISO 8601 STRINGS, not `Date` objects.
 *  - Anything optional in the schema is genuinely nullable here.
 *  - Where a service computes a value at query time it is called out, because those fields
 *    exist on the detail response only and are absent from list responses.
 *
 * Two server-computed fields break the string rule and return JS numbers instead:
 * `BoqTreeNode.computedTotal` and `CertificatePaymentStatus.totalAllocated`. Both are
 * flagged at their declaration. See B7 and C8.
 *
 * Every shape below was read from `apps/api/prisma/schema.prisma` and the repository
 * `include` clauses, not inferred from documentation.
 */
import type {
  BoqVersionStatus,
  ClientStatus,
  ContractStatus,
  BillingModel,
  AdvanceType,
  GuaranteeStatus,
  IpaStatus,
  IpcStatus,
  MeasurementMethod,
  PricingBasis,
  ProjectRole,
  ProjectStatus,
} from '@erp/types';

// ─── Projects ────────────────────────────────────────────────────────────────────

/** `GET /projects` — list rows. */
export interface Project {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  status: ProjectStatus;
  contractValue: string | null;
  currency: string | null;
  clientName: string | null;
  startDate: string | null;
  expectedEndDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSuspension {
  id: string;
  projectId: string;
  reason: string;
  suspendedAt: string;
  suspendedBy: string;
  resumedAt: string | null;
  resumedBy: string | null;
}

export interface ProjectMemberRoleAssignment {
  id: string;
  role: ProjectRole;
  assignedAt: string;
}

export interface ProjectMember {
  id: string;
  userId: string;
  joinedAt: string;
  joinedBy: string;
  removedAt: string | null;
  roles: ProjectMemberRoleAssignment[];
  user: { id: string; firstName: string; lastName: string; email: string };
}

/**
 * `GET /projects/:id`.
 *
 * Both collections are pre-filtered by the API: `members` excludes removed members and
 * `suspensions` holds at most the one unresolved record — so a non-empty `suspensions`
 * array means suspended right now, it is not a history.
 *
 * `members` is always empty in practice: no project can be given a first member (B1).
 * The field is typed correctly so the members UI is a rendering change once that lands.
 */
export interface ProjectDetail extends Project {
  members: ProjectMember[];
  suspensions: ProjectSuspension[];
}

// ─── BOQ ─────────────────────────────────────────────────────────────────────────

export interface BoqVersion {
  id: string;
  boqId: string;
  versionNumber: number;
  status: BoqVersionStatus;
  notes: string | null;
  baselinedAt: string | null;
  baselinedBy: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** `GET /projects/:id/boq`. */
export interface Boq {
  id: string;
  projectId: string;
  organizationId: string;
  /** The first-ever baseline. Immutable once set — the original contract BOQ. */
  originalBaselineVersionId: string | null;
  currentApprovedVersionId: string | null;
  currentDraftVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Newest version first, as the API orders them. */
  versions: BoqVersion[];
}

/**
 * `GET /projects/:id/boq/versions/:vId/tree`.
 *
 * `measurementMethod` and `pricingBasis` were added to `BoqNode` in Sprint 3 and are
 * returned by the tree query (`findNodesByVersion` selects the whole row). The IPA item
 * picker needs `measurementMethod` to label a claim as quantity, percentage or milestone.
 */
export interface BoqTreeNode {
  id: string;
  boqId: string;
  versionId: string;
  parentId: string | null;
  /** Materialized path of node ids, "rootId/childId/grandchildId". */
  path: string;
  depth: number;
  sortOrder: number;
  code: string;
  description: string;
  descriptionAr: string | null;
  measurementMethod: MeasurementMethod;
  pricingBasis: PricingBasis;
  unit: string | null;
  quantity: string | null;
  unitRate: string | null;
  currency: string | null;
  totalAmount: string | null;
  isLeaf: boolean;
  originNodeId: string | null;
  createdAt: string;
  updatedAt: string;
  children: BoqTreeNode[];
  /**
   * Server-computed: own amount for a leaf, sum of descendants for a summary.
   *
   * A NUMBER, not a string — the only money field on this shape that is. It is summed in
   * floating point server-side (B7), and mixed-currency subtrees sum without regard to
   * currency (D1), which is why `subtree-currency.ts` suppresses parent totals that mix.
   */
  computedTotal: number | null;
}

// ─── Clients ─────────────────────────────────────────────────────────────────────

export interface ClientContact {
  id: string;
  clientId: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

/**
 * `GET /clients` — list rows, ordered by name.
 *
 * Note: the endpoint takes NO query parameters. `apps/web/CLAUDE.md:84` documents a
 * `?status=ACTIVE` filter that `ClientsController.findAll` does not accept and
 * `ClientPrismaRepository.findAll` does not apply — status filtering is client-side (D3).
 */
export interface Client {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  nameAr: string | null;
  taxNumber: string | null;
  defaultCurrency: string | null;
  status: ClientStatus;
  createdAt: string;
  updatedAt: string;
}

/** `GET /clients/:id`. */
export interface ClientDetail extends Client {
  contacts: ClientContact[];
}

// ─── Contracts ───────────────────────────────────────────────────────────────────

/** `GET /contracts` and `GET /contracts?projectId=` — list rows, no sub-entities. */
export interface Contract {
  id: string;
  projectId: string;
  organizationId: string;
  clientId: string;
  /**
   * Always a BASELINED version: `ContractService.create` rejects anything else
   * (`contract.service.ts:50-63`). The picker filters to BASELINED and the server backs
   * it up.
   *
   * There is no Prisma relation on this column — the FK is enforced in migration SQL only
   * — so no endpoint expands it. Fetch the BOQ separately when the version is needed.
   */
  boqVersionId: string;
  contractNumber: string;
  contractValue: string;
  currency: string;
  billingModel: BillingModel;
  status: ContractStatus;
  /**
   * Frozen at the ACTIVE transition and never updated again. Null until `execute` runs.
   * Once set, these — not the live client record — are what the contract legally names,
   * which is why `execute` needs an explicit warning in the UI.
   */
  clientNameSnapshot: string | null;
  clientTaxSnapshot: string | null;
  startDate: string | null;
  expectedEndDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Percentages are Decimal(5,4) — a 10% retention rate arrives as `"0.1000"`, not `"10"`.
 * Formatting must multiply by 100; the raw value is never a percentage figure.
 *
 * ⚠ `retentionSplitOnPC` is spelled differently on the way in. `AddRetentionTermsDto`
 * declares `retentionSplitOnPc` (lowercase `c`) and the repository translates it to the
 * `retentionSplitOnPC` column. Because the ValidationPipe runs with
 * `forbidNonWhitelisted`, echoing this response shape back in a POST is a 400 — verified
 * against the running API. The request payload type must use `Pc`.
 */
export interface ContractRetentionTerms {
  contractId: string;
  retentionRate: string;
  retentionCap: string;
  retentionSplitOnPC: string;
  retentionReleasedAt: string | null;
}

/** `amount` and `percentage` are alternatives — a term carries one or the other. */
export interface ContractAdvanceTerm {
  id: string;
  contractId: string;
  advanceType: AdvanceType;
  description: string | null;
  amount: string | null;
  percentage: string | null;
  /** Decimal(5,4), as with retention — `"0.2000"` means 20% recovered per certificate. */
  recoveryRate: string;
}

export interface GuaranteeAttachment {
  id: string;
  guaranteeId: string;
  platformFileId: string;
  createdAt: string;
  createdBy: string;
}

/**
 * `guaranteeType` is a free-text column, not an enum — the backend does not constrain it.
 * The UI offers the conventional set (PERFORMANCE, ADVANCE_PAYMENT, RETENTION, BID) but
 * must render whatever arrives.
 */
export interface ContractGuarantee {
  id: string;
  contractId: string;
  guaranteeType: string;
  amount: string;
  currency: string;
  issuer: string;
  beneficiary: string;
  issueDate: string;
  expiryDate: string;
  status: GuaranteeStatus;
  notes: string | null;
  attachments: GuaranteeAttachment[];
}

export interface ContractMilestone {
  id: string;
  contractId: string;
  name: string;
  description: string | null;
  dueDate: string | null;
  completedAt: string | null;
  completedBy: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface ContractAttachment {
  id: string;
  contractId: string;
  platformFileId: string;
  createdAt: string;
  createdBy: string;
}

/**
 * `GET /contracts/:id`.
 *
 * `client` is a narrow projection — `{ id, name, taxNumber }` only. For anything else
 * about the client, fetch `GET /clients/:id`.
 *
 * `milestones` arrives ordered by `sortOrder`; the other collections are unordered.
 */
export interface ContractDetail extends Contract {
  retentionTerms: ContractRetentionTerms | null;
  advanceTerms: ContractAdvanceTerm[];
  guarantees: ContractGuarantee[];
  milestones: ContractMilestone[];
  attachments: ContractAttachment[];
  client: { id: string; name: string; taxNumber: string | null };
}

// ─── Interim Payment Applications ────────────────────────────────────────────────

/**
 * A claimed BOQ line.
 *
 * `previousEffectiveCertified`, `periodQuantity` and `periodAmount` are all derived and
 * stored SERVER-side (`ipa.service.ts:155-172`) — the client sends only `boqNodeId`,
 * `unitRateSnapshot`, `currencySnapshot` and `cumulativeClaimed`. Display these; never
 * recompute them.
 *
 * `unitRateSnapshot` being client-supplied is C3: the backend already loads the BOQ node
 * for `measurementMethodSnapshot` and should take the rate from the same row.
 */
export interface IpaItem {
  id: string;
  applicationId: string;
  boqNodeId: string;
  measurementMethodSnapshot: MeasurementMethod;
  unitRateSnapshot: string;
  currencySnapshot: string;
  /** Total claimed to date, NOT this period. Decimal(18,3). */
  cumulativeClaimed: string;
  previousEffectiveCertified: string;
  /** `cumulativeClaimed - previousEffectiveCertified`. Decimal(18,3). */
  periodQuantity: string;
  /** `periodQuantity * unitRateSnapshot`. Decimal(18,2). */
  periodAmount: string;
}

/** `deductionType` is free text — RETENTION, ADVANCE_RECOVERY and TAX by convention. */
export interface IpaDeduction {
  id: string;
  applicationId: string;
  deductionType: string;
  sourceTermId: string | null;
  rate: string | null;
  basis: string;
  amount: string;
}

export interface IpaAttachment {
  id: string;
  applicationId: string;
  platformFileId: string;
  createdAt: string;
  createdBy: string;
}

/**
 * `GET /ipa` and `GET /ipa?contractId=` — list rows, no items or deductions.
 *
 * `applicationNumber` and `applicationRef` stay null until `approve-for-submission`
 * assigns them (`ipa.service.ts:112`). A DRAFT application has no number to display.
 */
export interface Ipa {
  id: string;
  contractId: string;
  organizationId: string;
  applicationNumber: number | null;
  applicationRef: string | null;
  status: IpaStatus;
  periodFrom: string | null;
  periodTo: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  exchangeRateCurrency: string | null;
  exchangeRateBase: string | null;
  exchangeRateValue: string | null;
  exchangeRateDate: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * `GET /ipa/:id`.
 *
 * The three totals are computed per-request in `Decimal` and returned as strings
 * (`ipa.service.ts:60-65`). They exist on this response only — the list rows carry no
 * totals, so a list showing amounts needs one detail fetch per row.
 */
export interface IpaDetail extends Ipa {
  items: IpaItem[];
  deductions: IpaDeduction[];
  attachments: IpaAttachment[];
  totalPeriodAmount: string;
  totalDeductions: string;
  netPayable: string;
}

// ─── Interim Payment Certificates ────────────────────────────────────────────────

/**
 * `certifiedAmount` and `varianceQuantity` are computed server-side from the application
 * item's `unitRateSnapshot` and `cumulativeClaimed` (`ipc.service.ts:109-119`).
 *
 * `certifiedTotal` on the certificate itself is NOT — it is stored exactly as the client
 * sent it, with no check against the sum of these items. That is C1.
 */
export interface IpcItem {
  id: string;
  certificateId: string;
  applicationItemId: string;
  certifiedQuantity: string;
  certifiedAmount: string;
  /** `certifiedQuantity - cumulativeClaimed`. Negative when the certifier cut the claim. */
  varianceQuantity: string;
  /** Required by the API whenever certified ≠ claimed (`ipc.service.ts:66`). */
  varianceReason: string | null;
}

export interface IpcDeduction {
  id: string;
  certificateId: string;
  deductionType: string;
  sourceTermId: string | null;
  rate: string | null;
  basis: string;
  amount: string;
}

export interface IpcAttachment {
  id: string;
  certificateId: string;
  platformFileId: string;
  createdAt: string;
  createdBy: string;
}

/**
 * `GET /ipc` and `GET /ipc?applicationId=` — list rows.
 *
 * At most one certificate per application has `isEffective: true`; a partial unique index
 * enforces it. The first non-REJECTED certificate becomes effective automatically
 * (`ipc.service.ts:78`). Once one exists, issuing another requires `supersede`.
 */
export interface Ipc {
  id: string;
  applicationId: string;
  organizationId: string;
  certificateNumber: number;
  certificateRef: string | null;
  status: IpcStatus;
  isEffective: boolean;
  effectiveAt: string | null;
  supersededAt: string | null;
  supersededById: string | null;
  supersessionReason: string | null;
  /** Gross certified, BEFORE deductions. Client-supplied on issue — see C1. */
  certifiedTotal: string;
  currency: string;
  exchangeRateCurrency: string | null;
  exchangeRateBase: string | null;
  exchangeRateValue: string | null;
  exchangeRateDate: string | null;
  issuedAt: string | null;
  issuedBy: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

/**
 * `GET /ipc/:id`.
 *
 * `totalCertifiedAmount` is the sum of the ITEMS and may disagree with the stored
 * `certifiedTotal`, which the client supplied independently (C1). Where the two differ,
 * the item sum is the defensible number — but the UI should surface the disagreement
 * rather than silently pick one.
 */
export interface IpcDetail extends Ipc {
  items: IpcItem[];
  deductions: IpcDeduction[];
  attachments: IpcAttachment[];
  totalCertifiedAmount: string;
  totalDeductions: string;
  /** `totalCertifiedAmount - totalDeductions`. What the client actually owes. */
  netCertified: string;
}

// ─── Finance ─────────────────────────────────────────────────────────────────────

export interface ReceiptAllocation {
  id: string;
  receiptId: string;
  certificateId: string;
  allocatedAmount: string;
  allocatedAt: string;
  allocatedBy: string;
}

/** `GET /receipts` and `GET /receipts?clientId=` — newest receipt date first. */
export interface Receipt {
  id: string;
  organizationId: string;
  clientId: string;
  receiptDate: string;
  amount: string;
  currency: string;
  exchangeRate: string | null;
  reference: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

/** `GET /receipts/:id`. Allocations arrive newest first. */
export interface ReceiptDetail extends Receipt {
  allocations: ReceiptAllocation[];
}

/**
 * `GET /receipts/certificate/:certificateId/payment-status`.
 *
 * Two cautions before displaying this.
 *
 * 1. `totalAllocated` is a NUMBER, not a string — the repository runs the sum through
 *    `Number()` (`finance-prisma.repository.ts:87`). It is the one money field on the
 *    whole API that is not a decimal string.
 * 2. `status` compares allocations against the certificate's GROSS `certifiedTotal`, not
 *    `netCertified` (`finance-prisma.repository.ts:86-91`). A client pays the net, so a
 *    fully-settled certificate carrying any deduction reports PARTIALLY_PAID forever and
 *    can never reach PAID. That is C7 — the UI must not present this as settlement truth
 *    until it is resolved.
 */
export interface CertificatePaymentStatus {
  totalAllocated: number;
  status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
}

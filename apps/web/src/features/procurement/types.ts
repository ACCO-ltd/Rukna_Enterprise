/**
 * ─── Procurement API types ──────────────────────────────────────────────────────
 *
 * Hand-written against the controllers and DTOs in
 * `apps/api/src/business/procurement/`, not against `api-reference.md` §6.24–6.32.
 * The Sprint 5 contract sweep found seventeen divergences between the two; where they
 * disagree, the code won. Findings are recorded as the P-series in
 * `docs/backend-requests/frontend-blockers.md` and referenced by ID below.
 *
 * ─── Money and quantity are asymmetric (P17) ────────────────────────────────────
 *
 * Every value that comes OUT of this API is a decimal string — Prisma serializes
 * `Decimal(18,2)` and `Decimal(18,3)` that way. Every value that goes IN is a JSON
 * number, because the write DTOs are typed `@IsPositive() unitPrice: number`.
 *
 * So the same field is `string` on a response type and `number` on a payload type. That
 * asymmetry is deliberate and it is not ours: `Money` and `Quantity` alias `string` for
 * reads, and the payload types spell `number` outright so the mismatch is visible at
 * every call site rather than hidden behind an alias that lies about one direction.
 *
 * Nullable columns are `T | null`, never `T?`. The API sends `null`, and `null` is not
 * assignable to an optional `T` (C6, still open).
 */

/** A `Decimal(18,2)` money value as sent by the API — `"21250.00"`. */
export type Money = string;

/** A `Decimal(18,3)` quantity as sent by the API — `"25"`, `"0.500"`. */
export type Quantity = string;

/** An ISO-8601 instant or date as sent by the API. */
export type ApiDate = string;

// ─── Shared enums ────────────────────────────────────────────────────────────────

export type MasterDataStatus = 'ACTIVE' | 'INACTIVE';
export type MaterialStatus = 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
export type ProcurementLineType = 'MATERIAL' | 'SERVICE' | 'OTHER';

export type MaterialRequestStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'PARTIALLY_ORDERED'
  | 'FULLY_ORDERED'
  | 'CANCELLED'
  | 'CLOSED';

export type MaterialRequestScope = 'PROJECT' | 'ORGANIZATION';

export type PurchaseOrderStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';

export type PurchaseOrderRevisionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'ACTIVE'
  | 'SUPERSEDED'
  | 'CANCELLED';

export type GoodsReceiptStatus = 'DRAFT' | 'POSTED' | 'EXCEPTION_PENDING' | 'CANCELLED';

/**
 * `REJECTED` is documented (§6.30) and unusable (P6): a wholly rejected line has
 * `acceptedQuantity: 0`, which `@IsPositive()` refuses with a `400` before the service
 * runs. It stays in the type because responses may carry it — historic rows, or data
 * written by a future fixed API — but it is not offered in the create form.
 */
export type QualityStatus =
  | 'PENDING_INSPECTION'
  | 'ACCEPTED'
  | 'PARTIALLY_ACCEPTED'
  | 'REJECTED';

export type BillMatchStatus =
  | 'NOT_RUN'
  | 'MATCHED'
  | 'MATCHED_WITH_TOLERANCE'
  | 'EXCEPTION'
  | 'APPROVED_EXCEPTION';

export type MatchType = 'TWO_WAY' | 'THREE_WAY';

export type CommitmentStage = 'COMMITTED' | 'ACCRUED' | 'ACTUAL';

export type CommitmentSourceDocumentType =
  | 'PURCHASE_ORDER_REVISION'
  | 'GOODS_RECEIPT'
  | 'PO_CANCELLATION'
  | 'SUPPLIER_BILL';

// ─── Catalogue ───────────────────────────────────────────────────────────────────

export interface UnitOfMeasure {
  id: string;
  code: string;
  name: string;
  symbol: string;
  status: MasterDataStatus;
}

/**
 * `children` is present on the list and single-fetch responses, which both return the
 * root categories with one level nested.
 */
export interface MaterialCategory {
  id: string;
  code: string;
  name: string;
  status: MasterDataStatus;
  parentId: string | null;
  children?: MaterialCategory[];
}

export interface SpendCategory {
  id: string;
  code: string;
  name: string;
  status: MasterDataStatus;
  parentId: string | null;
  children?: SpendCategory[];
}

export interface Material {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: MaterialStatus;
  materialCategoryId: string;
  defaultSpendCategoryId: string | null;
  baseUnitOfMeasureId: string;
  materialCategory: MaterialCategory | null;
  defaultSpendCategory: SpendCategory | null;
  baseUom: UnitOfMeasure | null;
}

// ─── Material requests ───────────────────────────────────────────────────────────

export interface MaterialRequestLine {
  id: string;
  lineNumber: number;
  lineType: ProcurementLineType;
  materialId: string | null;
  description: string;
  requestedQuantity: Quantity;
  approvedQuantity: Quantity | null;
  boqNodeId: string | null;
  spendCategoryId: string | null;
  notes: string | null;
  material: Pick<Material, 'code' | 'name'> | null;
  uom: Pick<UnitOfMeasure, 'code' | 'symbol'> | null;
}

export interface MaterialRequest {
  id: string;
  mrNumber: string;
  requestScope: MaterialRequestScope;
  projectId: string | null;
  status: MaterialRequestStatus;
  /**
   * Written on submit and read by the approval panel. Both repositories use `include` with no
   * `select`, so this scalar arrives on the list and the detail alike.
   *
   * It is the **only** way to reach an approval instance — nothing lists them, by approver or
   * otherwise — which is why an approval inbox is not buildable and the panel hangs off the
   * document instead.
   */
  approvalInstanceId: string | null;
  requestedDate: ApiDate;
  requiredByDate: ApiDate | null;
  description: string | null;
  notes: string | null;
  lines: MaterialRequestLine[];
}

// ─── Suppliers ───────────────────────────────────────────────────────────────────

/**
 * `GET /suppliers` and `GET /suppliers/:id`.
 *
 * Live since `7cf2507` (A3 / #26). The list takes an optional `?status=ACTIVE|INACTIVE`,
 * which — unlike the catalogue endpoints (P2) — is a real parameter the controller reads,
 * so INACTIVE suppliers are reachable here in a way inactive units and materials are not.
 *
 * **There is no `PATCH /suppliers/:id` and nothing sets `status`** (A15). A supplier is
 * write-once: a misspelt name is permanent and prints on every bill and payment that
 * references it. That is why the create form warns before submitting and why no screen
 * offers an edit control — an input that silently has no effect is worse than no input.
 */
export interface Supplier {
  id: string;
  code: string;
  name: string;
  taxNumber: string | null;
  defaultCurrency: string | null;
  paymentTermsDays: number | null;
  status: MasterDataStatus;
}

/**
 * `POST /suppliers`. `code` and `name` are the only required fields; the rest are
 * `@IsOptional()` on `CreateSupplierDto`. A duplicate `code` returns `409`.
 *
 * `paymentTermsDays` is `@IsInt() @Min(0)` and carries `@Type(() => Number)`, so it is one
 * of the few places in this API where a numeric string would also be accepted. It is sent
 * as a number regardless, to match every other write path.
 */
export interface CreateSupplierPayload {
  code: string;
  name: string;
  taxNumber?: string;
  defaultCurrency?: string;
  paymentTermsDays?: number;
}

// ─── Purchase orders ─────────────────────────────────────────────────────────────

/**
 * The supplier as embedded on a purchase order. `purchase-order.repository.ts` includes
 * the whole relation (`supplier: true`) on both list and detail, so more fields than these
 * arrive; only the two every screen uses are declared.
 *
 * Note the asymmetry with `SupplierBillRef` below — the bill repository `select`s three
 * columns and omits `nameAr`, so the same supplier renders in English on a bill and in
 * Arabic on a purchase order (A13).
 */
export interface PurchaseOrderSupplier {
  id: string;
  name: string;
}

/**
 * The cost-target as embedded on a PO line read model (A3/D7, no. 148). Both are present
 * together for a project-cost line, or both null for an org/overhead line. The PO detail
 * repository (`PO_INCLUDE`) selects the project's `code`/`name` and the BOQ node's
 * `code`/`description`, so — unlike the bill line, which sends bare ids — a PO line can be
 * labelled without a second request.
 */
export interface PoLineCostTargetProject {
  id: string;
  code: string;
  name: string;
}

export interface PoLineCostTargetBoqNode {
  id: string;
  code: string;
  description: string;
}

export interface PurchaseOrderLine {
  id: string;
  lineNumber: number;
  lineType: ProcurementLineType;
  description: string;
  orderedQuantity: Quantity;
  unitPrice: Money;
  extendedAmount: Money;
  materialId: string | null;
  spendCategoryId: string | null;
  material: Pick<Material, 'code' | 'name'> | null;
  uom: Pick<UnitOfMeasure, 'code' | 'symbol'> | null;
  spendCategory: Pick<SpendCategory, 'code' | 'name'> | null;
  /**
   * Cost-target (A3/D7, no. 148). Both non-null = a project-cost line; both null = org/overhead.
   * `PO_INCLUDE` embeds the labels, so the cost-target chip can name the project and node.
   */
  projectId: string | null;
  boqNodeId: string | null;
  project: PoLineCostTargetProject | null;
  boqNode: PoLineCostTargetBoqNode | null;
}

export interface PurchaseOrderRevision {
  id: string;
  revisionNumber: number;
  status: PurchaseOrderRevisionStatus;
  currencyCode: string;
  effectiveFrom: ApiDate;
  reason: string | null;
  deliveryAddress: string | null;
  expectedDeliveryDate: ApiDate | null;
  approvedAt: ApiDate | null;
  approvedBy: string | null;
  /**
   * Absent on the list response. `findAll` embeds `revisions: { take: 1 }` with no
   * `lines` include, so the list cannot compute a total (P14).
   */
  lines?: PurchaseOrderLine[];
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  currentRevisionId: string | null;
  supplier: PurchaseOrderSupplier | null;
  /** Written on submit. See the note on `MaterialRequest.approvalInstanceId`. */
  approvalInstanceId: string | null;
  /**
   * On the detail response: every revision, ascending. On the list response: exactly one
   * — the **highest-numbered**, which is the DRAFT whenever a revision is in progress,
   * not the ACTIVE one (P14).
   */
  revisions: PurchaseOrderRevision[];
}

// ─── Goods receipts ──────────────────────────────────────────────────────────────

export interface GoodsReceiptLine {
  id: string;
  lineNumber: number;
  purchaseOrderLineId: string;
  lineType: ProcurementLineType;
  orderedQuantity: Quantity;
  previouslyReceivedQty: Quantity;
  receivedQuantity: Quantity;
  acceptedQuantity: Quantity;
  rejectedQuantity: Quantity;
  rejectionReason: string | null;
  qualityStatus: QualityStatus;
  notes: string | null;
  materialId: string | null;
  material: Pick<Material, 'code' | 'name'> | null;
  uom: Pick<UnitOfMeasure, 'code' | 'symbol'> | null;
}

export interface GoodsReceipt {
  id: string;
  grnNumber: string;
  status: GoodsReceiptStatus;
  purchaseOrderId: string;
  purchaseOrderRevisionId: string;
  supplierId: string;
  deliveryDate: ApiDate;
  deliveryNoteRef: string | null;
  postedAt: ApiDate | null;
  postedBy: string | null;
  lines: GoodsReceiptLine[];
  purchaseOrder?: Pick<PurchaseOrder, 'poNumber'> | null;
}

// ─── Bill matching ───────────────────────────────────────────────────────────────

export interface BillMatchLine {
  id: string;
  purchaseOrderLineId: string;
  goodsReceiptLineId: string | null;
  description: string | null;
  poQuantity: Quantity;
  receivedQuantity: Quantity | null;
  billedQuantity: Quantity;
  poUnitPrice: Money;
  billedUnitPrice: Money;
  quantityVariance: Quantity;
  priceVariance: Money;
  amountVariance: Money;
  /**
   * Per-dimension verdicts (ADR-018 CONST-MATCH-003). The match line row carries all three
   * plus the derived overall `withinTolerance` (CONST-MATCH-004); `findByBillId` returns the
   * whole row, so they are on the wire. Shown in the "Review differences" comparison so a
   * reader can see *which* dimension a line failed on, not only that it failed.
   */
  quantityWithinTolerance: boolean;
  priceWithinTolerance: boolean;
  amountWithinTolerance: boolean;
  withinTolerance: boolean;
  /** Set on an out-of-tolerance line — the server's plain-language reason. `null` when matched. */
  exceptionReason: string | null;
  /**
   * The matched PO line, embedded by `findByBillId` (`include: { purchaseOrderLine: true }`).
   * Its `description` labels the comparison row; the bare `description` field above is not
   * populated by the read model, so this is the reliable source.
   */
  purchaseOrderLine?: Pick<PurchaseOrderLine, 'lineNumber' | 'description'> | null;
}

export interface BillMatchResult {
  id: string;
  supplierBillId: string;
  matchType: MatchType;
  status: BillMatchStatus;
  matchedAt: ApiDate | null;
  matchedBy: string | null;
  approvalReason: string | null;
  approvedBy: string | null;
  approvedAt: ApiDate | null;
  lines: BillMatchLine[];
}

// ─── Supplier bills (AP — read-only host for the Matching tab) ───────────────────

/**
 * The supplier as embedded on a bill. `supplier-bill.repository.ts:47` selects exactly
 * these three columns on both `findById` and `findAll` — P16's fix.
 *
 * `nameAr` is **not** among them, so on the Arabic UI a bill shows an English supplier
 * name while a purchase order shows the Arabic one (A13). Screens fall back to `name`
 * rather than papering over it with a second request.
 */
export interface SupplierBillRef {
  id: string;
  code: string;
  name: string;
}

export interface SupplierBillLine {
  id: string;
  lineNumber: number;
  description: string;
  quantity: Quantity | null;
  unitPrice: Money | null;
  netAmount: Money;
  vatAmount: Money;
  /** `net + vat`, computed server-side. Posts to expense whole — ACCO's VAT is non-recoverable. */
  grossAmount: Money;
  /** The `PostingProfile.code` whose account the server debits at post time. */
  expenseProfileCode: string;
  projectId: string | null;
  boqNodeId: string | null;
}

/** `BillDocStatus` in `schema.prisma`. */
export type BillDocumentStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

/** `PostingStatus` in `schema.prisma` — shared with invoices and payments. */
export type BillPostingStatus =
  | 'NOT_POSTED'
  | 'PENDING'
  | 'POSTED'
  | 'FAILED'
  | 'REVERSED'
  | 'OPENING_BALANCE';

export interface SupplierBill {
  id: string;
  billNumber: string | null;
  supplierId: string;
  /** Embedded on both list and detail since P16. Typed nullable for bills written before it. */
  supplier: SupplierBillRef | null;
  supplierInvoiceNumber: string;
  billDate: ApiDate;
  dueDate: ApiDate;
  currencyCode: string;
  /**
   * ⚠ These were declared as a single `status: string` until Tier B, and **there is no
   * `status` column on `SupplierBill`** — the schema has `documentStatus` and `postingStatus`
   * and nothing else. So `bill.status` was `undefined` against the live API on both bill
   * screens, and the badge rendered from it was blank.
   *
   * The tests did not catch it because the fixture invented the field, which is the same way
   * C8 shipped: a type that disagrees with the API, asserted against a mock that agrees with
   * the type. Fixtures are now built from the two real fields.
   */
  documentStatus: BillDocumentStatus;
  postingStatus: BillPostingStatus;
  matchStatus: BillMatchStatus;
  purchaseOrderId: string | null;
  /**
   * Never written by any code path (A14 / #33). Always `null` in practice, which is why the
   * match gate never engages for a bill created through the API — and why Tier B creates
   * non-PO bills only, where that is correct rather than merely unenforced.
   */
  purchaseOrderRevisionId: string | null;
  projectId: string | null;
  subtotal: Money;
  vatAmount: Money;
  totalAmount: Money;
  outstandingAmount: Money;
  /** Present on detail only — `findAll` includes no lines. */
  lines?: SupplierBillLine[];
}

/**
 * `POST /bills`.
 *
 * Money is a JSON number on the way in and a decimal string on the way out (A9/P17) — build
 * these with `moneyToApi` from `quantities.ts` rather than by hand.
 *
 * `purchaseOrderId` is now the switch between the two controlled paths (A14, merged #151):
 *
 *  - **omitted** → a non-PO bill (utilities, rent, one-off purchases). No matching runs; the
 *    commitment ledger is right to stay silent because none was raised.
 *  - **present** → a PO-backed bill. `SupplierBillService.create` resolves the PO's ACTIVE
 *    revision and records `purchaseOrderRevisionId`, and `submit` auto-runs the 3-way match
 *    (D6). The bill line's `quantity`/`unitPrice` are what the match compares against the PO
 *    line and the accepted receipts, so a material line must carry both.
 *
 * `boqNodeId` is NOT sent from the UI for a PO-backed line: the server inherits the
 * cost-target from the matched PO line at post time (D7, `findBillLineCostTargets`), so the
 * chip on the bill line is read-only inheritance, not an input.
 */
export interface CreateSupplierBillLinePayload {
  description: string;
  quantity?: number;
  unitPrice?: number;
  netAmount: number;
  vatAmount: number;
  expenseProfileCode: string;
  projectId?: string;
}

export interface CreateSupplierBillPayload {
  supplierId: string;
  supplierInvoiceNumber: string;
  billDate: string;
  dueDate: string;
  currencyCode: string;
  /**
   * When set, the bill is PO-backed: the server records the PO's ACTIVE revision and
   * auto-matches on submit (D6/A14). When omitted, this is a genuine non-PO bill — a
   * separate controlled path.
   */
  purchaseOrderId?: string;
  projectId?: string;
  lines: CreateSupplierBillLinePayload[];
}

/** Body of `POST /bills/:id/post`. The expense accounts come from each line's profile. */
export interface PostSupplierBillPayload {
  apAccountCode: string;
}

/** Body of `POST /bills/:id/reverse`. */
export interface ReverseSupplierBillPayload {
  reversalDate: string;
  reason: string;
}

// ─── Commitment ledger ───────────────────────────────────────────────────────────

export interface CommitmentLedgerEntry {
  id: string;
  stage: CommitmentStage;
  amount: Money;
  reportingAmount: Money;
  currencyCode: string;
  sourceDocumentType: CommitmentSourceDocumentType;
  sourceDocumentId: string;
  sourceRevision: number | null;
  eventType: string;
  accountingDate: ApiDate;
  occurredAt: ApiDate;
  purchaseOrderId: string | null;
  spendCategoryId: string | null;
  projectId: string | null;
  boqNodeId: string | null;
  supplierId: string | null;
}

export interface CommitmentSummary {
  committed: Money;
  accrued: Money;
  actual: Money;
}

// ─── Write payloads ──────────────────────────────────────────────────────────────
//
// Quantities and money are `number` here, not `Money`/`Quantity` (P17). Build these with
// the converters in `api/procurement-api.ts` — never by calling `Number()` on user input.

export interface CreateUomPayload {
  code: string;
  name: string;
  symbol: string;
}

export interface CreateCategoryPayload {
  code: string;
  name: string;
  parentCode?: string;
}

export interface CreateMaterialPayload {
  code: string;
  name: string;
  description?: string;
  materialCategoryCode: string;
  defaultSpendCategoryCode?: string;
  baseUomCode: string;
}

export interface CreateMrLinePayload {
  lineType: ProcurementLineType;
  materialCode?: string;
  description: string;
  /** Required even on MATERIAL lines, where the server ignores it (P7). */
  uomCode: string;
  requestedQuantity: number;
  boqNodeId?: string;
  spendCategoryId?: string;
  notes?: string;
}

export interface CreateMaterialRequestPayload {
  requestScope: MaterialRequestScope;
  projectId?: string;
  requestedDate: string;
  requiredByDate?: string;
  description?: string;
  notes?: string;
  lines: CreateMrLinePayload[];
}

export interface MrLineAllocationPayload {
  materialRequestLineId: string;
  allocatedQuantity: number;
}

export interface CreatePoLinePayload {
  lineType: ProcurementLineType;
  materialCode?: string;
  description: string;
  uomCode: string;
  orderedQuantity: number;
  unitPrice: number;
  spendCategoryId?: string;
  /**
   * Cost-target (A3/D7, no. 148). Send BOTH for a project-cost line (the `boqNodeId` must be a
   * leaf, active node on `projectId`'s baselined BOQ — the server validates), or OMIT both
   * for an org/overhead line. Half-specified is a 400: `CostTargetViolationCode`.
   */
  projectId?: string;
  boqNodeId?: string;
  notes?: string;
  mrLineAllocations?: MrLineAllocationPayload[];
}

export interface CreatePurchaseOrderPayload {
  supplierId: string;
  currencyCode: string;
  effectiveFrom: string;
  deliveryAddress?: string;
  expectedDeliveryDate?: string;
  lines: CreatePoLinePayload[];
}

/** `supplierId` is required by the DTO and discarded by the service (P13). */
export interface RevisePurchaseOrderPayload extends CreatePurchaseOrderPayload {
  reason: string;
}

export interface CreateGrnLinePayload {
  purchaseOrderLineId: string;
  receivedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity?: number;
  rejectionReason?: string;
  qualityStatus: QualityStatus;
  notes?: string;
}

export interface CreateGoodsReceiptPayload {
  purchaseOrderId: string;
  deliveryDate: string;
  deliveryNoteRef?: string;
  lines: CreateGrnLinePayload[];
}

export interface ApproveExceptionPayload {
  approvalReason: string;
}

// ─── Supplier payments (AP) ──────────────────────────────────────────────────────

/** `PaymentDocStatus` in `schema.prisma`. Shorter than a bill's — there is no SUBMITTED step. */
export type PaymentDocumentStatus = 'DRAFT' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/**
 * `GET /payments` and `GET /payments/:id`.
 *
 * Neither embeds anything. `supplier-payment.repository.ts:29,33` are bare `findFirst` and
 * `findMany`, so there is no supplier, no bank account, and — despite the controller's summary
 * reading "Get supplier payment with allocations" — **no allocations**. Names are resolved by
 * joining against the supplier and bank-account lists the screens already hold.
 */
export interface SupplierPayment {
  id: string;
  paymentNumber: string | null;
  supplierId: string;
  bankAccountId: string;
  paymentDate: ApiDate;
  accountingDate: ApiDate;
  currencyCode: string;
  totalAmount: Money;
  /**
   * ⚠ Set at creation from `allocations[]` **without any allocation row being written**
   * (A16 / #34). A payment created with allocations debits AP at post while the bill it names
   * stays fully outstanding, and no row links the two.
   *
   * The create form never sends `allocations[]` for that reason, so on anything this UI raises
   * these two are `0` and `totalAmount` until `POST /payments/:id/allocations` moves them.
   */
  allocatedAmount: Money;
  unallocatedAmount: Money;
  paymentMethod: string;
  bankReference: string | null;
  notes: string | null;
  documentStatus: PaymentDocumentStatus;
  postingStatus: BillPostingStatus;
  postedJournalEntryId: string | null;
}

/**
 * `POST /payments`.
 *
 * `allocations` is **deliberately absent**. The DTO accepts it and `supplier-payment.service.ts:62`
 * counts it into `allocatedAmount`, but no `SupplierPaymentAllocation` row is ever written and
 * the bill's `outstandingAmount` is never reduced (A16 / #34). Settlement goes through
 * `POST /payments/:id/allocations`, which does all three things correctly.
 *
 * `accountingDate` defaults to `paymentDate` server-side; it is sent explicitly so the value
 * that lands in the ledger is the one the user saw.
 */
export interface CreateSupplierPaymentPayload {
  supplierId: string;
  bankAccountId: string;
  paymentDate: string;
  accountingDate: string;
  currencyCode: string;
  totalAmount: number;
  paymentMethod: string;
  bankReference?: string;
  notes?: string;
}

/** Body of `POST /payments/:id/post`. All three are required even when a branch is unused. */
export interface PostSupplierPaymentPayload {
  apAccountCode: string;
  bankGlCode: string;
  supplierAdvanceCode: string;
}

/** Body of `POST /payments/:id/reverse`. */
export interface ReverseSupplierPaymentPayload {
  reversalDate: string;
  reason: string;
}

/**
 * Body of `POST /payments/:id/allocations` — applying a posted advance to a posted bill.
 *
 * The GL codes are resolved from the chart, not chosen by the user, exactly as they are for
 * posting. `paymentId` travels in the path rather than the body.
 */
export interface AllocateAdvancePayload {
  supplierBillId: string;
  amount: number;
  apAccountCode: string;
  supplierAdvanceCode: string;
}

/**
 * What `POST /payments/:id/allocations` returns.
 *
 * Only the journal. The `SupplierPaymentAllocation` row is created server-side and its id is
 * discarded (A17 / #35), which is why nothing can call the reversal endpoint and why Tier D
 * builds allocation without it.
 */
export interface AllocationResult {
  journalEntryId: string;
  journalNumber: string;
}

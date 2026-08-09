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
  nameAr: string | null;
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
  nameAr: string | null;
  status: MasterDataStatus;
  parentId: string | null;
  children?: MaterialCategory[];
}

export interface SpendCategory {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  status: MasterDataStatus;
  parentId: string | null;
  children?: SpendCategory[];
}

export interface Material {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
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
  requestedDate: ApiDate;
  requiredByDate: ApiDate | null;
  description: string | null;
  notes: string | null;
  lines: MaterialRequestLine[];
}

// ─── Purchase orders ─────────────────────────────────────────────────────────────

export interface PurchaseOrderSupplier {
  id: string;
  name: string;
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
  withinTolerance: boolean;
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
 * Neither `findAll` nor `findById` embeds the `supplier` relation, so only `supplierId`
 * is available and no endpoint resolves it to a name (P16 + #26).
 */
export interface SupplierBillLine {
  id: string;
  lineNumber: number;
  description: string;
  quantity: Quantity | null;
  unitPrice: Money | null;
  netAmount: Money;
  vatAmount: Money;
  grossAmount: Money;
  projectId: string | null;
  boqNodeId: string | null;
}

export interface SupplierBill {
  id: string;
  billNumber: string | null;
  supplierId: string;
  supplierInvoiceNumber: string;
  billDate: ApiDate;
  dueDate: ApiDate;
  currencyCode: string;
  status: string;
  matchStatus: BillMatchStatus;
  purchaseOrderId: string | null;
  purchaseOrderRevisionId: string | null;
  projectId: string | null;
  subtotal: Money;
  vatAmount: Money;
  totalAmount: Money;
  /** Present on detail only — `findAll` includes no lines. */
  lines?: SupplierBillLine[];
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
  nameAr?: string;
  symbol: string;
}

export interface CreateCategoryPayload {
  code: string;
  name: string;
  nameAr?: string;
  parentCode?: string;
}

export interface CreateMaterialPayload {
  code: string;
  name: string;
  nameAr?: string;
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

export interface ApprovePurchaseOrderPayload {
  reportingCurrencyCode: string;
  exchangeRate: number;
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

export interface PostGoodsReceiptPayload {
  exchangeRate: number;
  reportingCurrencyCode: string;
}

export interface ApproveExceptionPayload {
  approvalReason: string;
}

/**
 * Wire types for competitive quotations (ADR-044, spec `procurement-quotations-phase1.md` §12).
 *
 * Hand-written against the spec's endpoint table, as `lib/api-types.ts` advises for shapes the
 * backend has not published to `@erp/types`. The backend (Q1–Q8) was built concurrently with this
 * file; where the spec names a field without fixing its shape, the choice made here is recorded on
 * the field so a later diff against the controller is quick.
 *
 * Money is the decimal string the API sends (`"2350.00"`), `null` whenever the server withholds it
 * (`moneyVisible: false`) — never `"0"`.
 */

import type { ApiDate, Money, ProcurementProjectRef, Quantity } from '../types';

export type QuotationRequestStatus =
  | 'COLLECTING'
  | 'AWAITING_DECISION'
  | 'RETURNED'
  | 'AWARD_PENDING_APPROVAL'
  | 'AWARDED'
  | 'CANCELLED';

export type QuoteStatus = 'ACTIVE' | 'WITHDRAWN' | 'REJECTED';

export type QuoteCountExceptionReason = 'ONLY_ONE_SUPPLIER' | 'URGENT' | 'FRAMEWORK_SUPPLIER';

export type NonLowestReason = 'FASTER_DELIVERY' | 'BETTER_QUALITY' | 'HAS_STOCK' | 'OTHER';

export type QuoteRejectReason = 'ILLEGIBLE' | 'WRONG_ITEMS' | 'INCOMPLETE' | 'OTHER';

export type QuotationPaymentPath = 'BUYER_CASH' | 'FINANCE_PAYS_SUPPLIER';

export type QuotePhotoSource = 'CAMERA' | 'GALLERY' | 'UNKNOWN';

/** The server's verdict on waiting time: amber ≥ 2 working hours, red ≥ 4 (ADR-044 §10). */
export type SlaTone = 'none' | 'amber' | 'red';

export type QuotationQueue = 'collect' | 'returned' | 'waiting' | 'decide' | 'awarded' | 'all';

/** `GET /procurement/quotation-requests` row. */
export interface QuotationRequestRow {
  id: string;
  number: string;
  mr: { id: string; number: string; title: string | null };
  project: ProcurementProjectRef | null;
  status: QuotationRequestStatus;
  quoteCount: number;
  distinctSupplierCount: number;
  requiredQuoteCount: number;
  exceptionReason: QuoteCountExceptionReason | null;
  urgent: boolean;
  sentAt: ApiDate | null;
  /** Working minutes since `sentAt` (Sat–Thu 07:00–17:00 Mogadishu; clock minutes when urgent). */
  waitingWorkingMinutes: number | null;
  slaTone: SlaTone;
  estimateAmount: Money | null;
  lowestTotal: Money | null;
  awardedTotal: Money | null;
  moneyVisible: boolean;
}

/**
 * The list envelope. The spec says "rows"; whether they arrive bare or paged was open when this
 * was written, so the API wrapper accepts both and always hands the screens this shape.
 */
export interface QuotationRequestPage {
  items: QuotationRequestRow[];
  total: number;
}

export interface QuotePhoto {
  fileId: string;
  pageNumber: number;
  capturedAt: ApiDate | null;
  source: QuotePhotoSource;
  sha256: string;
  /** Other requests in the org carrying the same photo hash (`QR-…` numbers). */
  reusedOn: string[];
}

/** A person reference. The spec names `enteredBy` without a shape; both forms are accepted. */
export type PersonRef = { id: string; name: string | null } | string | null;

export interface Quote {
  id: string;
  store: { supplierId: string | null; name: string; registered: boolean };
  status: QuoteStatus;
  rejectReason?: QuoteRejectReason | null;
  rejectNote?: string | null;
  photos: QuotePhoto[];
  enteredTotal: Money | null;
  enteredBy?: PersonRef;
  enteredAt?: ApiDate | null;
  /** Lowest among ACTIVE quotes with a total (ties: every tied quote). Null when money is hidden. */
  isLowest: boolean | null;
  uploadedBy?: PersonRef;
  clientRef?: string | null;
  replacesQuoteId?: string | null;
  createdAt?: ApiDate;
}

export interface QuotationLine {
  id: string;
  lineNumber?: number;
  description: string;
  quantity: Quantity;
  /** Unit symbol or code. */
  uom: string | null;
  estimatedUnitPrice?: Money | null;
  /** quantity × estimatedUnitPrice, when priced and visible. */
  estimateAmount?: Money | null;
}

/** A registered supplier whose normalised name matches a new store's (ADR-044 §8). */
export interface SupplierMatch {
  quoteId: string;
  supplierId: string;
  name: string;
  code?: string | null;
}

export interface QuotationApprovalSummary {
  instanceId: string;
  status: string;
  currentStep?: { roleRequired: string; stepOrder?: number } | null;
}

/**
 * `allowedActions[]` — one per command, from the backend's `quotation-state.policy.ts` (the
 * single source for "why can't I"). Action names are matched loosely (case and separators
 * ignored) because the backend's spelling was not fixed when this was written; see
 * `findAction` in `quote-rules.ts`.
 */
export interface QuotationAllowedAction {
  action: string;
  enabled: boolean;
  reasonCode?: string | null;
}

export interface QuotationRequestDetail {
  id: string;
  number: string;
  status: QuotationRequestStatus;
  currencyCode: string | null;
  urgent: boolean;
  materialRequest: {
    id: string;
    number: string;
    title: string | null;
    requiredByDate?: ApiDate | null;
    requestedBy?: PersonRef;
  };
  project: ProcurementProjectRef | null;
  estimateAmount: Money | null;
  /** BOQ budget remaining on the MR's cost targets, when the server can say. Optional. */
  boqRemainingAmount?: Money | null;
  requiredQuoteCount: number;
  distinctSupplierCount: number;
  exceptionReason: QuoteCountExceptionReason | null;
  returnNote: string | null;
  returnedAt?: ApiDate | null;
  returnedBy?: PersonRef;
  sendCount?: number;
  sentAt: ApiDate | null;
  firstSentAt?: ApiDate | null;
  decidedAt?: ApiDate | null;
  waitingWorkingMinutes: number | null;
  slaTone: SlaTone;
  proposedQuoteId?: string | null;
  proposedPaymentPath?: QuotationPaymentPath | null;
  awardedQuoteId: string | null;
  awardedTotal: Money | null;
  awardedSupplierId?: string | null;
  awardedBy?: PersonRef;
  awardedAt?: ApiDate | null;
  paymentPath: QuotationPaymentPath | null;
  nonLowestReason?: NonLowestReason | null;
  nonLowestNote?: string | null;
  purchaseOrderId: string | null;
  createdBy?: PersonRef;
  createdAt?: ApiDate;
  lines: QuotationLine[];
  quotes: Quote[];
  supplierMatches: SupplierMatch[];
  approval: QuotationApprovalSummary | null;
  allowedActions: QuotationAllowedAction[];
  moneyVisible: boolean;
}

/** The MR detail's quotation summary (Q8). Absent on servers that predate it. */
export interface MaterialRequestQuotationSummary {
  id: string;
  status: QuotationRequestStatus;
  quoteCount: number;
  requiredQuoteCount: number;
}

// ─── Command bodies ──────────────────────────────────────────────────────────────

export interface QuotePhotoPayload {
  platformFileId: string;
  capturedAt: ApiDate;
  source: QuotePhotoSource;
}

export interface AddQuotePayload {
  clientRef: string;
  supplierId?: string;
  storeName?: string;
  photos: QuotePhotoPayload[];
}

export interface AwardPayload {
  quoteId?: string;
  paymentPath?: QuotationPaymentPath;
  nonLowestReason?: NonLowestReason;
  nonLowestNote?: string;
  acceptException?: boolean;
  awardSupplierId?: string;
}

export type OrderSplitMode = 'ESTIMATE' | 'SINGLE_LINE' | 'MANUAL';

export interface OrderDraftLine {
  materialRequestLineId: string;
  description: string;
  quantity: Quantity;
  maxQuantity: Quantity;
  uom: string | null;
  amount?: Money | null;
  unitPrice?: Money | null;
}

export interface OrderDraft {
  supplier: { id: string | null; name: string } | null;
  awardedTotal: Money | null;
  splitMode: OrderSplitMode;
  lines: OrderDraftLine[];
}

export interface RaiseOrderLine {
  materialRequestLineId: string;
  quantity: string;
  amount: string;
}

export interface RaiseOrderPayload {
  lines?: RaiseOrderLine[];
  expectedDeliveryDate?: string;
  deliveryAddress?: string;
}

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

import type { StaffAlertLogEntry } from '@erp/types';

import type { ApiDate, Money, ProcurementProjectRef, Quantity } from '../types';
import type { QuotationPayment } from './payment-types';

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

/** `pay` / `settle` are finance's Phase 3 queues (ADR-045 §6): award POs to fund, receipts to record. */
export type QuotationQueue = 'collect' | 'returned' | 'waiting' | 'decide' | 'awarded' | 'all' | 'pay' | 'settle';

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
  /**
   * ADR-045 `pay` / `settle` queues only: working minutes since payment became needed (pay: the
   * award order was issued; settle: the receipt came in / cash went out). The row carries no
   * payment state, store or remaining amount — the queue itself says what is waiting.
   */
  paymentWaitingWorkingMinutes?: number;
}

/** `GET /procurement/quotation-requests` envelope (spec §0a). */
export interface QuotationRequestPage {
  items: QuotationRequestRow[];
  page: number;
  limit: number;
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
  /** Pages on the quote — present even when `photos` is withheld (`photosVisible: false`). */
  photoCount?: number;
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
  /** Approved quantity, else requested. */
  quantity: Quantity;
  uom: { code: string; name?: string | null; symbol?: string | null } | string | null;
  estimatedUnitPrice?: Money | null;
  /** quantity × estimatedUnitPrice, when priced and visible. */
  estimatedAmount?: Money | null;
}

/** Registered suppliers whose normalised name matches a new store's (ADR-044 §8). */
export interface SupplierMatch {
  quoteId: string;
  suppliers: Array<{ id: string; code?: string | null; name: string }>;
}

/** The award's approval chain: pending while AWARD_PENDING_APPROVAL, or the one the award consumed. */
export interface QuotationApprovalSummary {
  instanceId: string;
  status: string;
  currentStepOrder: number | null;
  currentStepRole: string | null;
  steps: Array<{
    stepOrder: number;
    roleRequired: string;
    approvedBy: { id: string; name: string } | null;
    approvedAt: ApiDate | null;
  }>;
}

/** The choice awaiting DoA approval (AWARD_PENDING_APPROVAL). */
export interface QuotationProposal {
  quoteId: string;
  proposedBy?: PersonRef;
  proposedAt?: ApiDate | null;
  paymentPath: QuotationPaymentPath | null;
  nonLowestReason?: NonLowestReason | null;
  nonLowestNote?: string | null;
  supplierId?: string | null;
  acceptException?: boolean | null;
}

export interface QuotationAward {
  quoteId: string;
  total: Money | null;
  supplier: { id: string; code?: string | null; name: string } | null;
  awardedBy?: PersonRef;
  awardedAt?: ApiDate | null;
  approvalInstanceId?: string | null;
  finalApprover?: PersonRef;
  paymentPath: QuotationPaymentPath | null;
  nonLowestReason?: NonLowestReason | null;
  nonLowestNote?: string | null;
}

/** `allowedActions[].action` (spec §0a). */
export type QuotationActionName =
  | 'ADD_QUOTE'
  | 'ADD_PAGE'
  | 'WITHDRAW_QUOTE'
  | 'SEND'
  | 'REOPEN'
  | 'ENTER_TOTAL'
  | 'REJECT_QUOTE'
  | 'ASK_ANOTHER'
  | 'AWARD'
  | 'WITHDRAW_AWARD'
  | 'REQUEST_REDECISION'
  | 'RAISE_ORDER'
  | 'CANCEL';

/**
 * One per command, from the backend's state policy — the single source for "why can't I". A
 * command whose action is disabled is refused with exactly `reasonCode` (a SoD rule code for a
 * barred selector).
 */
export interface QuotationAllowedAction {
  action: QuotationActionName;
  enabled: boolean;
  reasonCode: string | null;
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
    priority?: string | null;
    status?: string;
    requestedBy?: PersonRef;
    requiredByDate?: ApiDate | null;
  };
  project: ProcurementProjectRef | null;
  estimateAmount: Money | null;
  /** BOQ budget remaining on the MR's cost targets — not on the read model yet; shown when present. */
  boqRemainingAmount?: Money | null;
  requiredQuoteCount: number;
  quoteCount?: number;
  distinctSupplierCount: number;
  exceptionReason: QuoteCountExceptionReason | null;
  exceptionAccepted?: { by: PersonRef; at: ApiDate | null } | null;
  returnNote: string | null;
  returnedAt?: ApiDate | null;
  returnedBy?: PersonRef;
  sendCount?: number;
  sentAt: ApiDate | null;
  firstSentAt?: ApiDate | null;
  decidedAt?: ApiDate | null;
  waitingWorkingMinutes: number | null;
  slaTone: SlaTone;
  lowestTotal?: Money | null;
  proposal: QuotationProposal | null;
  award: QuotationAward | null;
  purchaseOrder: { id: string; poNumber: string; status: string } | null;
  cancelledBy?: PersonRef;
  cancelledAt?: ApiDate | null;
  cancelReason?: string | null;
  createdBy?: PersonRef;
  createdAt?: ApiDate;
  lines: QuotationLine[];
  quotes: Quote[];
  supplierMatches: SupplierMatch[];
  approval: QuotationApprovalSummary | null;
  allowedActions: QuotationAllowedAction[];
  moneyVisible: boolean;
  /**
   * Quote photos show supplier prices: readable only with view:commitment-ledger (and view:procurement).
   * False → every quote's `photos` is [] and only `photoCount` remains. Independent of moneyVisible.
   */
  photosVisible?: boolean;
  /** ADR-044 phase 2 — WhatsApp alerts about the request, oldest first. Absent on older servers. */
  messages?: StaffAlertLogEntry[];
  /** ADR-045 phase 3 — paying from the award. Absent on older servers and before an award. */
  payment?: QuotationPayment | null;
}

/** The MR detail's quotation summary (Q8). Absent on servers that predate it. */
export interface MaterialRequestQuotationSummary {
  id: string;
  number?: string;
  status: QuotationRequestStatus;
  quoteCount: number;
  distinctSupplierCount?: number;
  requiredQuoteCount: number;
}

// ─── Command bodies ──────────────────────────────────────────────────────────────

export interface QuotePhotoPayload {
  platformFileId: string;
  capturedAt: ApiDate;
  source: QuotePhotoSource;
}

export interface AddQuotePayload {
  /** UUID; a replay with the same value is a no-op. */
  clientRef: string;
  supplierId?: string;
  /** ≤ 120 characters. */
  storeName?: string;
  replacesQuoteId?: string;
  /** 1–10 photos. */
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

/** Only lines with quantity still to order; `amount`/`unitPrice` are null in MANUAL mode. */
export interface OrderDraftLine {
  materialRequestLineId: string;
  lineNumber?: number;
  description: string;
  quantity: Quantity;
  maxQuantity: Quantity;
  uom: QuotationLine['uom'];
  amount?: Money | null;
  unitPrice?: Money | null;
}

export interface OrderDraft {
  quotationRequestId?: string;
  number?: string;
  supplier: { id: string | null; code?: string | null; name: string } | null;
  currencyCode?: string | null;
  awardedTotal: Money | null;
  paymentPath?: QuotationPaymentPath | null;
  splitMode: OrderSplitMode;
  lines: OrderDraftLine[];
  moneyVisible?: boolean;
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

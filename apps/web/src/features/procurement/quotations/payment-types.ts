/**
 * Wire types for paying from the award (ADR-045, spec `procurement-quotations-phase3.md` §1).
 *
 * Hand-written against the spec's endpoint tables while the backend (P1–P9) is built
 * concurrently — the Phase 1 practice (`./types.ts`). Where the spec names a field without fixing
 * its shape, the choice made here is noted on the field so a later diff against the controller is
 * quick.
 *
 * Money is the decimal string the API sends (`"980.00"`), `null` whenever the server withholds it
 * (`moneyVisible: false`) — never `"0"`. Money in request bodies is a 2-dp string, as the quotation
 * total endpoint takes it.
 */

import type { ApiDate, Money } from '../types';
import type { QuotationPaymentPath, QuotePhotoPayload } from './types';

// ─── Payment read model (§1.4) ─────────────────────────────────────────────────────

export type PaymentState =
  | 'AWAITING_ORDER'
  | 'READY_TO_PAY'
  | 'AWAITING_APPROVAL'
  | 'AWAITING_SIGNATURES'
  | 'CASH_WITH_BUYER'
  | 'WAITING_FOR_GOODS'
  | 'RECEIPT_TO_RECORD'
  | 'SETTLING'
  | 'SETTLED';

export type PaymentActionName =
  | 'RELEASE_CASH'
  | 'TOP_UP'
  | 'RECORD_RETURN'
  | 'PAY_SUPPLIER'
  | 'FINISH_PAYMENT'
  | 'PHOTOGRAPH_RECEIPT'
  | 'RECORD_RECEIPT'
  | 'CHANGE_PATH';

/** One per payment command; `reason` is the machine code saying why it is disabled. */
export interface PaymentAllowedAction {
  action: PaymentActionName;
  enabled: boolean;
  reason?: string | null;
}

export type ReceivingStatus = 'NOT_RECEIVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED';

export type PaymentShape = 'PREPAY' | 'PAY_BILL';

export interface PaymentAdvanceSummary {
  id: string;
  /** Not in the spec's list — accepted when present, so the buyer's card can say "to you". */
  recipientUserId?: string | null;
  recipientName: string | null;
  amount: Money | null;
  advancedAt: ApiDate;
  applied: Money | null;
  returned: Money | null;
  outstanding: Money | null;
  /** POSTED before ADR-045 without a journal: "Recorded before GL posting". */
  legacy: boolean;
}

export interface PaymentSupplierPaymentSummary {
  id: string;
  number: string;
  amount: Money | null;
  shape: PaymentShape | null;
  documentStatus: string;
  postingStatus: string;
}

export type StoreDocumentKind = 'RECEIPT' | 'INVOICE';
export type StoreDocumentStatus = 'SUBMITTED' | 'RECORDED' | 'REJECTED';
export type StoreDocumentRejectReason = 'ILLEGIBLE' | 'WRONG_PO' | 'DUPLICATE' | 'OTHER';

/**
 * A store document photo. The spec says `photos?` without a shape; the quote photo's
 * `{ fileId, pageNumber }` is assumed, and `platformFileId` is accepted as the id too.
 */
export interface StoreDocumentPhoto {
  fileId?: string;
  platformFileId?: string;
  pageNumber?: number;
  capturedAt?: ApiDate | null;
}

export interface StoreDocumentSummary {
  id: string;
  number: string;
  kind: StoreDocumentKind;
  status: StoreDocumentStatus;
  uploadedByName: string | null;
  /** Not in the spec's list — accepted when present (whose document it is). */
  uploadedById?: string | null;
  createdAt: ApiDate;
  /** Withheld (absent) unless the caller passes the photo rule (procurement + cost visibility). */
  photos?: StoreDocumentPhoto[];
  /** Pages on the document even when `photos` is withheld. Not in the spec; shown when present. */
  photoCount?: number;
  rejectReason?: StoreDocumentRejectReason | null;
  rejectNote?: string | null;
  /** Set once recorded into a bill (P6). Not in the §1.4 list — read when present. */
  supplierBillId?: string | null;
  billNumber?: string | null;
  enteredTotal?: Money | null;
}

export interface PaymentApprovalSummary {
  instanceId: string;
  status: string;
  currentStepRole: string | null;
}

export interface QuotationPayment {
  path: QuotationPaymentPath;
  state: PaymentState;
  purchaseOrder: { id: string; poNumber: string; status: string } | null;
  orderedAmount: Money | null;
  funded: Money | null;
  remainingToFund: Money | null;
  withBuyer: Money | null;
  /** Null when money is hidden (spec `advances*`). */
  advances: PaymentAdvanceSummary[] | null;
  payments: PaymentSupplierPaymentSummary[] | null;
  storeDocuments: StoreDocumentSummary[];
  receivingStatus: ReceivingStatus;
  approval?: PaymentApprovalSummary | null;
  allowedActions: PaymentAllowedAction[];
  moneyVisible: boolean;
  /** Working minutes since payment became needed — the queue's age. Not in §1.4; shown when present. */
  waitingWorkingMinutes?: number | null;
}

// ─── Buyer cash (§1.1) ─────────────────────────────────────────────────────────────

export type CashPaymentMethod = 'CASH' | 'MOBILE_MONEY' | 'BANK';

/**
 * A blocker on a draft endpoint. The spec says `blockers[]` of "ordered blocker codes"; a bare
 * string or `{ code, … }` is accepted.
 */
export type DraftBlocker = string | { code: string; [key: string]: unknown };

export interface BandHint {
  name: string;
  /** Role names, in order. Strings or `{ roleRequired }` objects are accepted. */
  steps: Array<string | { roleRequired?: string; role?: string; name?: string }>;
}

export interface ReleaseDraft {
  purchaseOrder: { id: string; poNumber: string; orderedAmount: Money | null };
  currencyCode: string;
  remainingToFund: Money | null;
  recipients: Array<{ userId: string; name: string; isRequestCreator: boolean }>;
  accounts: Array<{
    bankAccountId: string;
    name: string;
    glCode: string;
    method: CashPaymentMethod;
    lastUsed: boolean;
  }>;
  defaultAdvancedAt: ApiDate;
  bandHint?: BandHint | null;
  blockers: DraftBlocker[];
}

export interface ReleaseCashPayload {
  /** UUID — generated once per dialog open, reused on a retry. */
  idempotencyKey: string;
  quotationRequestId?: string;
  purchaseOrderId?: string;
  recipientUserId: string;
  amount: string;
  bankAccountId: string;
  paymentMethod: CashPaymentMethod;
  advancedAt: string;
  reference?: string;
  note?: string;
  /** Top-up: apply the new advance to this posted bill in the same command. */
  applyToBillId?: string;
}

/** `{ advance, payment }`: the posted advance and the request's payment read model. */
export interface ReleaseCashResult {
  advance?: { id: string } & Record<string, unknown>;
  payment?: QuotationPayment;
}

export interface ReverseAdvancePayload {
  reason: string;
  reversalDate: string;
}

export interface AdvanceReturnPayload {
  amount: string;
  returnMethod: CashPaymentMethod;
  destinationBankAccountId: string;
  receivedAt: string;
  reference?: string;
  note?: string;
}

// ─── Supplier payment from the award (§1.2) ───────────────────────────────────────

export interface PayDraft {
  supplier: { id: string; name: string; isVendorMaintainer: boolean; maintainerName: string | null };
  shape: PaymentShape;
  bills: Array<{ id: string; number: string; outstanding: Money | null }>;
  remainingToFund: Money | null;
  accounts: Array<{ bankAccountId: string; name: string; underDualControl: boolean; lastUsed: boolean }>;
  methods: CashPaymentMethod[];
  defaultPaymentDate: ApiDate;
  bandHint?: BandHint | null;
  blockers: DraftBlocker[];
  /** Not in the spec's list — assumed to come with the draft as the release draft's does. */
  currencyCode?: string;
}

export interface PayFromAwardPayload {
  idempotencyKey: string;
  quotationRequestId: string;
  bankAccountId: string;
  paymentMethod: CashPaymentMethod;
  paymentDate: string;
  amount: string;
  shape: PaymentShape;
  supplierBillId?: string;
  bankReference?: string;
  note?: string;
}

export interface PayFromAwardResult {
  /** The supplier payment (or, on some servers, the payment read model — both are handled). */
  payment?: Record<string, unknown>;
  awaiting?: 'APPROVAL' | 'RELEASE_SIGNATURES';
  approvalInstanceId?: string;
}

// ─── Store documents (§1.3) ────────────────────────────────────────────────────────

export interface CreateStoreDocumentPayload {
  clientRef: string;
  purchaseOrderId: string;
  kind: StoreDocumentKind;
  photos: QuotePhotoPayload[];
}

/**
 * The create / add-page response. The spec does not fix it: a store document row, or
 * `{ storeDocument }`, or a payment read model — `storeDocumentIdOf` reads all three.
 */
export type StoreDocumentCommandResult =
  | (StoreDocumentSummary & Record<string, unknown>)
  | { storeDocument: StoreDocumentSummary; payment?: QuotationPayment };

export interface RecordStoreDocumentPayload {
  storeDocumentId: string;
  total?: string;
  documentDate?: string;
  supplierInvoiceNumber?: string;
  expenseProfileCode?: string;
  note?: string;
}

export type RecordStep = 'DONE' | 'MATCH_EXCEPTION' | 'WAITING_APPROVAL';

export interface RecordStoreDocumentResult {
  storeDocument: StoreDocumentSummary;
  bill: { id: string; billNumber?: string | null; number?: string | null; outstandingAmount?: Money | null } | null;
  step: RecordStep;
  /** Amount applied from the buyer's cash (or the supplier advance). */
  applied?: Money | null;
}

export interface ChangePaymentPathPayload {
  paymentPath: QuotationPaymentPath;
  reason: string;
}

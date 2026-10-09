/**
 * Wire types for paying from the award (ADR-045, spec `procurement-quotations-phase3.md` §1).
 *
 * Reconciled with the built backend (spec §8): `quotation-payment-read-model.service.ts`,
 * `buyer-advance.service.ts`, `award-supplier-payment.service.ts`,
 * `store-document-settlement.service.ts` and `store-documents/`.
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
  | 'CHANGE_PATH'
  /** A posted prepayment not yet applied to the posted bill: apply it, never pay again. */
  | 'APPLY_PREPAYMENT';

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
  recipientUserId: string | null;
  recipientName: string | null;
  amount: Money | null;
  advancedAt: ApiDate | null;
  documentStatus?: string;
  postingStatus?: string;
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
export type StoreDocumentStatus = 'SUBMITTED' | 'RECORDED' | 'REJECTED' | 'WITHDRAWN';
export type StoreDocumentRejectReason = 'ILLEGIBLE' | 'WRONG_PO' | 'DUPLICATE' | 'OTHER';

/** A store document photo: `{ id, fileId, pageNumber }` (+ `capturedAt` on the list endpoint). */
export interface StoreDocumentPhoto {
  id?: string;
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
  /** `GET /procurement/store-documents` only (the payment block has the name alone). */
  uploadedBy?: { id: string; name: string | null };
  createdAt: ApiDate;
  /** Withheld (absent) unless the caller passes the photo rule (procurement + cost visibility). */
  photos?: StoreDocumentPhoto[];
  /** Pages on the document even when `photos` is withheld. */
  photoCount?: number;
  /** `GET /procurement/store-documents` only — the payment block does not carry them. */
  rejectReason?: StoreDocumentRejectReason | null;
  rejectNote?: string | null;
  /** Set once recorded into a bill (P6). */
  supplierBillId?: string | null;
  /** Not sent by the server today; shown when present. */
  billNumber?: string | null;
}

export interface PaymentApprovalSummary {
  instanceId: string;
  status: string;
  currentStepRole: string | null;
}

/**
 * An attempt that waits to be finished (review fix): the DoA approval, the bank signatures or the
 * post. *Release now* / *Complete the payment* call `continue.path` with no body, so any device
 * can finish it — no client-held body, no second attempt.
 */
export interface PaymentPending {
  kind: 'BUYER_ADVANCE' | 'SUPPLIER_PAYMENT';
  id: string;
  idempotencyKey: string | null;
  amount: Money | null;
  awaiting: 'APPROVAL' | 'RELEASE_SIGNATURES' | 'POSTING';
  approvalInstanceId: string | null;
  continue: { method: 'POST'; path: string };
}

export interface QuotationPayment {
  /** Absent on servers before the review fix. */
  pending?: PaymentPending[];
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
  /** Null before the award's order exists. */
  purchaseOrder: { id: string; poNumber: string; orderedAmount: Money | null } | null;
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

/** A DRAFT advance (e.g. stuck in approval) is cancelled — `reversalDate` only for a posted one. */
export interface ReverseAdvancePayload {
  reason: string;
  reversalDate?: string;
}

/** `GET /buyer-advances/readiness` — the buyer-cash set-up checklist (P14). */
export interface BuyerCashReadiness {
  ready: boolean;
  staffAdvanceProfile: boolean;
  cashAccountsWithoutSignatories: number;
  cashAccounts: Array<{ bankAccountId: string; name: string; glCode: string; currencyCode: string }>;
}

export interface AdvanceReturnPayload {
  /** One per dialog open: a double tap records one return. */
  idempotencyKey?: string;
  amount: string;
  returnMethod: CashPaymentMethod;
  destinationBankAccountId: string;
  receivedAt: string;
  reference?: string;
  note?: string;
}

// ─── Supplier payment from the award (§1.2) ───────────────────────────────────────

export type SupplierPaymentMethod = 'BANK' | 'MOBILE_MONEY';

export interface PayDraft {
  /** Null before the award's order exists. */
  supplier: { id: string; name: string; isVendorMaintainer: boolean; maintainerName: string | null } | null;
  shape: PaymentShape;
  bills: Array<{ id: string; number: string; outstanding: Money | null }>;
  remainingToFund: Money | null;
  accounts: Array<{ bankAccountId: string; name: string; glCode?: string; underDualControl: boolean; lastUsed: boolean }>;
  methods: SupplierPaymentMethod[];
  defaultPaymentDate: ApiDate;
  bandHint?: BandHint | null;
  blockers: DraftBlocker[];
  currencyCode: string;
  /** Posted prepayments on the order not yet applied to a bill (APPLY_PREPAYMENT). */
  unappliedPrepayments?: Array<{ paymentId: string; unallocated: Money }>;
}

export interface PayFromAwardPayload {
  idempotencyKey: string;
  quotationRequestId: string;
  bankAccountId: string;
  paymentMethod: SupplierPaymentMethod;
  paymentDate: string;
  amount: string;
  shape: PaymentShape;
  supplierBillId?: string;
  bankReference?: string;
  note?: string;
}

/**
 * 200 → `{ payment, awaiting?, paymentSummary }`: `payment` is the supplier payment document,
 * `paymentSummary` the request's payment block. `awaiting: 'RELEASE_SIGNATURES'` when the account
 * is under dual control. The DoA gate is a 409 `APPROVAL_REQUIRED` with `approvalInstanceId`.
 */
export interface PayFromAwardResult {
  payment?: { id: string } & Record<string, unknown>;
  awaiting?: 'RELEASE_SIGNATURES';
  paymentSummary?: QuotationPayment | null;
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
  storeDocument: { id: string; number: string; status: StoreDocumentStatus; supplierBillId: string | null };
  bill: {
    id: string;
    billNumber: string | null;
    supplierInvoiceNumber?: string | null;
    totalAmount?: Money;
    outstandingAmount?: Money;
    matchStatus?: string;
  } | null;
  step: RecordStep;
  /**
   * MATCH_EXCEPTION: why the match stopped — `ABOVE_ORDER` (the receipt is above the order) or
   * another kind. Read from `exceptionKind` or `exception.kind`, whichever the server sends.
   */
  exceptionKind?: string | null;
  exception?: { kind?: string | null } | null;
  /** What settled the bill: buyer cash (EVT-AP-008) or the prepayment (EVT-AP-005). */
  applied: Array<{ kind: 'BUYER_ADVANCE' | 'SUPPLIER_PAYMENT'; id: string; amount: Money }>;
  /** WAITING_APPROVAL: the bill's approval chain. */
  approvalInstanceId?: string;
}

export interface ChangePaymentPathPayload {
  paymentPath: QuotationPaymentPath;
  reason: string;
}

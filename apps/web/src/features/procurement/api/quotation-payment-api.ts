/**
 * Paying from the award (ADR-045, spec §1). One function per endpoint; nothing here formats or
 * decides what to render. Money commands live under Accounts Payable (`manage:payable`); store
 * document capture under procurement.
 */

import { apiClient } from '@/lib/api-client';

import type {
  AdvanceReturnPayload,
  BuyerCashReadiness,
  ChangePaymentPathPayload,
  CreateStoreDocumentPayload,
  PayDraft,
  PayFromAwardPayload,
  PayFromAwardResult,
  QuotationPayment,
  RecordStoreDocumentPayload,
  RecordStoreDocumentResult,
  ReleaseCashPayload,
  ReleaseCashResult,
  ReleaseDraft,
  ReverseAdvancePayload,
  StoreDocumentCommandResult,
  StoreDocumentRejectReason,
  StoreDocumentSummary,
} from '../quotations/payment-types';
import type { QuotationRequestDetail, QuotePhotoPayload } from '../quotations/types';

function post<T>(path: string, body?: unknown): Promise<T> {
  return apiClient<T>(path, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

// ─── Buyer cash (§1.1) ─────────────────────────────────────────────────────────────

/** `GET /buyer-advances/readiness` — Staff advances profile + a cash account without signatories. */
export function getBuyerCashReadiness(): Promise<BuyerCashReadiness> {
  return apiClient<BuyerCashReadiness>('/buyer-advances/readiness');
}

export function getReleaseDraft(quotationRequestId: string): Promise<ReleaseDraft> {
  return apiClient<ReleaseDraft>('/buyer-advances/release-draft', { params: { quotationRequestId } });
}

/** 201 `{ advance, payment }`; 409 `{ approvalInstanceId }` when gated — re-drive with the same body. */
export function releaseCash(payload: ReleaseCashPayload): Promise<ReleaseCashResult> {
  return post('/buyer-advances/release', payload);
}

export function reverseBuyerAdvance(id: string, payload: ReverseAdvancePayload): Promise<unknown> {
  return post(`/buyer-advances/${id}/reverse`, payload);
}

/** Change returned (EVT-AP-009), capped at the advance's outstanding by the server. */
export function recordAdvanceReturn(id: string, payload: AdvanceReturnPayload): Promise<unknown> {
  return post(`/buyer-advances/${id}/returns`, payload);
}

// ─── Supplier payment from the award (§1.2) ───────────────────────────────────────

export function getPayDraft(quotationRequestId: string): Promise<PayDraft> {
  return apiClient<PayDraft>('/supplier-payments/award-draft', { params: { quotationRequestId } });
}

/** Create → approve → post in one command; re-drive with the same body continues it. */
export function payFromAward(payload: PayFromAwardPayload): Promise<PayFromAwardResult> {
  return post('/supplier-payments/from-award', payload);
}

// ─── Store documents (§1.3) ────────────────────────────────────────────────────────

const STORE_DOCS = '/procurement/store-documents';

export function listStoreDocuments(purchaseOrderId: string): Promise<StoreDocumentSummary[]> {
  return apiClient<StoreDocumentSummary[]>(STORE_DOCS, { params: { purchaseOrderId } });
}

/** Idempotent on `clientRef`: a replay after a lost response returns the same document. */
export function createStoreDocument(payload: CreateStoreDocumentPayload): Promise<StoreDocumentCommandResult> {
  return post(STORE_DOCS, payload);
}

export function addStoreDocumentPhoto(id: string, payload: QuotePhotoPayload): Promise<StoreDocumentCommandResult> {
  return post(`${STORE_DOCS}/${id}/photos`, payload);
}

export function withdrawStoreDocument(id: string): Promise<unknown> {
  return post(`${STORE_DOCS}/${id}/withdraw`);
}

export function rejectStoreDocument(
  id: string,
  reason: StoreDocumentRejectReason,
  note?: string,
): Promise<unknown> {
  return post(`${STORE_DOCS}/${id}/reject`, note ? { reason, note } : { reason });
}

/** Bill → match → approve → post → settle. A re-tap with `{ storeDocumentId }` resumes. */
export function recordStoreDocument(payload: RecordStoreDocumentPayload): Promise<RecordStoreDocumentResult> {
  return post('/supplier-bills/from-store-document', payload);
}

// ─── Quotation request (§1.4) ──────────────────────────────────────────────────────

export function changePaymentPath(
  quotationRequestId: string,
  payload: ChangePaymentPathPayload,
): Promise<QuotationRequestDetail | QuotationPayment> {
  return post(`/procurement/quotation-requests/${quotationRequestId}/payment-path`, payload);
}

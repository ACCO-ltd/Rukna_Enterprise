/**
 * Competitive quotations API (ADR-044 §12). One function per endpoint under
 * `/procurement/quotation-requests`; nothing here formats or decides what to render.
 */

import { apiClient } from '@/lib/api-client';

import type {
  AddQuotePayload,
  AwardPayload,
  OrderDraft,
  QuotationQueue,
  QuotationRequestDetail,
  QuotationRequestPage,
  QuotationRequestRow,
  QuotePhotoPayload,
  QuoteRejectReason,
  QuoteCountExceptionReason,
  RaiseOrderPayload,
} from '../quotations/types';

const BASE = '/procurement/quotation-requests';

function post<T>(path: string, body?: unknown): Promise<T> {
  return apiClient<T>(path, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** The list arrives bare or paged; both become `{ items, total }`. */
export function normalizeQuotationPage(
  raw: QuotationRequestRow[] | Partial<QuotationRequestPage> & { data?: QuotationRequestRow[] } | null | undefined,
): QuotationRequestPage {
  if (Array.isArray(raw)) return { items: raw, total: raw.length };
  const items = raw?.items ?? raw?.data ?? [];
  return { items, total: typeof raw?.total === 'number' ? raw.total : items.length };
}

export interface QuotationListFilters {
  queue: QuotationQueue;
  projectId?: string;
  q?: string;
  page?: number;
}

export async function listQuotationRequests(
  filters: QuotationListFilters,
): Promise<QuotationRequestPage> {
  const params: Record<string, string> = { queue: filters.queue };
  if (filters.projectId) params.projectId = filters.projectId;
  if (filters.q) params.q = filters.q;
  if (filters.page) params.page = String(filters.page);
  const raw = await apiClient<Parameters<typeof normalizeQuotationPage>[0]>(BASE, { params });
  return normalizeQuotationPage(raw);
}

export function getQuotationRequest(id: string): Promise<QuotationRequestDetail> {
  return apiClient<QuotationRequestDetail>(`${BASE}/${id}`);
}

/** Opens (or returns the existing live) request for an approved MR. */
export function openQuotationRequest(materialRequestId: string): Promise<QuotationRequestDetail> {
  return post(BASE, { materialRequestId });
}

/** Idempotent on `clientRef` — a replay returns the first quote. */
export function addQuote(id: string, payload: AddQuotePayload): Promise<QuotationRequestDetail> {
  return post(`${BASE}/${id}/quotes`, payload);
}

export function addQuotePhoto(
  id: string,
  quoteId: string,
  payload: QuotePhotoPayload,
): Promise<QuotationRequestDetail> {
  return post(`${BASE}/${id}/quotes/${quoteId}/photos`, payload);
}

export function withdrawQuote(id: string, quoteId: string): Promise<QuotationRequestDetail> {
  return post(`${BASE}/${id}/quotes/${quoteId}/withdraw`);
}

export function sendQuotationRequest(
  id: string,
  exceptionReason?: QuoteCountExceptionReason,
): Promise<QuotationRequestDetail> {
  return post(`${BASE}/${id}/send`, exceptionReason ? { exceptionReason } : {});
}

export function reopenQuotationRequest(id: string, reason: string): Promise<QuotationRequestDetail> {
  return post(`${BASE}/${id}/reopen`, { reason });
}

export function enterQuoteTotal(
  id: string,
  quoteId: string,
  total: string,
): Promise<QuotationRequestDetail> {
  return apiClient<QuotationRequestDetail>(`${BASE}/${id}/quotes/${quoteId}/total`, {
    method: 'PUT',
    body: JSON.stringify({ total }),
  });
}

export function rejectQuote(
  id: string,
  quoteId: string,
  reason: QuoteRejectReason,
  note?: string,
): Promise<QuotationRequestDetail> {
  return post(`${BASE}/${id}/quotes/${quoteId}/reject`, note ? { reason, note } : { reason });
}

export function askForAnotherQuote(id: string, note: string): Promise<QuotationRequestDetail> {
  return post(`${BASE}/${id}/ask-another`, { note });
}

/** 200 → AWARDED; 409 `{ approvalInstanceId }` → routed for approval (ADR-015 re-drive). */
export function awardQuotation(id: string, payload: AwardPayload): Promise<QuotationRequestDetail> {
  return post(`${BASE}/${id}/award`, payload);
}

export function withdrawAward(id: string): Promise<QuotationRequestDetail> {
  return post(`${BASE}/${id}/withdraw-award`);
}

export function requestRedecision(id: string, reason: string): Promise<QuotationRequestDetail> {
  return post(`${BASE}/${id}/request-redecision`, { reason });
}

export function getOrderDraft(id: string): Promise<OrderDraft> {
  return apiClient<OrderDraft>(`${BASE}/${id}/order-draft`);
}

export function raiseOrder(
  id: string,
  payload: RaiseOrderPayload = {},
): Promise<{ purchaseOrderId: string }> {
  return post(`${BASE}/${id}/raise-order`, payload);
}

export function cancelQuotationRequest(id: string, reason: string): Promise<QuotationRequestDetail> {
  return post(`${BASE}/${id}/cancel`, { reason });
}

import type { DownloadUrlResponse } from '@/features/files/api/files-api';
import { apiClient } from '@/lib/api-client';

import type { ReceiptPaymentMethod } from '@/lib/api-types';

import type { Receipt, ReceiptAllocation, ReceiptDetail } from '../types';

/**
 * ─── ACC-SET-001 receipt flow ───────────────────────────────────────────────────
 *
 * A receipt is recorded (`POST /receipts`), then **posted to the GL** and allocated against
 * **ClientInvoices** through `/customer-receipts`. There is no direct receipt→IPC allocation
 * anymore — an IPC's payment status is derived from the invoice raised off it.
 *
 * Every verb is on `/customer-receipts` — one receipts module (the legacy finance `/receipts`
 * module was retired in ACC-SET-001 BE-2).
 */

/** Body accepted by `POST /receipts`, mirroring CreateReceiptDto. */
export interface CreateReceiptPayload {
  clientId: string;
  receiptDate: string;
  amount: string;
  currency: string;
  paymentMethod?: ReceiptPaymentMethod;
  reference?: string;
  notes?: string;
}

/** One invoice allocation line — `amount` is a JS number (server DTO uses `@IsNumber`). */
export interface ReceiptAllocationInput {
  clientInvoiceId: string;
  amount: number;
}

/**
 * Body for `POST /customer-receipts/:id/post`: the registered bank account the money landed in
 * (RC-3; AR and unapplied-cash accounts resolve server-side by role, ACC-POST-001) and optional
 * `allocations` settling invoices at post time; the rest stays on account.
 */
export interface PostReceiptPayload {
  bankAccountId: string;
  allocations?: ReceiptAllocationInput[];
}

/** Body for `POST /customer-receipts/:id/allocations` — a subsequent allocation. */
export interface AllocateToInvoicePayload {
  clientInvoiceId: string;
  amount: number;
}

/**
 * `GET /customer-receipts`, optionally scoped to one client and/or one project (ADR-043 Phase 2:
 * receipts allocated to any invoice of the project). Newest receipt date first.
 */
export function listReceipts(clientId?: string, projectId?: string): Promise<Receipt[]> {
  const params: Record<string, string> = {};
  if (clientId) params.clientId = clientId;
  if (projectId) params.projectId = projectId;
  return apiClient<Receipt[]>('/customer-receipts', {
    ...(Object.keys(params).length > 0 ? { params } : {}),
  });
}

/** `GET /customer-receipts/:id` — the receipt with its invoice allocations. */
export function getReceipt(id: string): Promise<ReceiptDetail> {
  return apiClient<ReceiptDetail>(`/customer-receipts/${id}`);
}

/** `POST /customer-receipts` — record a receipt (NOT_POSTED until it is posted to the GL). */
export function createReceipt(payload: CreateReceiptPayload): Promise<Receipt> {
  return apiClient<Receipt>('/customer-receipts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** ADR-046 §6 — the body of `POST /customer-receipts/receive`. */
export interface ReceivePaymentPayload extends CreateReceiptPayload {
  bankAccountId: string;
  allocations: ReceiptAllocationInput[];
}

/**
 * ADR-046 §6 — `POST /customer-receipts/receive`: the payment lands in the chosen bank account,
 * posted and applied in one action. Returns the posted, numbered receipt.
 */
export function receivePayment(payload: ReceivePaymentPayload): Promise<Receipt> {
  return apiClient<Receipt>('/customer-receipts/receive', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** `POST /customer-receipts/:id/post` — Dr Bank / Cr AR (+ Cr Unapplied), atomic with allocations. */
export function postReceipt(id: string, payload: PostReceiptPayload): Promise<Receipt> {
  return apiClient<Receipt>(`/customer-receipts/${id}/post`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** `POST /customer-receipts/:id/allocations` — allocate part of a posted receipt to an invoice. */
export function allocateToInvoice(
  receiptId: string,
  payload: AllocateToInvoicePayload,
): Promise<ReceiptAllocation> {
  return apiClient<ReceiptAllocation>(`/customer-receipts/${receiptId}/allocations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** `POST /customer-receipts/:id/allocations/:allocationId/reverse` — reverse one allocation. */
export function reverseAllocation(receiptId: string, allocationId: string): Promise<void> {
  return apiClient<void>(
    `/customer-receipts/${receiptId}/allocations/${allocationId}/reverse`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

/** `POST /customer-receipts/:id/cancel` — RC-5: set aside a receipt that was never posted. */
export function cancelReceipt(receiptId: string, payload: { reason: string }): Promise<ReceiptDetail> {
  return apiClient<ReceiptDetail>(`/customer-receipts/${receiptId}/cancel`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * `POST /customer-receipts/:id/reverse` — AR-2: undo a posted receipt (a bounced cheque, money
 * booked to the wrong client). A mirror journal on the reversal date; the invoices it paid owe
 * again. Refused while the receipt has applications made after posting (undo those first).
 */
export function reverseReceipt(receiptId: string, payload: { reversalDate: string; reason: string }): Promise<void> {
  return apiClient<void>(`/customer-receipts/${receiptId}/reverse`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * `GET /customer-receipts/:id/document` — the branded receipt PDF's short-lived signed download
 * URL, rendered on first request. Only a POSTED, numbered, non-reversed receipt has one (409
 * NOT_POSTED / RECEIPT_REVERSED otherwise). Fetch fresh on every open — the URL expires.
 */
export function getReceiptDocument(id: string): Promise<DownloadUrlResponse> {
  return apiClient<DownloadUrlResponse>(`/customer-receipts/${id}/document`);
}

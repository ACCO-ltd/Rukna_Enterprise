import { apiClient } from '@/lib/api-client';

import type { Receipt, ReceiptAllocation, ReceiptDetail } from '../types';

/** Body accepted by `POST /receipts`, mirroring CreateReceiptDto. */
export interface CreateReceiptPayload {
  clientId: string;
  receiptDate: string;
  amount: string;
  currency: string;
  exchangeRate?: string;
  reference?: string;
  notes?: string;
}

/**
 * Body accepted by `POST /receipts/:id/allocations`.
 *
 * The server checks two things: that the certificate belongs to the caller's organization,
 * and that the running total will not exceed the receipt amount
 * (`finance.service.ts:52-70`). It does NOT check that the certificate belongs to the
 * receipt's client, that the currencies match, or that the allocation is positive — see
 * C16. The picker and `allocationProblem` cover all three before the request is sent.
 */
export interface AllocateReceiptPayload {
  certificateId: string;
  allocatedAmount: string;
}

/** `GET /receipts`, optionally scoped to one client. Newest receipt date first. */
export function listReceipts(clientId?: string): Promise<Receipt[]> {
  return apiClient<Receipt[]>('/receipts', {
    ...(clientId ? { params: { clientId } } : {}),
  });
}

/** Returns the receipt with its allocations, newest first. */
export function getReceipt(id: string): Promise<ReceiptDetail> {
  return apiClient<ReceiptDetail>(`/receipts/${id}`);
}

export function createReceipt(payload: CreateReceiptPayload): Promise<Receipt> {
  return apiClient<Receipt>('/receipts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function allocateReceipt(
  receiptId: string,
  payload: AllocateReceiptPayload,
): Promise<ReceiptAllocation> {
  return apiClient<ReceiptAllocation>(`/receipts/${receiptId}/allocations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Answers 200 with an empty body — the service returns void (B6 family). */
export function removeAllocation(receiptId: string, allocationId: string): Promise<void> {
  return apiClient<void>(`/receipts/${receiptId}/allocations/${allocationId}`, {
    method: 'DELETE',
  });
}

import { apiClient } from '@/lib/api-client';

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
  reference?: string;
  notes?: string;
}

/** One invoice allocation line — `amount` is a JS number (server DTO uses `@IsNumber`). */
export interface ReceiptAllocationInput {
  clientInvoiceId: string;
  amount: number;
}

/**
 * Body for `POST /customer-receipts/:id/post`.
 *
 * The bank account (which account received the cash) is chosen explicitly via its GL code. AR
 * control and unapplied-cash accounts are resolved server-side by role (ACC-POST-001), so no
 * other account codes are sent. Optional `allocations` settle invoices at post time; anything
 * left over lands in Unapplied and can be allocated later.
 */
export interface PostReceiptPayload {
  bankAccountCode: string;
  allocations?: ReceiptAllocationInput[];
}

/** Body for `POST /customer-receipts/:id/allocations` — a subsequent allocation. */
export interface AllocateToInvoicePayload {
  clientInvoiceId: string;
  amount: number;
}

/** `GET /customer-receipts`, optionally scoped to one client. Newest receipt date first. */
export function listReceipts(clientId?: string): Promise<Receipt[]> {
  return apiClient<Receipt[]>('/customer-receipts', {
    ...(clientId ? { params: { clientId } } : {}),
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

/**
 * ─── Client invoices (AR) ───────────────────────────────────────────────────────
 *
 * One function per endpoint, written against
 * `apps/api/src/business/accounting/accounts-receivable/` rather than `api-reference.md`
 * §6.18 — the reference's account codes are 4-digit and the seeded chart is 5-digit (A8), so
 * a body copied from it answers 404.
 *
 * ─── Where these live ───────────────────────────────────────────────────────────
 *
 * `@Controller('invoices')`. Sprint 4 recorded Client Invoices as blocked by the `/receipts`
 * route collision (#24); that was never true of this controller, which has always been mounted
 * on its own path. Only customer receipts were shadowed.
 *
 * Nothing here formats or translates. Money arrives as decimal strings and is passed through
 * untouched; screens parse it with `src/lib/money.ts`.
 */

import { apiClient } from '@/lib/api-client';

import type {
  ClientInvoice,
  GenerateInvoicePayload,
  PostInvoicePayload,
  ReverseInvoicePayload,
} from '../types';

/** Strips `undefined` so an absent filter is not sent as the string "undefined". */
function queryParams(input: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/**
 * `GET /invoices` — every invoice in the organisation, newest first by `invoiceDate`.
 *
 * `clientId` is the only filter the controller accepts. There is no status filter, no date
 * range and no pagination, so a status tab filters in the browser.
 *
 * ⚠ The rows embed **no `client` relation** (`client-invoice.repository.ts:37`). P16 fixed
 * exactly this for supplier bills by including `supplier`; AR did not get the same treatment,
 * so the client name has to be joined from `GET /clients`. Raised for Abdulsalam.
 */
export function listInvoices(clientId?: string): Promise<ClientInvoice[]> {
  return apiClient<ClientInvoice[]>('/invoices', {
    params: queryParams({ clientId }),
  });
}

/**
 * `GET /invoices/:id`.
 *
 * Returns the same bare shape as the list — there is no detail projection, no lines and no
 * allocations. An invoice's amounts come from the IPC it was generated from, so there is
 * nothing line-shaped to fetch.
 */
export function getInvoice(id: string): Promise<ClientInvoice> {
  return apiClient<ClientInvoice>(`/invoices/${id}`);
}

/**
 * `POST /invoices/from-ipc` — the only way an invoice comes into existence.
 *
 * There is no blank create endpoint. The server requires the IPC to exist and be
 * `isEffective` (400 otherwise), and enforces one invoice per IPC — a second attempt answers
 * **409**, which the billing card treats as "already invoiced" rather than as a failure.
 *
 * The new invoice is DRAFT and NOT_POSTED, and its `invoiceNumber` is **null**: the `INV-`
 * sequence is only drawn inside the posting transaction.
 */
export function generateInvoiceFromIpc(
  payload: GenerateInvoicePayload,
): Promise<ClientInvoice> {
  return apiClient<ClientInvoice>('/invoices/from-ipc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * `POST /invoices/:id/approve` — DRAFT → APPROVED. No body.
 *
 * One-way: nothing returns an approved invoice to DRAFT, and a second call answers 400.
 * This moves `documentStatus` only; the invoice is still unposted afterwards.
 */
export function approveInvoice(id: string): Promise<ClientInvoice> {
  return apiClient<ClientInvoice>(`/invoices/${id}/approve`, { method: 'POST' });
}

/**
 * `POST /invoices/:id/post` — writes the journal and assigns the invoice number.
 *
 * The body carries GL account **codes**, not ids. Build it with `planInvoicePost`, which
 * resolves them from the chart of accounts and returns the preview from the same resolution —
 * so what the confirm dialog showed is exactly what is sent.
 *
 * Requires `documentStatus: 'APPROVED'`. `canPost` in `invoice-actions.ts` gates this more
 * tightly than the server does, and deliberately so — see the note there.
 */
export function postInvoice(
  id: string,
  payload: PostInvoicePayload,
): Promise<ClientInvoice> {
  return apiClient<ClientInvoice>(`/invoices/${id}/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * `POST /invoices/:id/reverse` — raises a mirrored journal. Neither entry is removed.
 *
 * No account codes: the reversal is built from the original journal's own lines, so it cannot
 * disagree with what was posted.
 *
 * Refused with a 400 while any receipt is allocated against the invoice. Allocations are not
 * on the invoice payload, so the UI cannot pre-empt that one and surfaces the message instead.
 */
export function reverseInvoice(
  id: string,
  payload: ReverseInvoicePayload,
): Promise<ClientInvoice> {
  return apiClient<ClientInvoice>(`/invoices/${id}/reverse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

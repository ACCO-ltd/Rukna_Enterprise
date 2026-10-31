import type {
  CommercialInvoiceDocumentResponse,
  CommercialIssueInvoiceResponse,
  CommercialPreparePackageRequest,
  CommercialPreparePackageResponse,
  CommercialPreparePreviewResponse,
} from '@erp/types';

import { apiClient } from '@/lib/api-client';

/**
 * The client invoice as a document inside a project's Commercial tab (commercial-tab redesign,
 * decision D1): Prepare creates drafts only; Issue approves, numbers and posts in one command.
 *
 * Every shape comes from `@erp/types`. Money is a decimal string, null when the viewer cannot see
 * financials — the page renders the hidden state, never `$0`.
 */

const base = (projectId: string) => `/projects/${projectId}/commercial`;

/** The invoice as a document — the same data the PDF is drawn from. */
export function getInvoiceDocument(
  projectId: string,
  invoiceId: string,
): Promise<CommercialInvoiceDocumentResponse> {
  return apiClient<CommercialInvoiceDocumentResponse>(`${base(projectId)}/invoices/${invoiceId}`);
}

/** What preparing this stage would invoice: stage amount, eligible variations, blocker. */
export function getPreparePreview(
  projectId: string,
  installmentId: string,
): Promise<CommercialPreparePreviewResponse> {
  return apiClient<CommercialPreparePreviewResponse>(
    `${base(projectId)}/installments/${installmentId}/prepare-preview`,
  );
}

/** Creates the stage's draft invoice (and one draft per selected variation). Nothing is posted. */
export function preparePackage(
  projectId: string,
  installmentId: string,
  payload: CommercialPreparePackageRequest,
): Promise<CommercialPreparePackageResponse> {
  return apiClient<CommercialPreparePackageResponse>(
    `${base(projectId)}/installments/${installmentId}/prepare-package`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

/** Approve + number + post the draft and every draft of its package, in one transaction. */
export function issueInvoice(
  projectId: string,
  invoiceId: string,
): Promise<CommercialIssueInvoiceResponse> {
  return apiClient<CommercialIssueInvoiceResponse>(
    `${base(projectId)}/invoices/${invoiceId}/issue`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

/** Cancels a NOT_POSTED draft (and its package drafts), releasing variation allocations. */
export function deleteDraftInvoice(projectId: string, invoiceId: string): Promise<unknown> {
  return apiClient(`${base(projectId)}/invoices/${invoiceId}`, { method: 'DELETE' });
}

// ─── Credit notes ────────────────────────────────────────────────────────────
//
// AR-1: one route for every invoice, project or not — `/invoices/:invoiceId/credit-notes` (Finance
// owns credit notes; a hand-typed sale has no project to mount them under).

export type CreditNoteReason = 'OMISSION' | 'PRICE_ERROR' | 'CORRECTION';

export interface CreateInvoiceCreditNotePayload {
  reason: CreditNoteReason;
  /** Decimal string. */
  netAmount: string;
  /** yyyy-MM-dd. */
  accountingDate: string;
  note?: string;
}

export interface InvoiceCreditNote {
  id: string;
  creditNoteNumber: string | null;
  reason: CreditNoteReason | 'NEGATIVE_VARIATION';
  netAmount: string;
  totalAmount: string;
  accountingDate: string;
  postingStatus: 'NOT_POSTED' | 'PENDING' | 'POSTED' | 'FAILED' | 'REVERSED';
  note: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
}

/** The credit notes raised against an invoice, oldest first. */
export function listInvoiceCreditNotes(invoiceId: string): Promise<InvoiceCreditNote[]> {
  return apiClient<InvoiceCreditNote[]>(`/invoices/${invoiceId}/credit-notes`);
}

export function createInvoiceCreditNote(
  invoiceId: string,
  payload: CreateInvoiceCreditNotePayload,
): Promise<{ id: string; postingStatus: string }> {
  return apiClient<{ id: string; postingStatus: string }>(
    `/invoices/${invoiceId}/credit-notes`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

/** Posts the credit note: numbers it, writes its journal and reduces the invoice balance. */
export function postInvoiceCreditNote(
  invoiceId: string,
  creditNoteId: string,
): Promise<{ id: string; postingStatus: string; creditNoteNumber: string | null }> {
  return apiClient<{ id: string; postingStatus: string; creditNoteNumber: string | null }>(
    `/invoices/${invoiceId}/credit-notes/${creditNoteId}/post`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

/**
 * Reverses a posted credit note (EVT-AR-008): a mirror journal on the reversal date, and the
 * invoice balance restored. The reason is mandatory.
 */
export function reverseInvoiceCreditNote(
  invoiceId: string,
  creditNoteId: string,
  payload: { reversalDate: string; reason: string },
): Promise<{ id: string; postingStatus: string }> {
  return apiClient<{ id: string; postingStatus: string }>(
    `/invoices/${invoiceId}/credit-notes/${creditNoteId}/reverse`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

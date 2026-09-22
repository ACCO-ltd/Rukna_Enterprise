import type {
  CommercialBillingResponse,
  CommercialBillingPackagesResponse,
  CommercialBillStageResult,
  CertifiedInvoicedByVariationResponse,
  CommercialApplicationsResponse,
  CommercialCurrentCycleResponse,
  CommercialOverviewResponse,
  CommercialSummaryResponse,
  DepositAccountOption,
  ExtensionOfTimeListResponse,
  ExtensionOfTimeResponse,
  GrantExtensionOfTimeRequest,
  RecordProjectPaymentResult,
  SeparateChargesResponse,
  VariationOrderListResponse,
  VariationOrderResponse,
} from '@erp/types';

import { apiClient } from '@/lib/api-client';

/**
 * Commercial workspace API client (ADR-017, Gate B/C).
 *
 * Every shape comes from `@erp/types`. All money is a decimal **string** and every metric
 * carries a `state` (`OK | ZERO | UNAVAILABLE | RESTRICTED | FAILED`) — the UI renders the
 * server's verdict and never rebuilds a financial figure or a lifecycle rule (CONST-COM).
 */

/** Slice 7 — authoritative commercial overview read model. */
export function getCommercialOverview(projectId: string): Promise<CommercialOverviewResponse> {
  return apiClient<CommercialOverviewResponse>(`/projects/${projectId}/commercial/overview`);
}

/** Permission-aware commercial summary for a project. */
export function getCommercialSummary(projectId: string): Promise<CommercialSummaryResponse> {
  return apiClient<CommercialSummaryResponse>(`/projects/${projectId}/commercial/summary`);
}

export function getCommercialCurrentCycle(
  projectId: string,
): Promise<CommercialCurrentCycleResponse> {
  return apiClient<CommercialCurrentCycleResponse>(
    `/projects/${projectId}/commercial/current-cycle`,
  );
}

/**
 * The project's billing position — invoices, receipts, ageing and unapplied cash.
 *
 * Everything is on the invoice-total (VAT-inclusive) basis and comes pre-classified: the browser
 * never decides whether an invoice is overdue or how much of it is settled.
 */
export function getCommercialBilling(projectId: string): Promise<CommercialBillingResponse> {
  return apiClient<CommercialBillingResponse>(`/projects/${projectId}/commercial/billing`);
}

/** The IPA → IPC → invoice → settlement chain for a project. */
export function getCommercialApplications(
  projectId: string,
): Promise<CommercialApplicationsResponse> {
  return apiClient<CommercialApplicationsResponse>(
    `/projects/${projectId}/commercial/applications`,
  );
}

// ─── Stage billing & Billing Packages (ADR-030 CD10 / C5–C6) ────────────────────
//
// "Bill this stage" bills a milestone installment and, in the same command, each included
// client-approved variation's REMAINING net — additions on their own standalone invoice, an
// omission netted into the milestone stage. The server owns every money rule (idempotent skip of
// already-realized VOs, the "already invoiced ⇒ credit note required" 400): the UI carries the
// installment/date fields and the include flags, and surfaces the server's verdict verbatim.

export interface BillStagePayload {
  installmentId: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms?: string;
  selectedVariationIds: string[];
}

/** Bill a milestone stage plus its included variations. Returns the freshly-composed Billing Package. */
export function billStage(
  projectId: string,
  payload: BillStagePayload,
): Promise<CommercialBillStageResult> {
  return apiClient<CommercialBillStageResult>(`/projects/${projectId}/commercial/bill-stage`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * The grouped stage-billing story for a contract (S-VB-7): one Billing Package per installment that
 * has a milestone invoice or at least one variation allocation. Money fields are null when the
 * caller lacks financial visibility (`financialsVisible === false`) — RESTRICTED, never $0.
 */
export function getCommercialBillingPackages(
  projectId: string,
  contractId: string,
): Promise<CommercialBillingPackagesResponse> {
  return apiClient<CommercialBillingPackagesResponse>(
    `/projects/${projectId}/commercial/billing-packages?contractId=${encodeURIComponent(contractId)}`,
  );
}

// ─── Variations & Change Orders (ADR-026 Phase 1 · variation-collapse) ───────────
//
// Contract-scoped. Every figure here (net price, contract value) is derived by the server; the
// UI renders it and never re-computes a rule. Variations are now created ONLY via the BOQ
// "Add Extra Work" drawer (which creates AND adopts in one step); the approval workflow was
// removed. The one operative lifecycle command that remains here is `reverse` — un-adopting an
// unbilled adopted variation. Read paths (list/detail/certified-invoiced) are unchanged.

/** A single variation line the UI collects (additions and signed-negative omissions). */
export interface VariationLinePayload {
  description: string;
  /** May be negative to express an omission (CONST-VAR-002). */
  quantity: number;
  unitRate: number;
}

export interface UpdateVariationLinePayload {
  description?: string;
  quantity?: number;
  unitRate?: number;
  sortOrder?: number;
}

export function listVariations(contractId: string): Promise<VariationOrderListResponse> {
  return apiClient<VariationOrderListResponse>(`/contracts/${contractId}/variations`);
}

export function getVariation(id: string): Promise<VariationOrderResponse> {
  return apiClient<VariationOrderResponse>(`/variations/${id}`);
}

/**
 * Certified & invoiced value to date, decomposed base-scope + per-VO (ADR-026 CONST-VAR-008,
 * Phase 3). Money fields are `string | null`: null exactly when the caller lacks
 * `financialPositionView` (`canViewFinancials === false`). Reconciliation (base + Σ byVariation =
 * total) holds by construction on the server; the UI renders it, never recomputes it.
 */
export function getCertifiedInvoicedByVariation(
  contractId: string,
): Promise<CertifiedInvoicedByVariationResponse> {
  return apiClient<CertifiedInvoicedByVariationResponse>(
    `/contracts/${contractId}/variations/certified-invoiced`,
  );
}

export function addVariationLine(
  variationId: string,
  payload: VariationLinePayload & { sortOrder?: number },
): Promise<VariationOrderResponse> {
  return apiClient<VariationOrderResponse>(`/variations/${variationId}/lines`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateVariationLine(
  variationId: string,
  lineId: string,
  payload: UpdateVariationLinePayload,
): Promise<VariationOrderResponse> {
  return apiClient<VariationOrderResponse>(`/variations/${variationId}/lines/${lineId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function removeVariationLine(
  variationId: string,
  lineId: string,
): Promise<VariationOrderResponse> {
  return apiClient<VariationOrderResponse>(`/variations/${variationId}/lines/${lineId}`, {
    method: 'DELETE',
  });
}

/**
 * Reverse (un-adopt) an adopted variation (variation-collapse). Lowers the contract value, removes
 * its BOQ scope and marks it WITHDRAWN. The server is the sole authority for the "is this reversible"
 * rule: it returns `409` when the VO is not CLIENT_APPROVED, not adopted, or already billed — the UI
 * surfaces that message verbatim and re-implements no rule. `reason` is optional (audit note).
 */
export function reverseVariation(
  id: string,
  payload: { reason?: string } = {},
): Promise<VariationOrderResponse> {
  return apiClient<VariationOrderResponse>(`/variations/${id}/reverse`, {
    method: 'POST',
    body: JSON.stringify(payload.reason ? { reason: payload.reason } : {}),
  });
}

// ─── Extension of Time (ADR-026 Phase 4) ────────────────────────────────────────

export function listExtensionsOfTime(contractId: string): Promise<ExtensionOfTimeListResponse> {
  return apiClient<ExtensionOfTimeListResponse>(`/contracts/${contractId}/extension-of-time`);
}

export function grantExtensionOfTime(
  contractId: string,
  payload: GrantExtensionOfTimeRequest,
): Promise<ExtensionOfTimeResponse> {
  return apiClient<ExtensionOfTimeResponse>(`/contracts/${contractId}/extension-of-time`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─── Slice 3B — Commercial readiness (mark/revoke installment ready to bill) ─────

export function markInstallmentReadyToBill(
  projectId: string,
  installmentId: string,
  note?: string,
) {
  return apiClient(`/projects/${projectId}/commercial/installments/${installmentId}/ready-to-bill`, {
    method: 'POST',
    body: JSON.stringify(note ? { note } : {}),
  });
}

export function revokeInstallmentReadiness(
  projectId: string,
  installmentId: string,
  reason?: string,
) {
  return apiClient(`/projects/${projectId}/commercial/installments/${installmentId}/ready-to-bill`, {
    method: 'DELETE',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

// ─── Slice 4B — Issue billing package, package delivery, patch DRAFT invoice ─────

export interface IssuePackagePayload {
  invoiceDate: string;
  dueDate: string;
  paymentTerms?: string;
  notes?: string;
  selectedVariationIds: string[];
}

/** Issue (approve + post) the billing package for a milestone installment atomically. */
export function issuePackage(
  projectId: string,
  installmentId: string,
  payload: IssuePackagePayload,
): Promise<import('@erp/types').CommercialBillingPackage> {
  return apiClient(
    `/projects/${projectId}/commercial/installments/${installmentId}/issue-package`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export interface RecordPackageDeliveryPayload {
  method: 'WHATSAPP' | 'EMAIL' | 'PHYSICAL' | 'OTHER';
  sentAt: string;
  recipient?: string;
  note?: string;
}

/** Record a send-to-client delivery event for every invoice in the billing package. */
export function recordPackageDelivery(
  projectId: string,
  installmentId: string,
  payload: RecordPackageDeliveryPayload,
): Promise<{ deliveries: import('@erp/types').CommercialDeliveryRecord[] }> {
  return apiClient(
    `/projects/${projectId}/commercial/installments/${installmentId}/package-deliveries`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

/** Fetch a fresh, short-lived URL for the branded PDF of an issued client invoice. */
export function getIssuedInvoiceDocument(invoiceId: string): Promise<{ url: string }> {
  return apiClient<{ url: string }>(`/invoices/${invoiceId}/document`);
}

export interface PatchDraftInvoicePayload {
  dueDate?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
}

/** Update dueDate / paymentTerms / notes on a NOT_POSTED (DRAFT) invoice. */
export function patchDraftInvoice(
  projectId: string,
  invoiceId: string,
  payload: PatchDraftInvoicePayload,
) {
  return apiClient(`/projects/${projectId}/commercial/invoices/${invoiceId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

// ─── Slice 5B — Record project payment + deposit account list ────────────────

export interface RecordProjectPaymentPayload {
  bankAccountId: string;
  receiptDate: string;
  amount: string;
  currency: string;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
  allocations: Array<{ clientInvoiceId: string; amount: number }>;
}

export function recordProjectPayment(
  projectId: string,
  payload: RecordProjectPaymentPayload,
): Promise<RecordProjectPaymentResult> {
  return apiClient<RecordProjectPaymentResult>(
    `/projects/${projectId}/commercial/billing/payment`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export function getProjectDepositAccounts(projectId: string): Promise<DepositAccountOption[]> {
  return apiClient<DepositAccountOption[]>(`/projects/${projectId}/commercial/deposit-accounts`);
}

// ─── Slice 6B — Collection Events + Credit Notes ─────────────────────────────
//
// All endpoints are guarded by `receivablesManage` on the server.

export interface RecordFollowUpPayload {
  invoiceId: string;
  method: 'WHATSAPP' | 'EMAIL' | 'PHONE' | 'PHYSICAL' | 'OTHER';
  contactPerson?: string;
  note?: string;
  /** ISO datetime */
  occurredAt: string;
}

export function recordFollowUp(
  projectId: string,
  payload: RecordFollowUpPayload,
): Promise<{ id: string }> {
  return apiClient<{ id: string }>(`/projects/${projectId}/commercial/follow-ups`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface RecordPromisePayload {
  invoiceId: string;
  /** YYYY-MM-DD — does NOT replace the invoice dueDate */
  promisedDate: string;
  /** Decimal string — optional committed amount */
  promisedAmount?: string;
  note?: string;
}

export function recordPromise(
  projectId: string,
  payload: RecordPromisePayload,
): Promise<{ id: string }> {
  return apiClient<{ id: string }>(`/projects/${projectId}/commercial/promises`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface OpenDisputePayload {
  invoiceId: string;
  reason: 'OMISSION' | 'PRICE_ERROR' | 'WORK_NOT_ACCEPTED' | 'SCOPE_DISAGREEMENT' | 'OTHER';
  /** Decimal string — optional disputed portion; does NOT reduce outstandingAmount */
  disputedAmount?: string;
  note?: string;
}

export function openDispute(
  projectId: string,
  payload: OpenDisputePayload,
): Promise<{ id: string }> {
  return apiClient<{ id: string }>(`/projects/${projectId}/commercial/disputes`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface ResolveDisputePayload {
  resolutionNote?: string;
}

export function resolveDispute(
  projectId: string,
  disputeId: string,
  payload: ResolveDisputePayload = {},
): Promise<{ id: string }> {
  return apiClient<{ id: string }>(
    `/projects/${projectId}/commercial/disputes/${disputeId}/resolve`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  );
}

export interface CreateCreditNotePayload {
  invoiceId: string;
  reason: 'OMISSION' | 'PRICE_ERROR' | 'CORRECTION' | 'NEGATIVE_VARIATION';
  /** Decimal string — ex-VAT net amount to credit */
  netAmount: string;
  /** ISO date string */
  accountingDate: string;
  note?: string;
  sourceVariationId?: string;
}

export function createCreditNote(
  projectId: string,
  payload: CreateCreditNotePayload,
): Promise<{ id: string; postingStatus: string }> {
  return apiClient<{ id: string; postingStatus: string }>(
    `/projects/${projectId}/commercial/credit-notes`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export function postCreditNote(
  projectId: string,
  creditNoteId: string,
): Promise<{ id: string; postingStatus: string; creditNoteNumber: string }> {
  return apiClient<{ id: string; postingStatus: string; creditNoteNumber: string }>(
    `/projects/${projectId}/commercial/credit-notes/${creditNoteId}/post`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

// ─── Slice B — Contract close ─────────────────────────────────────────────────

export function closeContract(contractId: string): Promise<{ id: string; status: string }> {
  return apiClient<{ id: string; status: string }>(`/contracts/${contractId}/close`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ─── Slice C — Retention release ─────────────────────────────────────────────

export function releaseRetention(contractId: string): Promise<{ id: string; status: string }> {
  return apiClient<{ id: string; status: string }>(`/contracts/${contractId}/retention/release`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ─── Slice D — Separate charges ───────────────────────────────────────────────

export function getProjectSeparateCharges(projectId: string): Promise<SeparateChargesResponse> {
  return apiClient<SeparateChargesResponse>(`/projects/${projectId}/commercial/separate-charges`);
}

export interface CreateSeparateChargeInvoicePayload {
  boqNodeId: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms?: string;
}

export function createSeparateChargeInvoice(
  payload: CreateSeparateChargeInvoicePayload,
): Promise<{ id: string; postingStatus: string }> {
  return apiClient<{ id: string; postingStatus: string }>(`/invoices/from-separate-charge`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

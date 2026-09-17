import type {
  CommercialBillingResponse,
  CommercialBillingPackagesResponse,
  CommercialBillStageResult,
  CertifiedInvoicedByVariationResponse,
  CommercialApplicationsResponse,
  CommercialCurrentCycleResponse,
  CommercialSummaryResponse,
  ExtensionOfTimeListResponse,
  ExtensionOfTimeResponse,
  GrantExtensionOfTimeRequest,
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
  variations: Array<{ variationId: string; include: boolean }>;
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

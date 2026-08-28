import type {
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

/** The IPA → IPC → invoice → settlement chain for a project. */
export function getCommercialApplications(
  projectId: string,
): Promise<CommercialApplicationsResponse> {
  return apiClient<CommercialApplicationsResponse>(
    `/projects/${projectId}/commercial/applications`,
  );
}

// ─── Variations & Change Orders (ADR-026 Phase 1) ───────────────────────────────
//
// Contract-scoped. Every figure here (net price, contract value) is derived by the server; the
// UI renders it and never re-computes a rule. Line editing is DRAFT-only (the server rejects
// otherwise); lifecycle transitions are guarded server-side by status and permission.

/** A single variation line the UI collects to seed a DRAFT (additions and signed-negative omissions). */
export interface VariationLinePayload {
  description: string;
  /** May be negative to express an omission (CONST-VAR-002). */
  quantity: number;
  unitRate: number;
}

export interface CreateVariationPayload {
  title: string;
  description?: string;
  proposedTimeImpactDays?: number;
  lines?: VariationLinePayload[];
}

export interface UpdateVariationLinePayload {
  description?: string;
  quantity?: number;
  unitRate?: number;
  sortOrder?: number;
}

export interface ClientApproveVariationPayload {
  clientApprovalReference: string;
  note?: string;
}

export function listVariations(contractId: string): Promise<VariationOrderListResponse> {
  return apiClient<VariationOrderListResponse>(`/contracts/${contractId}/variations`);
}

export function getVariation(id: string): Promise<VariationOrderResponse> {
  return apiClient<VariationOrderResponse>(`/variations/${id}`);
}

export function createVariation(
  contractId: string,
  payload: CreateVariationPayload,
): Promise<VariationOrderResponse> {
  return apiClient<VariationOrderResponse>(`/contracts/${contractId}/variations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
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

export function submitVariation(id: string): Promise<VariationOrderResponse> {
  return apiClient<VariationOrderResponse>(`/variations/${id}/submit`, { method: 'POST' });
}

export function internalApproveVariation(id: string): Promise<VariationOrderResponse> {
  return apiClient<VariationOrderResponse>(`/variations/${id}/internal-approve`, {
    method: 'POST',
  });
}

export function clientApproveVariation(
  id: string,
  payload: ClientApproveVariationPayload,
): Promise<VariationOrderResponse> {
  return apiClient<VariationOrderResponse>(`/variations/${id}/client-approve`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function rejectVariation(id: string, reason: string): Promise<VariationOrderResponse> {
  return apiClient<VariationOrderResponse>(`/variations/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function withdrawVariation(id: string, reason?: string): Promise<VariationOrderResponse> {
  return apiClient<VariationOrderResponse>(`/variations/${id}/withdraw`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
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

import type {
  CommercialApplicationsResponse,
  CommercialCurrentCycleResponse,
  CommercialSummaryResponse,
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

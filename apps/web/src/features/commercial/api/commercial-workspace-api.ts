import type { CommercialClientStatementResponse, CommercialWorkspaceResponse } from '@erp/types';

import { apiClient } from '@/lib/api-client';

/**
 * The Commercial tab's own read model: the contract's facts for the bar, the ranked "To do" list
 * and what the caller may do. The server ranks, gates and hides money; the page renders.
 */
export function getCommercialWorkspace(projectId: string): Promise<CommercialWorkspaceResponse> {
  return apiClient<CommercialWorkspaceResponse>(`/projects/${projectId}/commercial/workspace`);
}

/** The client statement for this contract — invoices, credit notes and receipts, oldest first. */
export function getClientStatement(projectId: string): Promise<CommercialClientStatementResponse> {
  return apiClient<CommercialClientStatementResponse>(`/projects/${projectId}/commercial/statement`);
}

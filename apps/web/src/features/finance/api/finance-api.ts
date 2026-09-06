import type {
  AccountingReadinessResponse,
  ProjectCostReconciliationResponse,
  ProjectFinanceOverviewResponse,
  ProjectLedgerResponse,
} from '@erp/types';

import type { ProfitLoss } from '@/features/accounting/types';
import { apiClient } from '@/lib/api-client';

/**
 * The project Finance workspace's reads.
 *
 * Cost Control deliberately has no endpoints of its own here: it consumes the project
 * procurement cost read model and the cost-budget endpoints, which is the same data the
 * Procurement tab shows. One read model, two purposes — the alternative is two answers to
 * "what has this project committed", and the audit that produced this workspace found exactly
 * that class of divergence in the accounting itself.
 */

/** Everything the Finance Overview renders, in one read. */
export function getFinanceOverview(projectId: string): Promise<ProjectFinanceOverviewResponse> {
  return apiClient<ProjectFinanceOverviewResponse>(`/projects/${projectId}/finance/overview`);
}

/** Does procurement's ACTUAL agree with the general ledger? (REC-01) */
export function getCostReconciliation(
  projectId: string,
): Promise<ProjectCostReconciliationResponse> {
  return apiClient<ProjectCostReconciliationResponse>(
    `/projects/${projectId}/cost-reconciliation`,
  );
}

/** Whether the ledger can accept a posting at all, and what is missing when it cannot. */
export function getAccountingReadiness(): Promise<AccountingReadinessResponse> {
  return apiClient<AccountingReadinessResponse>('/accounting/readiness');
}

export interface ProjectPlParams {
  fromDate: string;
  toDate: string;
}

/** Project profit & loss over a date range. Posted general-ledger entries only. */
export function getProjectPl(
  projectId: string,
  params: ProjectPlParams,
): Promise<ProfitLoss> {
  return apiClient<ProfitLoss>(`/projects/${projectId}/pl`, {
    params: { fromDate: params.fromDate, toDate: params.toDate },
  });
}

export interface ProjectLedgerParams {
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

/** The postings behind the project's figures. Paged, newest first. */
export function getProjectLedger(
  projectId: string,
  params: ProjectLedgerParams,
): Promise<ProjectLedgerResponse> {
  return apiClient<ProjectLedgerResponse>(`/projects/${projectId}/ledger`, {
    params: {
      ...(params.fromDate ? { fromDate: params.fromDate } : {}),
      ...(params.toDate ? { toDate: params.toDate } : {}),
      ...(params.limit !== undefined ? { limit: String(params.limit) } : {}),
      ...(params.offset !== undefined ? { offset: String(params.offset) } : {}),
    },
  });
}

import type {
  ProjectCostBudgetListResponse,
  ProjectCostBudgetResponse,
  ProjectProcurementCostResponse,
  ProjectProcurementOverviewResponse,
  ProjectRequirementsResponse,
} from '@erp/types';

import { apiClient } from '@/lib/api-client';

/**
 * The project's procurement surface.
 *
 * Reads only, plus the project's own cost budget. Purchase orders, goods receipts, supplier bills
 * and payments are deliberately absent: the organisation owns those documents and operates them
 * at `/procurement/*`, while the project owns the cost coded onto their lines. Every money figure
 * below is derived server-side from the commitment ledger, so it agrees with the Project
 * Financial Position by construction.
 */

/** `asOf` bounds on the ledger's accounting date — "as of month end" means what it says. */
export function getProjectProcurementOverview(
  projectId: string,
  asOf?: string,
): Promise<ProjectProcurementOverviewResponse> {
  const query = asOf ? `?asOf=${encodeURIComponent(asOf)}` : '';
  return apiClient<ProjectProcurementOverviewResponse>(
    `/projects/${projectId}/procurement/overview${query}`,
  );
}

export function getProjectProcurementCost(
  projectId: string,
  asOf?: string,
): Promise<ProjectProcurementCostResponse> {
  const query = asOf ? `?asOf=${encodeURIComponent(asOf)}` : '';
  return apiClient<ProjectProcurementCostResponse>(
    `/projects/${projectId}/procurement/cost${query}`,
  );
}

export function getProjectRequirements(projectId: string): Promise<ProjectRequirementsResponse> {
  return apiClient<ProjectRequirementsResponse>(`/projects/${projectId}/procurement/requirements`);
}

// ─── Cost budget ────────────────────────────────────────────────────────────────

export interface ProjectCostBudgetLinePayload {
  /** Exactly one of these two. The server rejects both and neither. */
  boqNodeId?: string;
  spendCategoryId?: string;
  description: string;
  budgetAmount: number;
}

export interface CreateProjectCostBudgetPayload {
  currency: string;
  notes?: string;
  lines: ProjectCostBudgetLinePayload[];
}

export function listProjectCostBudgets(
  projectId: string,
): Promise<ProjectCostBudgetListResponse> {
  return apiClient<ProjectCostBudgetListResponse>(`/projects/${projectId}/procurement/budgets`);
}

export function createProjectCostBudget(
  projectId: string,
  payload: CreateProjectCostBudgetPayload,
): Promise<ProjectCostBudgetResponse> {
  return apiClient<ProjectCostBudgetResponse>(`/projects/${projectId}/procurement/budgets`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateProjectCostBudget(
  projectId: string,
  budgetId: string,
  payload: Partial<CreateProjectCostBudgetPayload>,
): Promise<ProjectCostBudgetResponse> {
  return apiClient<ProjectCostBudgetResponse>(
    `/projects/${projectId}/procurement/budgets/${budgetId}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  );
}

/** Makes a draft the figure the project is measured against, superseding the previous one. */
export function baselineProjectCostBudget(
  projectId: string,
  budgetId: string,
): Promise<ProjectCostBudgetResponse> {
  return apiClient<ProjectCostBudgetResponse>(
    `/projects/${projectId}/procurement/budgets/${budgetId}/baseline`,
    { method: 'POST' },
  );
}

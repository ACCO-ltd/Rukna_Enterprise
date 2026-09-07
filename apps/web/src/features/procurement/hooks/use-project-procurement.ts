'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  ProjectCostBudgetListResponse,
  ProjectCostBudgetResponse,
  ProjectProcurementCostResponse,
  ProjectProcurementOverviewResponse,
  ProjectRequirementDetail,
  ProjectRequirementsResponse,
} from '@erp/types';

import {
  baselineProjectCostBudget,
  createProjectCostBudget,
  discardProjectCostBudget,
  getProjectProcurementCost,
  getProjectProcurementOverview,
  getProjectRequirement,
  getProjectRequirements,
  listProjectCostBudgets,
  updateProjectCostBudget,
  type CreateProjectCostBudgetPayload,
} from '../api/project-procurement-api';

export const projectProcurementKeys = {
  all: (projectId: string) => ['project-procurement', projectId] as const,
  overview: (projectId: string, asOf?: string) =>
    [...projectProcurementKeys.all(projectId), 'overview', asOf ?? 'now'] as const,
  cost: (projectId: string, asOf?: string) =>
    [...projectProcurementKeys.all(projectId), 'cost', asOf ?? 'now'] as const,
  requirements: (projectId: string) =>
    [...projectProcurementKeys.all(projectId), 'requirements'] as const,
  requirement: (projectId: string, id: string) =>
    [...projectProcurementKeys.all(projectId), 'requirement', id] as const,
  budgets: (projectId: string) => [...projectProcurementKeys.all(projectId), 'budgets'] as const,
};

export function useProjectProcurementOverview(
  projectId: string,
  asOf?: string,
): UseQueryResult<ProjectProcurementOverviewResponse, Error> {
  return useQuery({
    queryKey: projectProcurementKeys.overview(projectId, asOf),
    queryFn: () => getProjectProcurementOverview(projectId, asOf),
  });
}

export function useProjectProcurementCost(
  projectId: string,
  asOf?: string,
): UseQueryResult<ProjectProcurementCostResponse, Error> {
  return useQuery({
    queryKey: projectProcurementKeys.cost(projectId, asOf),
    queryFn: () => getProjectProcurementCost(projectId, asOf),
  });
}

export function useProjectRequirements(
  projectId: string,
): UseQueryResult<ProjectRequirementsResponse, Error> {
  return useQuery({
    queryKey: projectProcurementKeys.requirements(projectId),
    queryFn: () => getProjectRequirements(projectId),
  });
}

export function useProjectRequirement(
  projectId: string,
  requirementId: string,
): UseQueryResult<ProjectRequirementDetail, Error> {
  return useQuery({
    queryKey: projectProcurementKeys.requirement(projectId, requirementId),
    queryFn: () => getProjectRequirement(projectId, requirementId),
  });
}

export function useProjectCostBudgets(
  projectId: string,
): UseQueryResult<ProjectCostBudgetListResponse, Error> {
  return useQuery({
    queryKey: projectProcurementKeys.budgets(projectId),
    queryFn: () => listProjectCostBudgets(projectId),
  });
}

/**
 * Budget mutations invalidate the whole project's procurement cache, not just the budget list:
 * baselining a budget changes every percentage on every cost screen, and a stale overview showing
 * "no budget set" beside a freshly baselined one is worse than a refetch.
 */
function useBudgetMutation<TArgs, TResult = ProjectCostBudgetResponse>(
  projectId: string,
  fn: (args: TArgs) => Promise<TResult>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: projectProcurementKeys.all(projectId) });
    },
  });
}

export function useCreateProjectCostBudget(projectId: string) {
  return useBudgetMutation(projectId, (payload: CreateProjectCostBudgetPayload) =>
    createProjectCostBudget(projectId, payload),
  );
}

export function useUpdateProjectCostBudget(projectId: string) {
  return useBudgetMutation(
    projectId,
    ({ budgetId, payload }: { budgetId: string; payload: Partial<CreateProjectCostBudgetPayload> }) =>
      updateProjectCostBudget(projectId, budgetId, payload),
  );
}

export function useDiscardProjectCostBudget(projectId: string) {
  return useBudgetMutation<string, void>(projectId, (budgetId) =>
    discardProjectCostBudget(projectId, budgetId),
  );
}

export function useBaselineProjectCostBudget(projectId: string) {
  return useBudgetMutation(projectId, (budgetId: string) =>
    baselineProjectCostBudget(projectId, budgetId),
  );
}

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  FinancePortfolioProjectResponse,
  FinancePortfolioQuery,
  FinancePortfolioResponse,
} from '@erp/types';

import { usePermissions } from '@/features/auth/permissions/can';

import { getFinancePortfolio, getFinanceProject } from './api';

/** The permission `GET /finance/projects` requires — the nav item and pages gate on it too. */
export const FINANCE_PROJECTS_PERMISSION = 'view:financial-position' as const;

export const financePortfolioKeys = {
  all: ['finance-portfolio'] as const,
  list: (query: FinancePortfolioQuery) => [...financePortfolioKeys.all, query] as const,
  project: (projectId: string) => [...financePortfolioKeys.all, 'project', projectId] as const,
};

export function useFinancePortfolio(
  query: FinancePortfolioQuery = {},
  options: { enabled?: boolean } = {},
): UseQueryResult<FinancePortfolioResponse> {
  return useQuery({
    queryKey: financePortfolioKeys.list(query),
    queryFn: () => getFinancePortfolio(query),
    enabled: options.enabled ?? true,
  });
}

/** One project's row, for the Finance workspace header — never the whole portfolio. */
export function useFinanceProject(
  projectId: string,
  options: { enabled?: boolean } = {},
): UseQueryResult<FinancePortfolioProjectResponse> {
  return useQuery({
    queryKey: financePortfolioKeys.project(projectId),
    queryFn: () => getFinanceProject(projectId),
    enabled: options.enabled ?? true,
  });
}

/** Whether the viewer may open the Finance project portfolio and workspace. */
export function useCanViewFinanceProjects(): boolean {
  return usePermissions().can(FINANCE_PROJECTS_PERMISSION);
}

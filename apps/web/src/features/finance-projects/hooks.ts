import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  FinancePortfolioProjectResponse,
  FinancePortfolioQuery,
  FinancePortfolioResponse,
} from '@erp/types';

import { ACCOUNTING_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';

import { getFinancePortfolio, getFinanceProject } from './api';
import { financeProjectRedirects } from './redirects';

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

/** The Payables tab (ADR-043 Phase 2) - `manage:payable`, the bills list's own gate. */
export function useCanViewProjectPayables(): boolean {
  return usePermissions().can(ACCOUNTING_PERMISSIONS.managePayables);
}

/**
 * The Payments tab (ADR-043 Phase 2): each list behind its own API gate - receipts
 * `manage:receivable`, supplier payments `manage:payable`, journals `manage:journal`.
 */
export function useProjectPaymentsAccess() {
  const { can } = usePermissions();
  const receipts = can(ACCOUNTING_PERMISSIONS.manageReceivables);
  const supplierPayments = can(ACCOUNTING_PERMISSIONS.managePayables);
  const journals = can(ACCOUNTING_PERMISSIONS.manageJournals);
  return { receipts, supplierPayments, journals, any: receipts || supplierPayments || journals };
}

/**
 * ADR-043 Phase 3 — where a "billing" link sends this reader for a project: a finance reader to
 * Finance → Projects → Billing; anyone else who can read the contract to the Commercial schedule
 * (its money-free stage status); null when neither is open to them (render no link). Never a
 * dead-end on Finance's no-access page.
 */
export function useProjectBillingHref(projectId: string): string | null {
  const { can } = usePermissions();
  if (can(FINANCE_PROJECTS_PERMISSION)) return financeProjectRedirects.billing(projectId);
  if (can('view:contract')) return financeProjectRedirects.commercialSchedule(projectId);
  return null;
}

'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  ProjectFinanceOverviewResponse,
  ProjectLedgerResponse,
} from '@erp/types';

import type { ProfitLoss } from '@/features/accounting/types';

import {
  getFinanceOverview,
  getProjectLedger,
  getProjectPl,
  type ProjectLedgerParams,
  type ProjectPlParams,
} from '../api/finance-api';

export const financeKeys = {
  all: (projectId: string) => ['project-finance', projectId] as const,
  overview: (projectId: string) => [...financeKeys.all(projectId), 'overview'] as const,
  pl: (projectId: string, from: string, to: string) =>
    [...financeKeys.all(projectId), 'pl', from, to] as const,
  ledger: (projectId: string, params: ProjectLedgerParams) =>
    [...financeKeys.all(projectId), 'ledger', params] as const,
};

export function useFinanceOverview(
  projectId: string,
  options: { enabled?: boolean } = {},
): UseQueryResult<ProjectFinanceOverviewResponse> {
  return useQuery({
    queryKey: financeKeys.overview(projectId),
    queryFn: () => getFinanceOverview(projectId),
    enabled: options.enabled ?? true,
  });
}

export function useProjectPl(
  projectId: string,
  params: ProjectPlParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<ProfitLoss> {
  return useQuery({
    queryKey: financeKeys.pl(projectId, params.fromDate, params.toDate),
    queryFn: () => getProjectPl(projectId, params),
    enabled: (options.enabled ?? true) && Boolean(params.fromDate && params.toDate),
  });
}

export function useProjectLedger(
  projectId: string,
  params: ProjectLedgerParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<ProjectLedgerResponse> {
  return useQuery({
    queryKey: financeKeys.ledger(projectId, params),
    queryFn: () => getProjectLedger(projectId, params),
    enabled: options.enabled ?? true,
    // Paging should not blank the table between pages — a ledger that flashes empty reads as
    // "no entries" for a moment, which is the one thing it must never say by accident.
    placeholderData: (previous) => previous,
  });
}

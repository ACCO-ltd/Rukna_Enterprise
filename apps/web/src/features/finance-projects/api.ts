import type {
  CashflowForecastQuery,
  CashflowForecastResponse,
  FinancePortfolioProjectResponse,
  FinancePortfolioQuery,
  FinancePortfolioResponse,
} from '@erp/types';

import { apiClient } from '@/lib/api-client';

/** ADR-043 — the Finance workspace's project portfolio (`GET /finance/projects`). */
export function getFinancePortfolio(query: FinancePortfolioQuery = {}): Promise<FinancePortfolioResponse> {
  const params = new URLSearchParams();
  if (query.queue) params.set('queue', query.queue);
  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  const qs = params.toString();
  return apiClient<FinancePortfolioResponse>(`/finance/projects${qs ? `?${qs}` : ''}`);
}

/** One project's portfolio row — the Finance workspace header (`GET /finance/projects/:id`). */
export function getFinanceProject(projectId: string): Promise<FinancePortfolioProjectResponse> {
  return apiClient<FinancePortfolioProjectResponse>(`/finance/projects/${projectId}`);
}

/** ADR-043 Phase 4 — the cash-flow forecast (`GET /finance/cashflow`), portfolio or one project. */
export function getCashflowForecast(query: CashflowForecastQuery = {}): Promise<CashflowForecastResponse> {
  const params = new URLSearchParams();
  if (query.projectId) params.set('projectId', query.projectId);
  if (query.bucket) params.set('bucket', query.bucket);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  const qs = params.toString();
  return apiClient<CashflowForecastResponse>(`/finance/cashflow${qs ? `?${qs}` : ''}`);
}

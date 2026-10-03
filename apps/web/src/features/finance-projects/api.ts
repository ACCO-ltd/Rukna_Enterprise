import type { FinancePortfolioQuery, FinancePortfolioResponse } from '@erp/types';

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

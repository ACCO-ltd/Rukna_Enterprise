import { apiClient } from '@/lib/api-client';
import type { FinanceHome } from '@erp/types';

/** Step 4 — `GET /finance/home`: cash, receivables aging, payables due and this month. */
export function getFinanceHome(): Promise<FinanceHome> {
  return apiClient<FinanceHome>('/finance/home');
}

import { apiClient } from '@/lib/api-client';
import type { AgingReport, AgingSide } from '@erp/types';

/** Step 6 — `GET /finance/aging/:side`: open invoices or bills by party and days past due. */
export function getAgingReport(side: AgingSide): Promise<AgingReport> {
  return apiClient<AgingReport>(`/finance/aging/${side}`);
}

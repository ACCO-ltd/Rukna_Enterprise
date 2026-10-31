import { apiClient } from '@/lib/api-client';
import type { AgingReport, AgingSide } from '@erp/types';

/**
 * Step 6 — `GET /finance/aging/:side`: open invoices or bills by party and days past due; AG-1 —
 * `asOf` (receivables) rebuilds the report to the end of a past day.
 */
export function getAgingReport(side: AgingSide, asOf?: string): Promise<AgingReport> {
  return apiClient<AgingReport>(`/finance/aging/${side}${asOf ? `?asOf=${asOf}` : ''}`);
}

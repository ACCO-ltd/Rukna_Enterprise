import type { DashboardResponse } from '@erp/types';

import { apiClient } from '@/lib/api-client';

/** The dashboard read model (`GET /dashboard`), scoped to the caller by the server. */
export function getDashboard(): Promise<DashboardResponse> {
  return apiClient<DashboardResponse>('/dashboard');
}

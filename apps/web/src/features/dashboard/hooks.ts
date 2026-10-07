import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { DashboardResponse } from '@erp/types';

import { getDashboard } from './api';

export const dashboardKeys = {
  all: ['dashboard'] as const,
};

/** Everything the dashboard shows, in one request. Refreshes when the tab regains focus. */
export function useDashboard(): UseQueryResult<DashboardResponse> {
  return useQuery({
    queryKey: dashboardKeys.all,
    queryFn: getDashboard,
    staleTime: 30_000,
  });
}

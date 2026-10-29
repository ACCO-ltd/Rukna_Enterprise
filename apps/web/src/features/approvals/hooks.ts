'use client';

import { useQuery } from '@tanstack/react-query';

import { getApprovalsInbox } from './api';

export const approvalsKeys = { inbox: ['approvals', 'inbox'] as const };

/**
 * The inbox, shared by the sidebar count and the Approvals page (one request, one cache entry).
 * Refreshed every minute and on focus, so the count follows decisions made elsewhere.
 */
export function useApprovalsInbox(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: approvalsKeys.inbox,
    queryFn: getApprovalsInbox,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    enabled: options.enabled ?? true,
  });
}

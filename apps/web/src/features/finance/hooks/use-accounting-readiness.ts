'use client';

import { useQuery } from '@tanstack/react-query';

import { usePermissions } from '@/features/auth/permissions/can';

import { getAccountingReadiness } from '../api/finance-api';

/**
 * Whether the general ledger can accept postings (`GET /accounting/readiness`) — flow plan A7.
 * Asked before a reader presses Prepare invoice or Post, so the action is withheld with its
 * reason instead of failing and rolling back. Only for readers who may view accounting; for
 * anyone else the query stays idle and callers treat "unknown" as "not blocked".
 */
export function useAccountingReadiness() {
  const { can } = usePermissions();
  return useQuery({
    queryKey: ['accounting', 'readiness'] as const,
    queryFn: getAccountingReadiness,
    enabled: can('view:accounting'),
    staleTime: 60_000,
  });
}

/** True only when readiness is known and the ledger cannot post. */
export function useLedgerBlocked(): boolean {
  const readiness = useAccountingReadiness();
  return readiness.data !== undefined && !readiness.data.ready;
}

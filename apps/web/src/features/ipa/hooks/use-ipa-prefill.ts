'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IpaPrefillResponse } from '@erp/types';

import { getIpaPrefill } from '../api/ipa-prefill-api';

export const ipaPrefillKeys = {
  byContract: (contractId: string) => ['ipa-prefill', contractId] as const,
};

/**
 * Suggested claim quantities from verified progress (firewall-safe — a QS confirms before any
 * IPA is created). Read-only; nothing to invalidate. Enable it only when the "New IPA" flow
 * opens for a contract so it isn't fetched for every IPA screen.
 */
export function useIpaPrefill(
  contractId: string,
  options?: { enabled?: boolean },
): UseQueryResult<IpaPrefillResponse, Error> {
  return useQuery({
    queryKey: ipaPrefillKeys.byContract(contractId),
    queryFn: () => getIpaPrefill(contractId),
    enabled: Boolean(contractId) && (options?.enabled ?? true),
  });
}

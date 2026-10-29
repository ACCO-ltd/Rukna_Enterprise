'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BankTransferView } from '@erp/types';

import { accountingKeys } from '@/features/accounting/hooks/use-accounting';
import { apiClient } from '@/lib/api-client';

export interface RequestTransferPayload {
  fromBankAccountId: string;
  toBankAccountId: string;
  amount: string;
  transferDate: string;
  reference?: string;
  memo?: string;
}

export const transferKeys = { all: ['finance', 'bank-transfers'] as const };

/** B-2 — `GET /bank-transfers`, newest first. */
export function useBankTransfers() {
  return useQuery({ queryKey: transferKeys.all, queryFn: () => apiClient<BankTransferView[]>('/bank-transfers') });
}

/** Every transfer command moves account balances: refresh transfers, accounts and the inbox. */
function useInvalidate() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: transferKeys.all }),
      qc.invalidateQueries({ queryKey: accountingKeys.bankAccounts() }),
      qc.invalidateQueries({ queryKey: ['approvals'] }),
    ]);
}

/** Posts at once up to the payment limit; above it, waits for a second person. */
export function useRequestTransfer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (payload: RequestTransferPayload) =>
      apiClient<BankTransferView>('/bank-transfers', { method: 'POST', body: JSON.stringify(payload) }),
    onSettled: invalidate,
  });
}

export function useDecideTransfer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { id: string; action: 'approve' } | { id: string; action: 'reject' | 'reverse'; reason: string }) =>
      apiClient<BankTransferView>(`/bank-transfers/${input.id}/${input.action}`, {
        method: 'POST',
        body: JSON.stringify(
          input.action === 'approve'
            ? {}
            : input.action === 'reject'
              ? { reason: input.reason }
              : { reason: input.reason, reversalDate: new Date().toISOString().slice(0, 10) },
        ),
      }),
    onSettled: invalidate,
  });
}

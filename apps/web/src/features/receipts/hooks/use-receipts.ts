'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import {
  allocateReceipt,
  createReceipt,
  getReceipt,
  listReceipts,
  removeAllocation,
  type AllocateReceiptPayload,
  type CreateReceiptPayload,
} from '../api/receipts-api';
import type { Receipt, ReceiptDetail } from '../types';

export const receiptKeys = {
  all: ['receipts'] as const,
  list: (clientId?: string) => [...receiptKeys.all, 'list', clientId ?? 'all'] as const,
  detail: (id: string) => [...receiptKeys.all, 'detail', id] as const,
};

export function useReceipts(clientId?: string): UseQueryResult<Receipt[], Error> {
  return useQuery({
    queryKey: receiptKeys.list(clientId),
    queryFn: () => listReceipts(clientId),
  });
}

export function useReceipt(id: string): UseQueryResult<ReceiptDetail, Error> {
  return useQuery({
    queryKey: receiptKeys.detail(id),
    queryFn: () => getReceipt(id),
  });
}

export function useCreateReceipt() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateReceiptPayload) => createReceipt(payload),
    onSuccess: async (receipt) => {
      await queryClient.invalidateQueries({ queryKey: receiptKeys.all });
      router.push(`/receipts/${receipt.id}`);
    },
  });
}

/**
 * Allocation changes invalidate the receipt's detail.
 *
 * Nothing else needs refreshing: the list rows carry no allocation figures, and the
 * certificate's own settlement status is derived on the receipt screen from the
 * allocations rather than fetched — see the note on `getCertificatePaymentStatus`, which
 * is unusable until C7 is fixed.
 */
function useAllocationMutation<TArgs>(receiptId: string, run: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: receiptKeys.detail(receiptId) });
    },
  });
}

export function useAllocateReceipt(receiptId: string) {
  return useAllocationMutation(receiptId, (payload: AllocateReceiptPayload) =>
    allocateReceipt(receiptId, payload),
  );
}

export function useRemoveAllocation(receiptId: string) {
  return useAllocationMutation(receiptId, (allocationId: string) =>
    removeAllocation(receiptId, allocationId),
  );
}

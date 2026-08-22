'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import {
  allocateToInvoice,
  createReceipt,
  getReceipt,
  listReceipts,
  postReceipt,
  reverseAllocation,
  type AllocateToInvoicePayload,
  type CreateReceiptPayload,
  type PostReceiptPayload,
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
 * Posting and allocation change the receipt's GL/allocation state, so they invalidate the
 * detail (allocations, unallocated balance, posting status) and the list rows.
 */
function useReceiptStateMutation<TArgs>(receiptId: string, run: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: receiptKeys.detail(receiptId) }),
        queryClient.invalidateQueries({ queryKey: receiptKeys.all }),
      ]);
    },
  });
}

export function usePostReceipt(receiptId: string) {
  return useReceiptStateMutation(receiptId, (payload: PostReceiptPayload) =>
    postReceipt(receiptId, payload),
  );
}

export function useAllocateToInvoice(receiptId: string) {
  return useReceiptStateMutation(receiptId, (payload: AllocateToInvoicePayload) =>
    allocateToInvoice(receiptId, payload),
  );
}

export function useReverseAllocation(receiptId: string) {
  return useReceiptStateMutation(receiptId, (allocationId: string) =>
    reverseAllocation(receiptId, allocationId),
  );
}

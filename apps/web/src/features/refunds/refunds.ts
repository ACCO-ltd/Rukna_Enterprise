'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientRefundView } from '@erp/types';

import { apiClient } from '@/lib/api-client';
import { receiptKeys } from '@/features/receipts/hooks/use-receipts';

export interface RequestRefundPayload {
  bankAccountId: string;
  amount: string;
  refundDate: string;
  reason: string;
  reference?: string;
}

/** AR-5 — `GET /customer-receipts/:id/refunds`. */
export function listRefunds(receiptId: string): Promise<ClientRefundView[]> {
  return apiClient<ClientRefundView[]>(`/customer-receipts/${receiptId}/refunds`);
}

export const refundKeys = { forReceipt: (receiptId: string) => ['receipts', 'refunds', receiptId] as const };

export function useRefunds(receiptId: string, enabled = true) {
  return useQuery({ queryKey: refundKeys.forReceipt(receiptId), queryFn: () => listRefunds(receiptId), enabled: enabled && Boolean(receiptId) });
}

/** A refund changes what the receipt holds on account: refresh the receipt, its refunds and the inbox. */
function useInvalidate(receiptId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: receiptKeys.detail(receiptId) }),
      qc.invalidateQueries({ queryKey: refundKeys.forReceipt(receiptId) }),
      qc.invalidateQueries({ queryKey: ['approvals'] }),
    ]);
}

export function useRequestRefund(receiptId: string) {
  const invalidate = useInvalidate(receiptId);
  return useMutation({
    mutationFn: (payload: RequestRefundPayload) =>
      apiClient<ClientRefundView>(`/customer-receipts/${receiptId}/refunds`, { method: 'POST', body: JSON.stringify(payload) }),
    onSettled: invalidate,
  });
}

export function useDecideRefund(receiptId: string) {
  const invalidate = useInvalidate(receiptId);
  return useMutation({
    mutationFn: (input: { id: string; action: 'approve' } | { id: string; action: 'reject' | 'reverse'; reason: string }) =>
      apiClient<ClientRefundView>(`/client-refunds/${input.id}/${input.action}`, {
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

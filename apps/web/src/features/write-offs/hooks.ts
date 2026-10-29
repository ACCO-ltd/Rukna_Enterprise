'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { invoiceKeys } from '@/features/accounting/hooks/use-invoices';

import { approveWriteOff, listWriteOffs, rejectWriteOff, requestWriteOff, reverseWriteOff, type RequestWriteOffPayload } from './api';

export const writeOffKeys = {
  forInvoice: (invoiceId: string) => [...invoiceKeys.all, 'write-offs', invoiceId] as const,
};

export function useWriteOffs(invoiceId: string, enabled = true) {
  return useQuery({ queryKey: writeOffKeys.forInvoice(invoiceId), queryFn: () => listWriteOffs(invoiceId), enabled: enabled && Boolean(invoiceId) });
}

/** Every write-off command changes the invoice balance: refresh the invoice, its lists and the inbox. */
function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: invoiceKeys.all }), qc.invalidateQueries({ queryKey: ['approvals'] })]);
}

export function useRequestWriteOff(invoiceId: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (payload: RequestWriteOffPayload) => requestWriteOff(invoiceId, payload), onSettled: invalidate });
}

export function useDecideWriteOff() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { id: string; action: 'approve' } | { id: string; action: 'reject' | 'reverse'; reason: string }) =>
      input.action === 'approve'
        ? approveWriteOff(input.id)
        : input.action === 'reject'
          ? rejectWriteOff(input.id, input.reason)
          : reverseWriteOff(input.id, input.reason),
    onSettled: invalidate,
  });
}

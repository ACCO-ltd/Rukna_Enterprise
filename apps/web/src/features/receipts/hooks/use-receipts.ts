'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import {
  allocateToInvoice,
  cancelReceipt,
  createReceipt,
  getReceipt,
  getReceiptDocument,
  listReceipts,
  postReceipt,
  reverseAllocation,
  type AllocateToInvoicePayload,
  type CreateReceiptPayload,
  type PostReceiptPayload,
  receivePayment,
  type ReceivePaymentPayload,
  reverseReceipt,
} from '../api/receipts-api';
import type { MutationFeedbackMeta } from '@/lib/mutation-feedback';
import { openSignedDocument } from '@/lib/open-signed-document';
import { invoiceKeys } from '@/features/accounting/hooks/use-invoices';
import { todayWireDate } from '@/features/accounting/invoice-overdue';

import type { Receipt, ReceiptDetail } from '../types';

export const receiptKeys = {
  all: ['receipts'] as const,
  list: (clientId?: string, projectId?: string) =>
    [...receiptKeys.all, 'list', clientId ?? 'all', projectId ?? 'all'] as const,
  detail: (id: string) => [...receiptKeys.all, 'detail', id] as const,
};

export function useReceipts(
  clientId?: string,
  options: { projectId?: string; enabled?: boolean } = {},
): UseQueryResult<Receipt[], Error> {
  return useQuery({
    queryKey: receiptKeys.list(clientId, options.projectId),
    queryFn: () => listReceipts(clientId, options.projectId),
    enabled: options.enabled ?? true,
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
    meta: { successToast: 'accounting.feedback.receiptRecorded' },
    onSuccess: async (receipt) => {
      await queryClient.invalidateQueries({ queryKey: receiptKeys.all });
      router.push(`/receipts/${receipt.id}`);
    },
  });
}

/** ADR-046 §6 — receive into a bank: posted and applied at once, so invoices and the ledger move. */
export function useReceivePayment() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ReceivePaymentPayload) => receivePayment(payload),
    meta: { successToast: 'accounting.feedback.paymentReceived' },
    onSuccess: async (receipt) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: receiptKeys.all }),
        queryClient.invalidateQueries({ queryKey: ['accounting'] }),
      ]);
      router.push(`/receipts/${receipt.id}`);
    },
  });
}

/**
 * Posting and allocation change the receipt's GL/allocation state, so they invalidate the
 * detail (allocations, unallocated balance, posting status) and the list rows.
 */
function useReceiptStateMutation<TArgs>(
  receiptId: string,
  run: (args: TArgs) => Promise<unknown>,
  meta: MutationFeedbackMeta,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: run,
    meta,
    onSuccess: async () => {
      // Invoices' balances move with every post, application and reversal.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: receiptKeys.all }),
        queryClient.invalidateQueries({ queryKey: invoiceKeys.all }),
      ]);
    },
  });
}

export function usePostReceipt(receiptId: string) {
  return useReceiptStateMutation(
    receiptId,
    (payload: PostReceiptPayload) => postReceipt(receiptId, payload),
    { successToast: 'accounting.feedback.receiptPosted' },
  );
}

export function useAllocateToInvoice(receiptId: string) {
  return useReceiptStateMutation(
    receiptId,
    (payload: AllocateToInvoicePayload) => allocateToInvoice(receiptId, payload),
    { successToast: 'accounting.feedback.receiptAllocated' },
  );
}

/** Applies money held on account to several invoices: one application (and journal) per invoice. */
export function useApplyOnAccount(receiptId: string) {
  return useReceiptStateMutation(
    receiptId,
    async (allocations: AllocateToInvoicePayload[]) => {
      for (const allocation of allocations) await allocateToInvoice(receiptId, allocation);
    },
    { successToast: 'accounting.feedback.receiptAllocated' },
  );
}

/** RC-5 — cancel a receipt that was recorded but never posted. */
export function useCancelReceipt(receiptId: string) {
  return useReceiptStateMutation(receiptId, (reason: string) => cancelReceipt(receiptId, { reason }), {
    successToast: 'accounting.feedback.receiptCancelled',
    flashRow: false,
  });
}

export function useReverseAllocation(receiptId: string) {
  return useReceiptStateMutation(
    receiptId,
    (allocationId: string) => reverseAllocation(receiptId, allocationId),
    { successToast: 'accounting.feedback.allocationReversed', flashRow: false },
  );
}

/**
 * AR-2 — reverse a posted receipt; the invoices it paid owe again. Dated today, or on the receipt
 * date when that is later (RC-4: a reversal cannot predate the receipt).
 */
export function useReverseReceipt(receiptId: string, receiptDate?: string) {
  return useReceiptStateMutation(
    receiptId,
    (reason: string) => {
      const today = todayWireDate();
      const reversalDate = receiptDate && receiptDate.slice(0, 10) > today ? receiptDate.slice(0, 10) : today;
      return reverseReceipt(receiptId, { reversalDate, reason });
    },
    { successToast: 'accounting.feedback.receiptReversed', flashRow: false },
  );
}

/**
 * Fetches the receipt PDF's signed URL and opens it in a new tab — same pattern as
 * `useOpenInvoiceDocument`: the tab opens synchronously on click (so it is not a blocked popup)
 * and is pointed at the URL once it arrives; it is closed again if the fetch fails.
 */
export function useOpenReceiptDocument() {
  return useMutation({
    mutationFn: (id: string) => openSignedDocument(() => getReceiptDocument(id)),
  });
}

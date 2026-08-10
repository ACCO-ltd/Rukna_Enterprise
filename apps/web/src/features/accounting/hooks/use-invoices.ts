'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import {
  approveInvoice,
  generateInvoiceFromIpc,
  getInvoice,
  listInvoices,
  postInvoice,
  reverseInvoice,
} from '../api/invoices-api';
import { accountingKeys } from './use-accounting';

import type {
  ClientInvoice,
  GenerateInvoicePayload,
  PostInvoicePayload,
  ReverseInvoicePayload,
} from '../types';

/**
 * Nested under `accountingKeys.all`, so invalidating the accounting namespace reaches invoices
 * too. Posting an invoice moves the same reports a manual journal does.
 */
export const invoiceKeys = {
  all: [...accountingKeys.all, 'invoices'] as const,
  list: (clientId?: string) => [...invoiceKeys.all, 'list', clientId ?? 'all'] as const,
  detail: (id: string) => [...invoiceKeys.all, 'detail', id] as const,
};

export function useInvoices(clientId?: string): UseQueryResult<ClientInvoice[], Error> {
  return useQuery({
    queryKey: invoiceKeys.list(clientId),
    queryFn: () => listInvoices(clientId),
  });
}

export function useInvoice(id: string): UseQueryResult<ClientInvoice, Error> {
  return useQuery({
    queryKey: invoiceKeys.detail(id),
    queryFn: () => getInvoice(id),
    enabled: Boolean(id),
  });
}

/**
 * The invoice raised against one IPC, or `null` when none has been.
 *
 * There is no `GET /invoices?ipcId=` and no `GET /ipc/:id/invoice`, so this filters the full
 * list. That is affordable — the list is unpaginated and already cached for the invoices
 * screen — and it keeps the billing card off a bespoke endpoint that does not exist.
 *
 * `null` is a real answer here, not an error: most effective IPCs have not been invoiced yet.
 */
export function useInvoiceForIpc(ipcId: string): UseQueryResult<ClientInvoice | null, Error> {
  return useQuery({
    queryKey: [...invoiceKeys.all, 'for-ipc', ipcId] as const,
    queryFn: async () => {
      const invoices = await listInvoices();
      return invoices.find((invoice) => invoice.sourceIpcId === ipcId) ?? null;
    },
    enabled: Boolean(ipcId),
  });
}

/**
 * Generates the invoice and invalidates every list, including the per-IPC lookup — the billing
 * card that triggered this is showing "not invoiced yet" and has to stop.
 */
export function useGenerateInvoice() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: GenerateInvoicePayload) => generateInvoiceFromIpc(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: invoiceKeys.all });
    },
  });
}

export type InvoiceActionRequest =
  | { type: 'approve' }
  | { type: 'post'; payload: PostInvoicePayload }
  | { type: 'reverse'; payload: ReverseInvoicePayload };

/**
 * The three lifecycle transitions as one mutation, mirroring `useJournalAction`.
 *
 * Posting and reversing additionally invalidate the reports: a posted invoice debits the AR
 * control account and credits revenue, so the trial balance and the P&L both moved. Leaving a
 * stale report on screen after posting into it is how someone concludes the post did not take.
 *
 * The account ledger is invalidated for the same reason — the AR account just gained a line.
 */
export function useInvoiceAction(id: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (action: InvoiceActionRequest) => {
      switch (action.type) {
        case 'approve':
          return approveInvoice(id);
        case 'post':
          return postInvoice(id, action.payload);
        case 'reverse':
          return reverseInvoice(id, action.payload);
      }
    },
    onSuccess: (_result, action) => {
      void qc.invalidateQueries({ queryKey: invoiceKeys.all });

      if (action.type === 'post' || action.type === 'reverse') {
        void qc.invalidateQueries({ queryKey: [...accountingKeys.all, 'trial-balance'] });
        void qc.invalidateQueries({ queryKey: [...accountingKeys.all, 'profit-loss'] });
        void qc.invalidateQueries({ queryKey: [...accountingKeys.all, 'balance-sheet'] });
        void qc.invalidateQueries({ queryKey: [...accountingKeys.all, 'ledger'] });
      }
    },
  });
}

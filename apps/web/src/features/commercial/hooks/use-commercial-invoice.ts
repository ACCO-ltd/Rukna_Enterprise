'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  CommercialInvoiceDocumentResponse,
  CommercialIssueInvoiceResponse,
  CommercialPreparePackageRequest,
  CommercialPreparePackageResponse,
  CommercialPreparePreviewResponse,
} from '@erp/types';

import { invoiceKeys } from '@/features/accounting/hooks/use-invoices';

import {
  createInvoiceCreditNote,
  deleteDraftInvoice,
  getInvoiceDocument,
  getPreparePreview,
  issueInvoice,
  postInvoiceCreditNote,
  preparePackage,
  type CreateInvoiceCreditNotePayload,
} from '../api/commercial-invoice-api';
import { patchDraftInvoice, type PatchDraftInvoicePayload } from '../api/commercial-api';

/**
 * Query keys sit under `['commercial', projectId]`, so the workspace-wide invalidation every
 * commercial mutation already does also refreshes an open invoice page.
 */
export const commercialInvoiceKeys = {
  all: (projectId: string) => ['commercial', projectId] as const,
  document: (projectId: string, invoiceId: string) =>
    ['commercial', projectId, 'invoice-document', invoiceId] as const,
  preparePreview: (projectId: string, installmentId: string) =>
    ['commercial', projectId, 'prepare-preview', installmentId] as const,
};

export function useInvoiceDocument(
  projectId: string,
  invoiceId: string,
): UseQueryResult<CommercialInvoiceDocumentResponse, Error> {
  return useQuery({
    queryKey: commercialInvoiceKeys.document(projectId, invoiceId),
    queryFn: () => getInvoiceDocument(projectId, invoiceId),
    enabled: Boolean(projectId) && Boolean(invoiceId),
  });
}

export function usePreparePreview(
  projectId: string,
  installmentId: string | null,
  enabled = true,
): UseQueryResult<CommercialPreparePreviewResponse, Error> {
  return useQuery({
    queryKey: commercialInvoiceKeys.preparePreview(projectId, installmentId ?? 'none'),
    queryFn: () => getPreparePreview(projectId, installmentId as string),
    enabled: enabled && Boolean(projectId) && Boolean(installmentId),
    // The preview is a promise about what the draft will contain — never serve a stale one.
    staleTime: 0,
  });
}

/**
 * Everything commercial for the project — which includes the invoice document, whose key sits
 * under `['commercial', projectId]` — and the Accounting AR invoice lists.
 */
function useInvalidateInvoice(projectId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: commercialInvoiceKeys.all(projectId) }),
      qc.invalidateQueries({ queryKey: invoiceKeys.all }),
    ]);
}

export function usePreparePackage(projectId: string, installmentId: string) {
  const invalidate = useInvalidateInvoice(projectId);
  return useMutation<CommercialPreparePackageResponse, Error, CommercialPreparePackageRequest>({
    mutationFn: (payload) => preparePackage(projectId, installmentId, payload),
    meta: {
      successToast: {
        key: 'commercial.feedback.invoicePrepared',
        values: (data) => ({ count: (data as CommercialPreparePackageResponse).invoiceIds.length }),
      },
      flashRow: (data) => (data as CommercialPreparePackageResponse).invoiceId,
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

export function useIssueInvoice(projectId: string, invoiceId: string) {
  const invalidate = useInvalidateInvoice(projectId);
  return useMutation<CommercialIssueInvoiceResponse, Error, void>({
    mutationFn: () => issueInvoice(projectId, invoiceId),
    meta: {
      successToast: {
        key: 'commercial.feedback.invoiceIssued',
        values: (data) => {
          const { invoiceNumbers } = data as CommercialIssueInvoiceResponse;
          return { count: invoiceNumbers.length, numbers: invoiceNumbers.join(', ') };
        },
      },
      flashRow: () => invoiceId,
    },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

export function useDeleteDraftInvoice(projectId: string, invoiceId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, void>({
    mutationFn: () => deleteDraftInvoice(projectId, invoiceId),
    meta: { successToast: 'commercial.feedback.draftInvoiceDeleted', flashRow: false },
    onSuccess: async () => {
      // The document is gone — drop it rather than refetch a 404.
      qc.removeQueries({ queryKey: commercialInvoiceKeys.document(projectId, invoiceId) });
      await Promise.all([
        qc.invalidateQueries({ queryKey: commercialInvoiceKeys.all(projectId) }),
        qc.invalidateQueries({ queryKey: invoiceKeys.all }),
      ]);
    },
  });
}

export function useEditDraftInvoice(projectId: string, invoiceId: string) {
  const invalidate = useInvalidateInvoice(projectId);
  return useMutation<unknown, Error, PatchDraftInvoicePayload>({
    mutationFn: (payload) => patchDraftInvoice(projectId, invoiceId, payload),
    meta: { successToast: 'commercial.feedback.draftInvoiceUpdated', flashRow: () => invoiceId },
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Create, then post. The two calls are separate on the server; the created id is returned on
 * failure of the second so the dialog can retry the post without raising a duplicate note.
 */
export function useIssueCreditNote(projectId: string, invoiceId: string) {
  const invalidate = useInvalidateInvoice(projectId);
  return useMutation<
    { id: string; creditNoteNumber: string | null },
    Error & { creditNoteId?: string },
    { payload: CreateInvoiceCreditNotePayload; existingId?: string | null }
  >({
    mutationFn: async ({ payload, existingId }) => {
      const id = existingId ?? (await createInvoiceCreditNote(projectId, invoiceId, payload)).id;
      try {
        const posted = await postInvoiceCreditNote(projectId, invoiceId, id);
        return { id, creditNoteNumber: posted.creditNoteNumber ?? null };
      } catch (err) {
        const error = (err instanceof Error ? err : new Error(String(err))) as Error & {
          creditNoteId?: string;
        };
        error.creditNoteId = id;
        throw error;
      }
    },
    meta: {
      successToast: {
        key: 'commercial.feedback.creditNoteIssued',
        values: (data) => ({
          ref: (data as { creditNoteNumber: string | null }).creditNoteNumber ?? 'none',
        }),
      },
    },
    onSettled: async () => {
      await invalidate();
    },
  });
}

'use client';

/**
 * TanStack Query bindings for competitive quotations (ADR-044).
 *
 * Every command returns the request's detail read model, so a mutation writes it straight into
 * the detail cache (no extra round trip on a weak signal) and then invalidates the lists and the
 * MR detail — the MR shows the request's state, and the queues move a request between tabs.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';

import { QUOTATION_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { getFileDownloadUrl } from '@/features/files/api/files-api';
import type { MutationFeedbackMeta } from '@/lib/mutation-feedback';

import {
  addQuote,
  addQuotePhoto,
  askForAnotherQuote,
  awardQuotation,
  cancelQuotationRequest,
  enterQuoteTotal,
  getOrderDraft,
  getQuotationRequest,
  listQuotationRequests,
  openQuotationRequest,
  raiseOrder,
  rejectQuote,
  reopenQuotationRequest,
  requestRedecision,
  sendQuotationRequest,
  withdrawAward,
  withdrawQuote,
  type QuotationListFilters,
} from '../api/quotations-api';
import type {
  AwardPayload,
  OrderDraft,
  QuotationRequestDetail,
  QuotationRequestPage,
  QuoteCountExceptionReason,
  QuoteRejectReason,
  RaiseOrderPayload,
} from '../quotations/types';
import { procurementKeys } from './use-procurement';

/** Lists and the inbox badge refresh this often; finance's waiting time is minutes-grained. */
export const QUOTATION_POLL_MS = 60_000;

export const quotationKeys = {
  // Under `procurementKeys.all` (['procurement']) so a procurement-wide invalidation reaches it;
  // spelled out rather than spread so this module does not need use-procurement at load time.
  all: ['procurement', 'quotations'] as const,
  lists: () => [...quotationKeys.all, 'list'] as const,
  list: (filters: QuotationListFilters) =>
    [
      ...quotationKeys.lists(),
      filters.queue,
      filters.projectId ?? 'all',
      filters.q ?? '',
      filters.page ?? 1,
    ] as const,
  detail: (id: string) => [...quotationKeys.all, 'detail', id] as const,
  orderDraft: (id: string) => [...quotationKeys.all, 'order-draft', id] as const,
  photo: (fileId: string) => [...quotationKeys.all, 'photo-url', fileId] as const,
};

/** Signed photo URLs live ~15 minutes; reuse one for 10, then fetch a fresh one. */
const PHOTO_URL_STALE_MS = 10 * 60_000;

/** A short-lived signed URL for a quote photo (owner kind QUOTATION_PHOTO; 403 when money-blind). */
export function useQuotePhotoUrl(fileId: string | null) {
  return useQuery({
    queryKey: quotationKeys.photo(fileId ?? ''),
    queryFn: () => getFileDownloadUrl(fileId!),
    enabled: Boolean(fileId),
    staleTime: PHOTO_URL_STALE_MS,
    gcTime: PHOTO_URL_STALE_MS,
    retry: 1,
  });
}

export function useQuotationRequests(
  filters: QuotationListFilters,
  options?: { enabled?: boolean; poll?: boolean },
): UseQueryResult<QuotationRequestPage> {
  return useQuery({
    queryKey: quotationKeys.list(filters),
    queryFn: () => listQuotationRequests(filters),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.poll ? QUOTATION_POLL_MS : false,
  });
}

/**
 * The count behind Finance's "Quotes to choose" nav badge. Only runs for an award holder — a
 * request without the permission would 403 on every page load.
 */
export function useQuotesToChooseCount(options?: { enabled?: boolean }): number | null {
  const { can } = usePermissions();
  const allowed = can(QUOTATION_PERMISSIONS.award) && (options?.enabled ?? true);
  const query = useQuotationRequests({ queue: 'decide' }, { enabled: allowed, poll: true });
  if (!allowed || !query.data) return null;
  return query.data.total;
}

export function useQuotationRequest(
  id: string | null,
  options?: { poll?: boolean | ((detail: QuotationRequestDetail | undefined) => boolean) },
): UseQueryResult<QuotationRequestDetail> {
  const poll = options?.poll;
  return useQuery({
    queryKey: quotationKeys.detail(id ?? ''),
    queryFn: () => getQuotationRequest(id!),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const on = typeof poll === 'function' ? poll(query.state.data) : Boolean(poll);
      return on ? QUOTATION_POLL_MS : false;
    },
  });
}

export function useOrderDraft(
  id: string,
  options?: { enabled?: boolean },
): UseQueryResult<OrderDraft> {
  return useQuery({
    queryKey: quotationKeys.orderDraft(id),
    queryFn: () => getOrderDraft(id),
    enabled: options?.enabled ?? true,
  });
}

/** Writes the returned detail into the cache and refreshes everything that shows the request. */
export function applyQuotationDetail(qc: QueryClient, detail: QuotationRequestDetail | undefined) {
  if (detail?.id) qc.setQueryData(quotationKeys.detail(detail.id), detail);
  void qc.invalidateQueries({ queryKey: quotationKeys.lists() });
  if (detail?.id) void qc.invalidateQueries({ queryKey: quotationKeys.orderDraft(detail.id) });
  const mrId = detail?.materialRequest?.id;
  if (mrId) void qc.invalidateQueries({ queryKey: procurementKeys.materialRequest(mrId) });
}

/** After a refusal the cached detail may be stale (someone else acted): refetch it. */
function refreshDetail(qc: QueryClient, id: string) {
  void qc.invalidateQueries({ queryKey: quotationKeys.detail(id) });
  void qc.invalidateQueries({ queryKey: quotationKeys.lists() });
}

function useDetailCommand<TVars>(
  id: string,
  run: (vars: TVars) => Promise<QuotationRequestDetail>,
  meta?: MutationFeedbackMeta,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    meta: { flashRow: false, ...meta },
    onSuccess: (detail) => applyQuotationDetail(qc, detail),
    onError: () => refreshDetail(qc, id),
  });
}

/** `POST /` — idempotent: a repeat tap returns the live request. */
export function useOpenQuotationRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (materialRequestId: string) => openQuotationRequest(materialRequestId),
    meta: { flashRow: false },
    onSuccess: (detail) => applyQuotationDetail(qc, detail),
  });
}

export function useWithdrawQuote(id: string) {
  return useDetailCommand(id, (quoteId: string) => withdrawQuote(id, quoteId), {
    successToast: 'procurement.quotes.feedback.quoteRemoved',
  });
}

export function useSendQuotationRequest(id: string) {
  return useDetailCommand(
    id,
    (exceptionReason: QuoteCountExceptionReason | undefined) =>
      sendQuotationRequest(id, exceptionReason),
    { successToast: 'procurement.quotes.feedback.sent' },
  );
}

export function useReopenQuotationRequest(id: string) {
  return useDetailCommand(id, (reason: string) => reopenQuotationRequest(id, reason));
}

/** Silent: the decision screen shows its own saved tick per card. */
export function useEnterQuoteTotal(id: string) {
  return useDetailCommand(id, ({ quoteId, total }: { quoteId: string; total: string }) =>
    enterQuoteTotal(id, quoteId, total),
  );
}

export function useRejectQuote(id: string) {
  return useDetailCommand(
    id,
    ({ quoteId, reason, note }: { quoteId: string; reason: QuoteRejectReason; note?: string }) =>
      rejectQuote(id, quoteId, reason, note),
    { successToast: 'procurement.quotes.feedback.quoteRejected' },
  );
}

export function useAskForAnotherQuote(id: string) {
  return useDetailCommand(id, (note: string) => askForAnotherQuote(id, note), {
    successToast: 'procurement.quotes.feedback.askedAnother',
  });
}

/**
 * Award. A 409 carrying `approvalInstanceId` is the DoA gate, not a failure — the request is
 * now AWARD_PENDING_APPROVAL; `onError` refetches the detail so the screen shows the chain.
 */
export function useAwardQuotation(id: string) {
  return useDetailCommand(id, (payload: AwardPayload) => awardQuotation(id, payload), {
    successToast: 'procurement.quotes.feedback.awarded',
  });
}

export function useWithdrawAward(id: string) {
  return useDetailCommand(id, () => withdrawAward(id));
}

export function useRequestRedecision(id: string) {
  return useDetailCommand(id, (reason: string) => requestRedecision(id, reason), {
    successToast: 'procurement.quotes.feedback.sentBack',
  });
}

export function useCancelQuotationRequest(id: string) {
  return useDetailCommand(id, (reason: string) => cancelQuotationRequest(id, reason));
}

export function useRaiseOrder(id: string, materialRequestId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: RaiseOrderPayload) => raiseOrder(id, payload),
    meta: { flashRow: false, successToast: 'procurement.quotes.feedback.orderRaised' },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: quotationKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: quotationKeys.lists() });
      void qc.invalidateQueries({ queryKey: [...procurementKeys.all, 'purchase-orders'] });
      if (materialRequestId) {
        void qc.invalidateQueries({ queryKey: procurementKeys.materialRequest(materialRequestId) });
      }
    },
    onError: () => refreshDetail(qc, id),
  });
}

/**
 * Binding commands the upload queue calls (not through React Query — the queue outlives the
 * screen). Exported so the queue's adapter and the hooks share one definition.
 */
export const quotationBindingApi = { addQuote, addQuotePhoto };

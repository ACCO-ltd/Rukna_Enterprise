'use client';

/**
 * TanStack Query bindings for paying from the award (ADR-045).
 *
 * Every money command carries an `idempotencyKey` generated once per dialog open
 * (`useIdempotencyKey`): a retry after a lost response inside the same dialog reuses it, so a
 * double tap or a weak signal never pays twice; reopening the dialog is a new intent and gets a
 * new key.
 *
 * A 409 carrying `approvalInstanceId` is the DoA gate, not a failure (ADR-015). The command body
 * is kept (`pendingPaymentStore`) so the release can be re-driven with exactly the same body after
 * the approver acts — even after a reload.
 */

import { useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';

import { PAYMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { notificationKeys } from '@/features/notifications/hooks/use-notifications';

import {
  changePaymentPath,
  getPayDraft,
  getReleaseDraft,
  payFromAward,
  recordAdvanceReturn,
  recordStoreDocument,
  rejectStoreDocument,
  releaseCash,
  reverseBuyerAdvance,
  withdrawStoreDocument,
} from '../api/quotation-payment-api';
import { gatedInstanceOf, isPaymentReadModel, newIdempotencyKey } from '../quotations/payment-rules';
import type {
  AdvanceReturnPayload,
  ChangePaymentPathPayload,
  PayDraft,
  PayFromAwardPayload,
  QuotationPayment,
  RecordStoreDocumentPayload,
  ReleaseCashPayload,
  ReleaseDraft,
  ReverseAdvancePayload,
  StoreDocumentRejectReason,
} from '../quotations/payment-types';
import type { QuotationRequestDetail } from '../quotations/types';
import { procurementKeys } from './use-procurement';
import { quotationKeys } from './use-quotations';

export const paymentKeys = {
  all: [...quotationKeys.all, 'payment'] as const,
  releaseDraft: (requestId: string) => [...paymentKeys.all, 'release-draft', requestId] as const,
  payDraft: (requestId: string) => [...paymentKeys.all, 'pay-draft', requestId] as const,
};

/** `manage:payable` — every money command (ADR-045 §1). The server still decides SoD and DoA. */
export function useCanPay(): boolean {
  const { can } = usePermissions();
  return can(PAYMENT_PERMISSIONS.pay);
}

// ─── Idempotency ─────────────────────────────────────────────────────────────────

/**
 * One key per open: stable across re-renders and retries while `open` stays true; a fresh key the
 * next time it opens.
 */
export function useIdempotencyKey(open: boolean): string {
  const [state, setState] = useState(() => ({ open, key: newIdempotencyKey() }));
  if (open !== state.open) {
    const next = { open, key: open ? newIdempotencyKey() : state.key };
    setState(next);
    return next.key;
  }
  return state.key;
}

// ─── Pending re-drive (gated commands) ────────────────────────────────────────────

export type PendingPayment =
  | { kind: 'release'; body: ReleaseCashPayload }
  | { kind: 'pay'; body: PayFromAwardPayload };

const PENDING_PREFIX = 'quote-payment-pending:';

/** The last gated command per request, in this browser — so "Complete" re-sends the same body. */
export const pendingPaymentStore = {
  get(requestId: string): PendingPayment | null {
    try {
      const raw = globalThis.localStorage?.getItem(PENDING_PREFIX + requestId);
      return raw ? (JSON.parse(raw) as PendingPayment) : null;
    } catch {
      return null;
    }
  },
  set(requestId: string, pending: PendingPayment): void {
    try {
      globalThis.localStorage?.setItem(PENDING_PREFIX + requestId, JSON.stringify(pending));
    } catch {
      // Private mode: re-drive falls back to opening the prefilled dialog.
    }
  },
  clear(requestId: string): void {
    try {
      globalThis.localStorage?.removeItem(PENDING_PREFIX + requestId);
    } catch {
      // ignore
    }
  },
};

// ─── Reads ───────────────────────────────────────────────────────────────────────

export function useReleaseDraft(requestId: string, options?: { enabled?: boolean }): UseQueryResult<ReleaseDraft> {
  return useQuery({
    queryKey: paymentKeys.releaseDraft(requestId),
    queryFn: () => getReleaseDraft(requestId),
    enabled: options?.enabled ?? true,
    // Prefill must reflect what was released a moment ago (a top-up after a release).
    staleTime: 0,
  });
}

export function usePayDraft(requestId: string, options?: { enabled?: boolean }): UseQueryResult<PayDraft> {
  return useQuery({
    queryKey: paymentKeys.payDraft(requestId),
    queryFn: () => getPayDraft(requestId),
    enabled: options?.enabled ?? true,
    staleTime: 0,
  });
}

// ─── Cache wiring ────────────────────────────────────────────────────────────────

/**
 * After any payment command: write the returned read model into the request detail (no round
 * trip on a weak signal), then refresh everything that shows money for the PO — the request, the
 * queues, the drafts, advances, bills, payments, the PO's settlement, notifications.
 */
export function applyPaymentResult(qc: QueryClient, requestId: string, payment: unknown) {
  if (isPaymentReadModel(payment)) {
    qc.setQueryData<QuotationRequestDetail>(quotationKeys.detail(requestId), (old) =>
      old ? { ...old, payment: payment as QuotationPayment } : old,
    );
  }
  void qc.invalidateQueries({ queryKey: quotationKeys.detail(requestId) });
  void qc.invalidateQueries({ queryKey: quotationKeys.lists() });
  void qc.invalidateQueries({ queryKey: paymentKeys.all });
  void qc.invalidateQueries({ queryKey: procurementKeys.all, refetchType: 'active' });
  void qc.invalidateQueries({ queryKey: notificationKeys.all });
}

function refreshAfterRefusal(qc: QueryClient, requestId: string) {
  void qc.invalidateQueries({ queryKey: quotationKeys.detail(requestId) });
  void qc.invalidateQueries({ queryKey: paymentKeys.all });
}

// ─── Commands ────────────────────────────────────────────────────────────────────

/**
 * Release cash to the buyer (EVT-AP-007). Gated → the error carries `approvalInstanceId`; the
 * body is kept for the re-drive and the detail is refetched (state AWAITING_APPROVAL).
 */
export function useReleaseCash(requestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ReleaseCashPayload) => releaseCash(payload),
    meta: { flashRow: false, successToast: 'procurement.quotes.payment.feedback.released' },
    onSuccess: (result) => {
      pendingPaymentStore.clear(requestId);
      applyPaymentResult(qc, requestId, result?.payment);
    },
    onError: (error, payload) => {
      if (gatedInstanceOf(error)) pendingPaymentStore.set(requestId, { kind: 'release', body: payload });
      refreshAfterRefusal(qc, requestId);
    },
  });
}

/**
 * Pay the supplier from the award. 200 may still be unfinished: `awaiting: 'APPROVAL'` (bands)
 * or `'RELEASE_SIGNATURES'` (dual control) — the body is kept so *Finish* re-drives it.
 */
export function usePayFromAward(requestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PayFromAwardPayload) => payFromAward(payload),
    meta: {
      flashRow: false,
      successToast: 'procurement.quotes.payment.feedback.paid',
    },
    onSuccess: (result, payload) => {
      if (result?.awaiting) pendingPaymentStore.set(requestId, { kind: 'pay', body: payload });
      else pendingPaymentStore.clear(requestId);
      applyPaymentResult(qc, requestId, result?.payment);
    },
    onError: (error, payload) => {
      if (gatedInstanceOf(error)) pendingPaymentStore.set(requestId, { kind: 'pay', body: payload });
      refreshAfterRefusal(qc, requestId);
    },
  });
}

/** Record the store receipt into a bill and settle it. Silent — the screen shows the result. */
export function useRecordStoreDocument(requestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: RecordStoreDocumentPayload) => recordStoreDocument(payload),
    meta: { flashRow: false },
    onSuccess: () => applyPaymentResult(qc, requestId, null),
    onError: () => refreshAfterRefusal(qc, requestId),
  });
}

export function useRecordAdvanceReturn(requestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ advanceId, payload }: { advanceId: string; payload: AdvanceReturnPayload }) =>
      recordAdvanceReturn(advanceId, payload),
    meta: { flashRow: false, successToast: 'procurement.quotes.payment.feedback.changeRecorded' },
    onSuccess: (result) => applyPaymentResult(qc, requestId, (result as { payment?: unknown } | null)?.payment ?? result),
    onError: () => refreshAfterRefusal(qc, requestId),
  });
}

/** Reverse an advance (only while nothing is applied or returned — the server decides, R15). */
export function useReverseBuyerAdvance(requestId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ advanceId, payload }: { advanceId: string; payload: ReverseAdvancePayload }) =>
      reverseBuyerAdvance(advanceId, payload),
    meta: { flashRow: false, successToast: 'procurement.quotes.payment.feedback.reversed' },
    onSuccess: () => {
      if (requestId) applyPaymentResult(qc, requestId, null);
      else void qc.invalidateQueries({ queryKey: procurementKeys.all });
    },
  });
}

export function useChangePaymentPath(requestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ChangePaymentPathPayload) => changePaymentPath(requestId, payload),
    meta: { flashRow: false, successToast: 'procurement.quotes.payment.feedback.pathChanged' },
    onSuccess: (result) => {
      pendingPaymentStore.clear(requestId);
      const payment = isPaymentReadModel(result) ? result : (result as QuotationRequestDetail | null)?.payment;
      applyPaymentResult(qc, requestId, payment);
    },
    onError: () => refreshAfterRefusal(qc, requestId),
  });
}

export function useRejectStoreDocument(requestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason, note }: { id: string; reason: StoreDocumentRejectReason; note?: string }) =>
      rejectStoreDocument(id, reason, note),
    meta: { flashRow: false, successToast: 'procurement.quotes.payment.feedback.receiptRejected' },
    onSuccess: () => applyPaymentResult(qc, requestId, null),
    onError: () => refreshAfterRefusal(qc, requestId),
  });
}

export function useWithdrawStoreDocument(requestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => withdrawStoreDocument(id),
    meta: { flashRow: false },
    onSuccess: () => applyPaymentResult(qc, requestId, null),
    onError: () => refreshAfterRefusal(qc, requestId),
  });
}

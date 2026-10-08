'use client';

/**
 * React bindings for the quote photo upload queue (spec Q10). The queue lives outside React — it
 * must keep uploading after the screen unmounts — so components read it through
 * `useSyncExternalStore` and write the server's answer into the query cache as each quote binds.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { getUploadQueue } from '../quotations/capture/queue-instance';
import type { QueueItemView, UploadQueue } from '../quotations/capture/upload-queue';
import { applyQuotationDetail, quotationKeys } from './use-quotations';
import type { QuotationRequestDetail } from '../quotations/types';
import type { QueryClient } from '@tanstack/react-query';

/** A bound quote returns the detail; a bound store document does not — refetch the request then. */
function applyBound(qc: QueryClient, requestId: string, detail: QuotationRequestDetail | null) {
  if (detail) {
    applyQuotationDetail(qc, detail);
    return;
  }
  void qc.invalidateQueries({ queryKey: quotationKeys.detail(requestId) });
  void qc.invalidateQueries({ queryKey: quotationKeys.lists() });
}

const EMPTY: QueueItemView[] = [];

/** The tab's queue. Starting it resumes anything left from a previous page load. */
export function useUploadQueue(): UploadQueue {
  // Created lazily on the client; the server render never touches IndexedDB.
  const [queue] = useState(() => (typeof window === 'undefined' ? null : getUploadQueue()));
  return queue as UploadQueue;
}

/** Every pending item in the queue for the signed-in user. */
export function useQueueItems(): QueueItemView[] {
  const queue = useUploadQueue();
  return useSyncExternalStore(
    (listener) => queue?.subscribe(listener) ?? (() => undefined),
    () => queue?.getSnapshot() ?? EMPTY,
    () => EMPTY,
  );
}

/**
 * Pending uploads for one request, plus cache wiring: when the queue binds a quote, the returned
 * detail replaces the cached one (so "Saved" and the server's quote swap without a refetch).
 */
export function useQuoteUploads(requestId: string): QueueItemView[] {
  const queue = useUploadQueue();
  const qc = useQueryClient();
  const items = useQueueItems();

  useEffect(() => {
    if (!queue) return;
    return queue.onBound((boundRequestId, detail) => {
      if (boundRequestId === requestId) applyBound(qc, boundRequestId, detail);
    });
  }, [queue, qc, requestId]);

  // Quotes only: store receipts for the same request belong to the payment card (ADR-045).
  return useMemo(
    () => items.filter((item) => item.requestId === requestId && !item.target),
    [items, requestId],
  );
}

/**
 * Store receipts / invoices still on the phone for one request (ADR-045, P12), with the same
 * cache wiring: when one binds, the request is refetched so its payment block shows it.
 */
export function useStoreDocumentUploads(requestId: string): QueueItemView[] {
  const queue = useUploadQueue();
  const qc = useQueryClient();
  const items = useQueueItems();

  useEffect(() => {
    if (!queue) return;
    return queue.onBound((boundRequestId, detail) => {
      if (boundRequestId === requestId) applyBound(qc, boundRequestId, detail);
    });
  }, [queue, qc, requestId]);

  return useMemo(
    () => items.filter((item) => item.requestId === requestId && item.target?.type === 'storeDocument'),
    [items, requestId],
  );
}

/**
 * Mount anywhere a collector lands (quotes list, MR detail, capture screen): it starts the queue,
 * which resumes uploads left over from a reload, and keeps every list fresh as quotes bind.
 */
export function useResumeQuoteUploads(): void {
  const queue = useUploadQueue();
  const qc = useQueryClient();
  useEffect(() => {
    if (!queue) return;
    void queue.start();
    return queue.onBound((boundRequestId, detail) => applyBound(qc, boundRequestId, detail));
  }, [queue, qc]);
}

/**
 * One object URL per photo blob, created on first use and kept for the life of the tab.
 *
 * Not revoked on unmount: React's development double-mount (and any remount while the photo is
 * still queued) would otherwise revoke a URL that the next render still shows. A queued photo is a
 * few hundred KB after downscaling, so holding its URL until the tab closes is cheap.
 */
const objectUrls = new WeakMap<Blob, string>();

export function useObjectUrl(blob: Blob | null | undefined): string | null {
  if (!blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  let url = objectUrls.get(blob);
  if (!url) {
    url = URL.createObjectURL(blob);
    objectUrls.set(blob, url);
  }
  return url;
}

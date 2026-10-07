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
import { applyQuotationDetail } from './use-quotations';

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
      if (boundRequestId === requestId) applyQuotationDetail(qc, detail);
    });
  }, [queue, qc, requestId]);

  return useMemo(() => items.filter((item) => item.requestId === requestId), [items, requestId]);
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
    return queue.onBound((_requestId, detail) => applyQuotationDetail(qc, detail));
  }, [queue, qc]);
}

/** An object URL for a blob, revoked when the blob changes or the component unmounts. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const url = useMemo(
    () => (blob && typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(blob) : null),
    [blob],
  );
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

/**
 * The one upload queue for this browser tab, wired to the real network, storage and session.
 *
 * A module singleton on purpose: the queue must outlive the capture screen — the buyer can take
 * three photos and walk to the next request while the bytes are still going up.
 */

import { sessionStore } from '@/features/auth/session/session-store';
import { deleteFile, uploadFile } from '@/features/files/api/files-api';

import { addStoreDocumentPhoto, createStoreDocument } from '../../api/quotation-payment-api';
import { addQuote, addQuotePhoto } from '../../api/quotations-api';
import { IdbQueueStore } from './idb-store';
import { MemoryQueueStore, UploadQueue, type QueueStore } from './upload-queue';

let instance: UploadQueue | null = null;

function makeStore(): QueueStore {
  try {
    if (typeof indexedDB !== 'undefined' && indexedDB) {
      const idb = new IdbQueueStore(indexedDB);
      // Private browsing on some phones refuses IndexedDB at first use: fall back per call.
      const memory = new MemoryQueueStore();
      return {
        getAll: () => idb.getAll().catch(() => memory.getAll()),
        put: (item) => idb.put(item).catch(() => memory.put(item)),
        delete: (ref) => idb.delete(ref).catch(() => memory.delete(ref)),
      };
    }
  } catch {
    // fall through
  }
  return new MemoryQueueStore();
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC 4122 v4 from getRandomValues (older Safari has no randomUUID).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The tab's queue, started (loaded from IndexedDB and pumping) on first use. */
export function getUploadQueue(): UploadQueue {
  if (instance) return instance;
  const queue = new UploadQueue({
    store: makeStore(),
    upload: (file, name, onProgress) =>
      uploadFile(file instanceof File ? file : new File([file], name, { type: file.type || 'image/jpeg' }), {
        onProgress,
      }),
    addQuote,
    addPhoto: addQuotePhoto,
    addStoreDocument: createStoreDocument,
    addStoreDocumentPhoto,
    discardFile: (fileId) => deleteFile(fileId),
    owner: () => {
      const user = sessionStore.getState().user;
      return user ? `${user.orgId}:${user.id}` : null;
    },
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    uuid,
  });
  instance = queue;
  if (typeof window !== 'undefined') {
    window.addEventListener('online', queue.pump);
    // The phase shows "No signal" while offline; re-render it when that changes.
    window.addEventListener('offline', queue.pump);
    // A session restored after reload (or a sign-in) changes whose items may run.
    sessionStore.subscribe(queue.pump);
  }
  void queue.start();
  return queue;
}

/** Test seam: replace or reset the singleton. */
export function setUploadQueueForTests(queue: UploadQueue | null): void {
  instance = queue;
}

'use client';

import { useState, useSyncExternalStore } from 'react';

import { sessionStore } from '@/features/auth/session/session-store';
import { uploadFile } from '@/features/files/api/files-api';
import {
  attachGoodsReceiptFile,
  createGoodsReceipt,
  createMaterialRequest,
  postGoodsReceipt,
} from '@/features/procurement/api/procurement-api';

import { MemoryOutboxStore, Outbox, type OutboxItem, type OutboxStore } from './outbox';

const DB_NAME = 'rukna-form-outbox';
const STORE = 'items';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** One database, one store keyed by clientRef; photos are kept as Blobs (the quote queue's pattern). */
class IdbOutboxStore implements OutboxStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(private readonly factory: IDBFactory) {}
  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'clientRef' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    return this.db;
  }
  private async tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return request(run(db.transaction(STORE, mode).objectStore(STORE)));
  }
  async getAll() {
    return (await this.tx('readonly', (s) => s.getAll())) as OutboxItem[];
  }
  async put(item: OutboxItem) {
    await this.tx('readwrite', (s) => s.put(item));
  }
  async delete(ref: string) {
    await this.tx('readwrite', (s) => s.delete(ref));
  }
}

function makeStore(): OutboxStore {
  try {
    if (typeof indexedDB !== 'undefined' && indexedDB) {
      const idb = new IdbOutboxStore(indexedDB);
      const memory = new MemoryOutboxStore();
      return {
        getAll: () => idb.getAll().catch(() => memory.getAll()),
        put: (item) => idb.put(item).catch(() => memory.put(item)),
        delete: (ref) => idb.delete(ref).catch(() => memory.delete(ref)),
      };
    }
  } catch {
    // fall through
  }
  return new MemoryOutboxStore();
}

let instance: Outbox | null = null;

/** The tab's outbox, started on first use and flushed whenever signal or the session returns. */
export function getOutbox(): Outbox {
  if (instance) return instance;
  const outbox = new Outbox({
    store: makeStore(),
    owner: () => {
      const user = sessionStore.getState().user;
      return user ? `${user.orgId}:${user.id}` : null;
    },
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    upload: (blob, name) => uploadFile(blob instanceof File ? blob : new File([blob], name, { type: blob.type || 'image/jpeg' })),
    createMaterialRequest: (payload) => createMaterialRequest(payload as never) as Promise<{ id: string }>,
    createGoodsReceipt: (payload) => createGoodsReceipt(payload as never) as Promise<{ id: string; status: string }>,
    attachGoodsReceiptFile: (grnId, fileId) => attachGoodsReceiptFile(grnId, fileId),
    postGoodsReceipt: (grnId) => postGoodsReceipt(grnId),
    uuid: () => crypto.randomUUID(),
    now: () => Date.now(),
  });
  instance = outbox;
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void outbox.flush());
    sessionStore.subscribe(() => void outbox.flush());
  }
  void outbox.start();
  return outbox;
}

const EMPTY: OutboxItem[] = [];

export function useOutbox(): Outbox | null {
  const [outbox] = useState(() => (typeof window === 'undefined' ? null : getOutbox()));
  return outbox;
}

/** The signed-in person's items still on this phone. */
export function useOutboxItems(): OutboxItem[] {
  const outbox = useOutbox();
  const all = useSyncExternalStore(
    (l) => outbox?.subscribe(l) ?? (() => undefined),
    () => outbox?.getSnapshot() ?? EMPTY,
    () => EMPTY,
  );
  const user = sessionStore.getState().user;
  const owner = user ? `${user.orgId}:${user.id}` : null;
  return owner ? all.filter((i) => i.owner === owner) : EMPTY;
}

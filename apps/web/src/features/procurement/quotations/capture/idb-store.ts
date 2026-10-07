/**
 * IndexedDB persistence for the upload queue — a page reload or a closed tab must not lose a
 * photo the buyer took in the market. A deliberately tiny wrapper (no `idb` dependency, per the
 * spec): one database, one object store keyed by `clientRef`. Photo blobs are stored as Blobs.
 */

import type { QueueStore, QueuedQuote } from './upload-queue';

const DB_NAME = 'rukna-quote-uploads';
const DB_VERSION = 1;
const STORE = 'items';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IdbQueueStore implements QueueStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'clientRef' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    return this.db;
  }

  private async tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return request(run(db.transaction(STORE, mode).objectStore(STORE)));
  }

  async getAll(): Promise<QueuedQuote[]> {
    return (await this.tx('readonly', (store) => store.getAll())) as QueuedQuote[];
  }

  async put(item: QueuedQuote): Promise<void> {
    await this.tx('readwrite', (store) => store.put(item));
  }

  async delete(clientRef: string): Promise<void> {
    await this.tx('readwrite', (store) => store.delete(clientRef));
  }
}

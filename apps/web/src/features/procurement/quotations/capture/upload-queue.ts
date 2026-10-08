/**
 * ─── The quote photo upload queue (ADR-044 §9, spec Q10) ─────────────────────────────
 *
 * A buyer in a market has ~30 seconds and one bar of signal. The capture screen therefore never
 * waits on the network: a photo is put in this queue the moment it is taken, the store is picked
 * while the bytes are still moving, and the queue keeps trying — across a dropped connection and
 * a page reload — until the quote is bound to the request on the server.
 *
 * One queue item = one quote being added (a new quote with one or more pages), or extra pages for
 * a quote the server already has (`quoteId` preset). Per page: hash + presign → PUT → confirm
 * (files-api `uploadFile`), then the item binds: `POST quotes` (idempotent on `clientRef`, so a
 * retry after a lost response never creates a second quote) or `POST photos` for extra pages.
 *
 * Retry policy: network failures, 5xx, 408 and 429 back off 1 s → 2 s → … → 30 s and keep going
 * (weak signal is the normal case, not an error); offline pauses until the browser says `online`.
 * A refusal with a reason (409 frozen, duplicate photo, 400) stops and waits for the user — retry
 * or discard — because repeating it cannot succeed.
 *
 * Items belong to the signed-in user and organization: another person signing in on the same
 * phone must never upload — and so become the uploader of — someone else's photos (that would
 * corrupt the segregation-of-duties record). Their items are left untouched.
 *
 * ADR-045 phase 3 reuses the queue for store receipts and invoices: an item with a
 * `target.type = 'storeDocument'` uploads its pages the moment they are taken, like a quote, but
 * binds only once the buyer taps *Send receipt* (`sendStoreDocument`) — `POST
 * /procurement/store-documents` (idempotent on the same `clientRef`), then `POST …/photos` for any
 * page added after. The buyer never types an amount; there is no store to choose.
 *
 * The engine is plain TypeScript with its I/O injected, so the state machine is testable with
 * fake timers and an in-memory store. `queue-instance.ts` wires the browser.
 */

import type { CreateStoreDocumentPayload, StoreDocumentCommandResult, StoreDocumentKind } from '../payment-types';
import { storeDocumentIdOf } from '../payment-rules';
import type {
  AddQuotePayload,
  QuotationRequestDetail,
  QuotePhotoPayload,
  QuotePhotoSource,
} from '../types';

// ─── Model ───────────────────────────────────────────────────────────────────────

export interface StoreChoice {
  supplierId?: string;
  storeName?: string;
  /** What the buyer saw on the chip. */
  label: string;
}

export interface QueuedPage {
  id: string;
  file: Blob;
  name: string;
  capturedAt: string;
  source: QuotePhotoSource;
  /** Set once the bytes are in storage and confirmed READY. */
  fileId: string | null;
  bound: boolean;
}

/** A store receipt / invoice for an award PO (ADR-045) instead of a quote. */
export interface StoreDocumentTarget {
  type: 'storeDocument';
  purchaseOrderId: string;
  kind: StoreDocumentKind;
  /** Set by *Send receipt*: until then the pages upload but nothing is bound. */
  sent: boolean;
}

export interface QueuedQuote {
  clientRef: string;
  /** Absent: a quote (Phase 1). */
  target?: StoreDocumentTarget;
  /** `orgId:userId` of the person who took the photos. */
  owner: string;
  requestId: string;
  /**
   * The server quote — preset for extra pages, set after the first bind for a new quote. For a
   * store document item, the store document's id once created.
   */
  quoteId: string | null;
  store: StoreChoice | null;
  pages: QueuedPage[];
  attempts: number;
  nextAttemptAt: number;
  failure: { code: string; retryable: boolean } | null;
  createdAt: number;
}

export type QueuePhase =
  | 'queued'
  | 'uploading'
  | 'binding'
  | 'needsStore'
  /** A store document whose pages are all uploaded, waiting for *Send receipt*. */
  | 'ready'
  | 'retrying'
  | 'offline'
  | 'failed';

/** What the screen renders for one item. */
export interface QueueItemView {
  clientRef: string;
  target?: StoreDocumentTarget;
  requestId: string;
  quoteId: string | null;
  store: StoreChoice | null;
  pages: QueuedPage[];
  phase: QueuePhase;
  /** 0–1 across all pages while uploading; null when unknown. */
  progress: number | null;
  failureCode: string | null;
}

// ─── Ports ───────────────────────────────────────────────────────────────────────

export interface QueueStore {
  getAll(): Promise<QueuedQuote[]>;
  put(item: QueuedQuote): Promise<void>;
  delete(clientRef: string): Promise<void>;
}

export interface QueueDeps {
  store: QueueStore;
  upload: (file: Blob, name: string, onProgress: (fraction: number) => void) => Promise<string>;
  addQuote: (requestId: string, payload: AddQuotePayload) => Promise<QuotationRequestDetail>;
  addPhoto: (
    requestId: string,
    quoteId: string,
    payload: QuotePhotoPayload,
  ) => Promise<QuotationRequestDetail>;
  /** ADR-045: create a store document (idempotent on `clientRef`). */
  addStoreDocument?: (payload: CreateStoreDocumentPayload) => Promise<StoreDocumentCommandResult>;
  /** ADR-045: an extra page on a store document still SUBMITTED. */
  addStoreDocumentPhoto?: (id: string, payload: QuotePhotoPayload) => Promise<StoreDocumentCommandResult>;
  /** Best-effort clean-up of an uploaded file that will never be bound. */
  discardFile?: (fileId: string) => Promise<void>;
  /** `orgId:userId`, or null when nobody is signed in (the queue then idles). */
  owner: () => string | null;
  isOnline: () => boolean;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  uuid: () => string;
}

/** `detail` is null when a store document bound (its response is not the request's detail). */
export type BoundListener = (requestId: string, detail: QuotationRequestDetail | null) => void;

// ─── Error classification ────────────────────────────────────────────────────────

export const BACKOFF_START_MS = 1_000;
export const BACKOFF_CAP_MS = 30_000;

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_START_MS * 2 ** Math.max(0, attempts - 1));
}

interface ErrorLike {
  status?: number;
  code?: string;
  details?: Record<string, unknown>;
  name?: string;
}

/**
 * `retry` — the network or the server hiccuped; trying again can work.
 * `stop` — the server refused with a reason; only the user can resolve it.
 */
export function classifyError(error: unknown): { retryable: boolean; code: string } {
  const e = (error ?? {}) as ErrorLike;
  // fetch() rejects with a TypeError when the request never completes.
  if (error instanceof TypeError) return { retryable: true, code: 'NETWORK' };
  const status = typeof e.status === 'number' ? e.status : undefined;
  // A plain Error with no status is a fault on this device (no secure context, unreadable
  // file): repeating it cannot help, so it waits for the user.
  if (status === undefined) {
    return error instanceof Error ? { retryable: false, code: 'CLIENT' } : { retryable: true, code: 'NETWORK' };
  }
  if (e.name === 'StorageUploadError') {
    // 0 = dropped connection; 403 = the presigned URL expired — a retry presigns again.
    if (status === 0 || status === 403 || status >= 500 || status === 408 || status === 429) {
      return { retryable: true, code: 'STORAGE' };
    }
    return { retryable: false, code: 'STORAGE_REJECTED' };
  }
  const code = (e.details?.code as string | undefined) ?? e.code ?? `HTTP_${status}`;
  if (status === 0 || status >= 500 || status === 408 || status === 429 || status === 401) {
    return { retryable: true, code };
  }
  return { retryable: false, code };
}

// ─── Engine ──────────────────────────────────────────────────────────────────────

export class UploadQueue {
  private items = new Map<string, QueuedQuote>();
  private progress = new Map<string, number>();
  private inFlight: string | null = null;
  private running = false;
  private started = false;
  private timer: unknown = null;
  private listeners = new Set<() => void>();
  private boundListeners = new Set<BoundListener>();
  private snapshot: QueueItemView[] = [];

  constructor(private readonly deps: QueueDeps) {}

  /** Loads persisted items and starts working. Safe to call more than once. */
  async start(): Promise<void> {
    if (this.started) {
      this.pump();
      return;
    }
    this.started = true;
    try {
      const stored = await this.deps.store.getAll();
      for (const item of stored) {
        if (this.items.has(item.clientRef)) continue;
        // A reload resumes at once rather than sitting out the last back-off.
        this.items.set(
          item.clientRef,
          item.failure?.retryable ? { ...item, nextAttemptAt: 0 } : item,
        );
      }
    } catch {
      // A broken store must not stop capture; the queue runs in memory for this page.
    }
    this.emit();
    this.pump();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onBound(listener: BoundListener): () => void {
    this.boundListeners.add(listener);
    return () => this.boundListeners.delete(listener);
  }

  /** Stable between changes — for `useSyncExternalStore`. */
  getSnapshot = (): QueueItemView[] => this.snapshot;

  /** A new quote from one photo. Uploading starts at once; the store can be chosen later. */
  async capture(
    requestId: string,
    page: { file: Blob; name: string; capturedAt: string; source: QuotePhotoSource },
    store: StoreChoice | null = null,
  ): Promise<string | null> {
    const owner = this.deps.owner();
    if (!owner) return null;
    const clientRef = this.deps.uuid();
    const item: QueuedQuote = {
      clientRef,
      owner,
      requestId,
      quoteId: null,
      store,
      pages: [this.page(page)],
      attempts: 0,
      nextAttemptAt: 0,
      failure: null,
      createdAt: this.deps.now(),
    };
    await this.save(item);
    this.pump();
    return clientRef;
  }

  /** Extra pages for a quote the server already holds. */
  async capturePageForQuote(
    requestId: string,
    quoteId: string,
    page: { file: Blob; name: string; capturedAt: string; source: QuotePhotoSource },
  ): Promise<string | null> {
    const clientRef = await this.capture(requestId, page, null);
    if (!clientRef) return null;
    await this.update(clientRef, (item) => ({ ...item, quoteId }));
    return clientRef;
  }

  /**
   * ADR-045: the first page of a store receipt / invoice for an award PO. Uploads at once; binds
   * when `sendStoreDocument` is called.
   */
  async captureStoreDocument(
    requestId: string,
    target: { purchaseOrderId: string; kind: StoreDocumentKind },
    page: { file: Blob; name: string; capturedAt: string; source: QuotePhotoSource },
  ): Promise<string | null> {
    const owner = this.deps.owner();
    if (!owner) return null;
    const clientRef = this.deps.uuid();
    await this.save({
      clientRef,
      owner,
      requestId,
      target: { type: 'storeDocument', ...target, sent: false },
      quoteId: null,
      store: null,
      pages: [this.page(page)],
      attempts: 0,
      nextAttemptAt: 0,
      failure: null,
      createdAt: this.deps.now(),
    });
    this.pump();
    return clientRef;
  }

  /** *Send receipt*: the store document may now be created with the pages taken. */
  async sendStoreDocument(clientRef: string): Promise<void> {
    await this.update(clientRef, (item) =>
      item.target ? { ...item, target: { ...item.target, sent: true }, attempts: 0, nextAttemptAt: 0 } : item,
    );
    this.pump();
  }

  /** Another page for a quote still in the queue. */
  async addPage(
    clientRef: string,
    page: { file: Blob; name: string; capturedAt: string; source: QuotePhotoSource },
  ): Promise<void> {
    await this.update(clientRef, (item) => ({ ...item, pages: [...item.pages, this.page(page)] }));
    this.pump();
  }

  async setStore(clientRef: string, store: StoreChoice): Promise<void> {
    await this.update(clientRef, (item) => ({
      ...item,
      store,
      // A store refusal (e.g. a duplicate) may be cured by choosing again.
      failure: item.failure?.retryable === false ? null : item.failure,
      attempts: 0,
      nextAttemptAt: 0,
    }));
    this.pump();
  }

  /** "Tap to retry": forget the back-off and the refusal, try now. */
  async retry(clientRef: string): Promise<void> {
    await this.update(clientRef, (item) => ({ ...item, failure: null, attempts: 0, nextAttemptAt: 0 }));
    this.pump();
  }

  /** Drops the item. Uploaded-but-unbound files are released on a best-effort basis. */
  async discard(clientRef: string): Promise<void> {
    const item = this.items.get(clientRef);
    if (!item || this.inFlight === clientRef) return;
    this.items.delete(clientRef);
    this.progress.delete(clientRef);
    await this.deps.store.delete(clientRef).catch(() => undefined);
    this.emit();
    for (const page of item.pages) {
      if (page.fileId && !page.bound) void this.deps.discardFile?.(page.fileId).catch(() => undefined);
    }
  }

  /** Kick the worker: on enqueue, on `online`, on a timer, on page load. */
  pump = (): void => {
    if (!this.started || this.running) return;
    void this.run();
  };

  // ── internals ───────────────────────────────────────────────────────────────────

  private page(input: { file: Blob; name: string; capturedAt: string; source: QuotePhotoSource }): QueuedPage {
    return { id: this.deps.uuid(), ...input, fileId: null, bound: false };
  }

  private mine(item: QueuedQuote): boolean {
    return item.owner === this.deps.owner();
  }

  private async save(item: QueuedQuote): Promise<void> {
    this.items.set(item.clientRef, item);
    this.emit();
    await this.deps.store.put(item).catch(() => undefined);
  }

  private async update(clientRef: string, change: (item: QueuedQuote) => QueuedQuote): Promise<void> {
    const item = this.items.get(clientRef);
    if (!item) return;
    await this.save(change(item));
  }

  private workable(item: QueuedQuote): boolean {
    if (!this.mine(item)) return false;
    if (item.failure && !item.failure.retryable) return false;
    const pagesLeft = item.pages.some((p) => !p.bound);
    if (!pagesLeft) return true; // finished but not yet removed
    const needsUpload = item.pages.some((p) => !p.fileId);
    const canBind = item.target
      ? item.quoteId !== null || item.target.sent
      : item.quoteId !== null || item.store !== null;
    return needsUpload || canBind;
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      for (;;) {
        if (!this.deps.isOnline()) break;
        const now = this.deps.now();
        const next = [...this.items.values()]
          .filter((item) => this.workable(item) && item.nextAttemptAt <= now)
          .sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!next) break;
        await this.process(next.clientRef);
      }
    } finally {
      this.running = false;
      this.inFlight = null;
      this.emit();
      this.schedule();
    }
  }

  /** Arms one timer for the earliest back-off that is still waiting. */
  private schedule(): void {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    // Offline: nothing to time — the `online` event pumps the queue again.
    if (!this.deps.isOnline()) return;
    const waits = [...this.items.values()]
      .filter((item) => this.workable(item))
      .map((item) => item.nextAttemptAt);
    if (waits.length === 0) return;
    const delay = Math.max(0, Math.min(...waits) - this.deps.now());
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.pump();
    }, delay);
  }

  private async process(clientRef: string): Promise<void> {
    this.inFlight = clientRef;
    this.emit();
    try {
      await this.uploadPages(clientRef);
      await this.bind(clientRef);
      const item = this.items.get(clientRef);
      if (item && item.pages.every((p) => p.bound)) {
        this.items.delete(clientRef);
        this.progress.delete(clientRef);
        await this.deps.store.delete(clientRef).catch(() => undefined);
      }
    } catch (error) {
      const verdict = classifyError(error);
      const item = this.items.get(clientRef);
      if (item && verdict.code === 'CLIENT_REF_CONFLICT') {
        // The server holds a different quote under this clientRef: that key can never succeed.
        // Keep the photo, under a fresh key and with fresh uploads, and let the buyer re-add it.
        await this.replaceClientRef(item, verdict);
        return;
      }
      if (item) {
        const attempts = item.attempts + 1;
        await this.save({
          ...item,
          attempts,
          failure: verdict,
          nextAttemptAt: verdict.retryable ? this.deps.now() + backoffMs(attempts) : Number.POSITIVE_INFINITY,
        });
      }
    } finally {
      this.inFlight = null;
      this.emit();
    }
  }

  private async replaceClientRef(item: QueuedQuote, failure: { code: string; retryable: boolean }): Promise<void> {
    this.items.delete(item.clientRef);
    this.progress.delete(item.clientRef);
    await this.deps.store.delete(item.clientRef).catch(() => undefined);
    await this.save({
      ...item,
      clientRef: this.deps.uuid(),
      quoteId: null,
      pages: item.pages.map((page) => ({ ...page, fileId: null, bound: false })),
      attempts: 0,
      nextAttemptAt: Number.POSITIVE_INFINITY,
      failure: { code: failure.code, retryable: false },
    });
  }

  private async uploadPages(clientRef: string): Promise<void> {
    const item = this.items.get(clientRef);
    if (!item) return;
    const total = item.pages.length;
    for (let index = 0; index < item.pages.length; index += 1) {
      const current = this.items.get(clientRef);
      const page = current?.pages[index];
      if (!current || !page || page.fileId) continue;
      const fileId = await this.deps.upload(page.file, page.name, (fraction) => {
        this.progress.set(clientRef, (index + fraction) / total);
        this.emit();
      });
      const latest = this.items.get(clientRef);
      if (!latest) return; // discarded mid-upload
      await this.save({
        ...latest,
        pages: latest.pages.map((p) => (p.id === page.id ? { ...p, fileId } : p)),
      });
    }
  }

  private async bind(clientRef: string): Promise<void> {
    let item = this.items.get(clientRef);
    if (!item || item.pages.every((p) => p.bound)) return;
    if (item.target) {
      await this.bindStoreDocument(clientRef);
      return;
    }

    if (item.quoteId === null) {
      if (!item.store) return; // waits for the buyer to choose a store
      const pages = item.pages.filter((p) => p.fileId && !p.bound);
      if (pages.length === 0) return;
      const detail = await this.deps.addQuote(item.requestId, {
        clientRef: item.clientRef,
        ...(item.store.supplierId
          ? { supplierId: item.store.supplierId }
          : { storeName: item.store.storeName ?? item.store.label }),
        photos: pages.map((p) => photoPayload(p)),
      });
      const fileIds = new Set(pages.map((p) => p.fileId));
      const quote =
        detail.quotes?.find((q) => q.clientRef === item!.clientRef) ??
        detail.quotes?.find((q) => q.photos?.some((photo) => fileIds.has(photo.fileId)));
      item = this.items.get(clientRef) ?? item;
      await this.save({
        ...item,
        quoteId: quote?.id ?? null,
        pages: item.pages.map((p) => (fileIds.has(p.fileId) ? { ...p, bound: true } : p)),
        failure: null,
        attempts: 0,
      });
      this.notifyBound(item.requestId, detail);
      item = this.items.get(clientRef);
      if (!item || item.quoteId === null) return;
    }

    for (const page of item.pages) {
      if (page.bound || !page.fileId) continue;
      const detail = await this.deps.addPhoto(item.requestId, item.quoteId!, photoPayload(page));
      const latest = this.items.get(clientRef);
      if (!latest) return;
      await this.save({
        ...latest,
        pages: latest.pages.map((p) => (p.id === page.id ? { ...p, bound: true } : p)),
        failure: null,
        attempts: 0,
      });
      this.notifyBound(item.requestId, detail);
    }
  }

  private async bindStoreDocument(clientRef: string): Promise<void> {
    let item = this.items.get(clientRef);
    if (!item?.target) return;
    if (item.quoteId === null) {
      // Not sent yet, or a page is still uploading: the document is created with every page.
      if (!item.target.sent || item.pages.some((p) => !p.fileId)) return;
      if (!this.deps.addStoreDocument) throw new Error('Store documents are not wired');
      const pages = item.pages.filter((p) => !p.bound);
      const result = await this.deps.addStoreDocument({
        clientRef: item.clientRef,
        purchaseOrderId: item.target.purchaseOrderId,
        kind: item.target.kind,
        photos: pages.map((p) => photoPayload(p)),
      });
      const ids = new Set(pages.map((p) => p.id));
      item = this.items.get(clientRef) ?? item;
      await this.save({
        ...item,
        quoteId: storeDocumentIdOf(result) ?? 'bound',
        pages: item.pages.map((p) => (ids.has(p.id) ? { ...p, bound: true } : p)),
        failure: null,
        attempts: 0,
      });
      this.notifyBound(item.requestId, null);
      return;
    }
    for (const page of item.pages) {
      if (page.bound || !page.fileId) continue;
      if (!this.deps.addStoreDocumentPhoto) throw new Error('Store documents are not wired');
      await this.deps.addStoreDocumentPhoto(item.quoteId, photoPayload(page));
      const latest = this.items.get(clientRef);
      if (!latest) return;
      await this.save({
        ...latest,
        pages: latest.pages.map((p) => (p.id === page.id ? { ...p, bound: true } : p)),
        failure: null,
        attempts: 0,
      });
      this.notifyBound(item.requestId, null);
    }
  }

  private notifyBound(requestId: string, detail: QuotationRequestDetail | null) {
    for (const listener of this.boundListeners) listener(requestId, detail);
  }

  private phaseOf(item: QueuedQuote): QueuePhase {
    if (this.inFlight === item.clientRef) {
      return item.pages.some((p) => !p.fileId) ? 'uploading' : 'binding';
    }
    if (item.failure && !item.failure.retryable) return 'failed';
    const uploaded = item.pages.every((p) => p.fileId);
    // A store document waits for *Send receipt*, not for a store.
    if (item.target && uploaded && item.quoteId === null && !item.target.sent) return 'ready';
    if (!item.target && uploaded && item.quoteId === null && !item.store) return 'needsStore';
    if (!this.deps.isOnline()) return 'offline';
    if (item.failure?.retryable) return 'retrying';
    return 'queued';
  }

  private emit(): void {
    this.snapshot = [...this.items.values()]
      .filter((item) => this.mine(item))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((item) => ({
        clientRef: item.clientRef,
        ...(item.target ? { target: item.target } : {}),
        requestId: item.requestId,
        quoteId: item.quoteId,
        store: item.store,
        pages: item.pages,
        phase: this.phaseOf(item),
        progress: this.progress.get(item.clientRef) ?? null,
        failureCode: item.failure?.code ?? null,
      }));
    for (const listener of this.listeners) listener();
  }
}

function photoPayload(page: QueuedPage): QuotePhotoPayload {
  return { platformFileId: page.fileId!, capturedAt: page.capturedAt, source: page.source };
}

/** An in-memory store — tests, and the fallback when IndexedDB is unavailable. */
export class MemoryQueueStore implements QueueStore {
  private rows = new Map<string, QueuedQuote>();
  async getAll() {
    return [...this.rows.values()].map((row) => structuredCloneSafe(row));
  }
  async put(item: QueuedQuote) {
    this.rows.set(item.clientRef, structuredCloneSafe(item));
  }
  async delete(clientRef: string) {
    this.rows.delete(clientRef);
  }
}

/** Blobs survive by reference; everything else is copied, as IndexedDB would. */
function structuredCloneSafe(item: QueuedQuote): QueuedQuote {
  return {
    ...item,
    store: item.store ? { ...item.store } : null,
    ...(item.target ? { target: { ...item.target } } : {}),
    failure: item.failure ? { ...item.failure } : null,
    pages: item.pages.map((p) => ({ ...p })),
  };
}

import { ApiError } from '@/lib/api-client';

/**
 * Step 7 (owner decision 2026-10-28: queue and send later) — forms filled on site with no signal.
 *
 * A material request or a delivery-note receipt that cannot reach the server is kept on the phone
 * (IndexedDB) and sent by itself when signal returns. Each carries a `clientRef` the server stores,
 * so a send repeated after a lost reply returns the same record instead of a second one. Items are
 * scoped to the person and company that made them, and a refusal from the server (a 4xx — the
 * order was closed meanwhile, say) stops that item and shows why: it is never retried blindly.
 *
 * Photos for these forms travel with the item as a Blob and are uploaded when it is sent.
 */
export type OutboxKind = 'MATERIAL_REQUEST' | 'GOODS_RECEIPT';

export interface OutboxPhoto {
  blob: Blob;
  name: string;
  /** Set once uploaded, so a retry does not upload it again. */
  fileId?: string;
}

export interface OutboxItem {
  clientRef: string;
  kind: OutboxKind;
  /** `orgId:userId` — only that person, in that company, sends it. */
  owner: string;
  /** A short label for the list: "MR · 3 items", "Delivery for PO-00012". */
  label: string;
  payload: Record<string, unknown>;
  photo?: OutboxPhoto;
  createdAt: number;
  status: 'waiting' | 'sending' | 'failed';
  error?: string;
  /** Set once created on the server: later steps (attach, post) resume from here. */
  recordId?: string;
}

export interface OutboxStore {
  getAll(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  delete(clientRef: string): Promise<void>;
}

export interface OutboxDeps {
  store: OutboxStore;
  owner: () => string | null;
  isOnline: () => boolean;
  upload: (blob: Blob, name: string) => Promise<string>;
  createMaterialRequest: (payload: Record<string, unknown>) => Promise<{ id: string }>;
  createGoodsReceipt: (payload: Record<string, unknown>) => Promise<{ id: string; status: string }>;
  attachGoodsReceiptFile: (grnId: string, fileId: string) => Promise<unknown>;
  postGoodsReceipt: (grnId: string) => Promise<unknown>;
  uuid: () => string;
  now: () => number;
}

/** A form's own reference, made once per form (`useState(newClientRef)`). */
export function newClientRef(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `ref-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** No signal, or the server is down: keep it and send later. A 4xx is a real answer. */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

export class Outbox {
  private items = new Map<string, OutboxItem>();
  private snapshot: OutboxItem[] = [];
  private listeners = new Set<() => void>();
  private loaded: Promise<void> | null = null;
  private running = false;

  constructor(private readonly deps: OutboxDeps) {}

  start(): Promise<void> {
    this.loaded ??= this.deps.store.getAll().then((all) => {
      for (const item of all) this.items.set(item.clientRef, item.status === 'sending' ? { ...item, status: 'waiting' } : item);
      this.emit();
    });
    return this.loaded.then(() => this.flush());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot = (): OutboxItem[] => this.snapshot;

  /**
   * Send now, or keep it for later. Resolves `{ sent: id }` when the server took it, or
   * `{ queued: clientRef }` when it waits for signal. A refusal (4xx) rejects, as a normal send would.
   */
  async submit(kind: OutboxKind, label: string, payload: Record<string, unknown>, photo?: OutboxPhoto): Promise<{ sent: string } | { queued: string }> {
    await (this.loaded ?? this.start());
    const owner = this.deps.owner();
    if (!owner) throw new Error('Not signed in');
    const item: OutboxItem = {
      clientRef: this.deps.uuid(), kind, owner, label, payload: { ...payload }, ...(photo ? { photo } : {}),
      createdAt: this.deps.now(), status: 'waiting',
    };
    item.payload.clientRef = item.clientRef;
    if (this.deps.isOnline()) {
      try {
        return { sent: await this.send(item) };
      } catch (error) {
        if (!isRetryable(error)) throw error;
      }
    }
    await this.save(item);
    return { queued: item.clientRef };
  }

  /**
   * Keep a form for later without trying to send it — the form's own send just failed for want of
   * signal, or the phone is offline. `clientRef` is the one the form already sent (or would have),
   * so a send that did reach the server is not repeated as a second record; `recordId` is set when
   * a goods receipt was already created and only its posting is left.
   */
  async queue(
    kind: OutboxKind,
    label: string,
    payload: Record<string, unknown> & { clientRef: string },
    extra: { photo?: OutboxPhoto; recordId?: string } = {},
  ): Promise<string> {
    await (this.loaded ?? this.start());
    const owner = this.deps.owner();
    if (!owner) throw new Error('Not signed in');
    await this.save({
      clientRef: payload.clientRef, kind, owner, label, payload: { ...payload },
      ...(extra.photo ? { photo: extra.photo } : {}), ...(extra.recordId ? { recordId: extra.recordId } : {}),
      createdAt: this.deps.now(), status: 'waiting',
    });
    return payload.clientRef;
  }

  /** Send every waiting item of the signed-in person, oldest first. Safe to call often. */
  flush = async (): Promise<void> => {
    if (this.running || !this.deps.isOnline()) return;
    const owner = this.deps.owner();
    if (!owner) return;
    this.running = true;
    try {
      const mine = [...this.items.values()].filter((i) => i.owner === owner && i.status === 'waiting').sort((a, b) => a.createdAt - b.createdAt);
      for (const item of mine) {
        await this.save({ ...item, status: 'sending' });
        try {
          await this.send(this.items.get(item.clientRef)!);
          this.items.delete(item.clientRef);
          await this.deps.store.delete(item.clientRef);
          this.emit();
        } catch (error) {
          const current = this.items.get(item.clientRef) ?? item;
          if (isRetryable(error)) {
            await this.save({ ...current, status: 'waiting' });
            break; // still no signal: the rest would fail the same way
          }
          await this.save({ ...current, status: 'failed', error: error instanceof Error ? error.message : String(error) });
        }
      }
    } finally {
      this.running = false;
    }
  };

  /** Try a failed item again (after the person fixed what the server refused). */
  async retry(clientRef: string): Promise<void> {
    const item = this.items.get(clientRef);
    if (!item) return;
    await this.save({ ...item, status: 'waiting', error: undefined });
    await this.flush();
  }

  async discard(clientRef: string): Promise<void> {
    this.items.delete(clientRef);
    await this.deps.store.delete(clientRef);
    this.emit();
  }

  /** One item, step by step; each finished step is saved so a retry resumes after it. */
  private async send(item: OutboxItem): Promise<string> {
    let current = item;
    if (current.photo && !current.photo.fileId) {
      const fileId = await this.deps.upload(current.photo.blob, current.photo.name);
      current = { ...current, photo: { ...current.photo, fileId } };
      if (this.items.has(current.clientRef)) await this.save(current);
    }
    if (current.kind === 'MATERIAL_REQUEST') {
      return (await this.deps.createMaterialRequest(current.payload)).id;
    }
    if (!current.recordId) {
      const grn = await this.deps.createGoodsReceipt(current.payload);
      current = { ...current, recordId: grn.id };
      if (this.items.has(current.clientRef)) await this.save(current);
      if (current.photo?.fileId) await this.deps.attachGoodsReceiptFile(grn.id, current.photo.fileId).catch(() => undefined);
      // A receipt held for an exception is left for its detail screen, never forced through.
      if (grn.status === 'EXCEPTION_PENDING') return grn.id;
    }
    await this.deps.postGoodsReceipt(current.recordId!);
    return current.recordId!;
  }

  private async save(item: OutboxItem): Promise<void> {
    this.items.set(item.clientRef, item);
    await this.deps.store.put(item);
    this.emit();
  }

  private emit(): void {
    this.snapshot = [...this.items.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const l of this.listeners) l();
  }
}

export class MemoryOutboxStore implements OutboxStore {
  private readonly map = new Map<string, OutboxItem>();
  async getAll() {
    return [...this.map.values()];
  }
  async put(item: OutboxItem) {
    this.map.set(item.clientRef, item);
  }
  async delete(ref: string) {
    this.map.delete(ref);
  }
}

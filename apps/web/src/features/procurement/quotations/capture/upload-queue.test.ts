import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AddQuotePayload, QuotationRequestDetail } from '../types';
import {
  BACKOFF_CAP_MS,
  MemoryQueueStore,
  UploadQueue,
  backoffMs,
  classifyError,
  type QueueDeps,
} from './upload-queue';

class HttpError extends Error {
  constructor(
    public status: number,
    public code?: string,
    public details?: Record<string, unknown>,
  ) {
    super(`HTTP ${status}`);
  }
}

function detailWith(quotes: Array<{ id: string; clientRef?: string; fileIds: string[] }>): QuotationRequestDetail {
  return {
    id: 'qr1',
    quotes: quotes.map((q) => ({
      id: q.id,
      clientRef: q.clientRef,
      photos: q.fileIds.map((fileId, i) => ({ fileId, pageNumber: i + 1 })),
    })),
  } as unknown as QuotationRequestDetail;
}

const page = (name = 'p.jpg') => ({
  file: new Blob(['x'], { type: 'image/jpeg' }),
  name,
  capturedAt: '2026-10-07T07:30:00.000Z',
  source: 'CAMERA' as const,
});

function harness(overrides: Partial<QueueDeps> = {}, store = new MemoryQueueStore()) {
  let fileSeq = 0;
  let idSeq = 0;
  const state = { online: true, owner: 'org1:u1' as string | null };
  const upload = vi.fn(async (_file: Blob, _name: string, onProgress: (f: number) => void) => {
    onProgress(0.5);
    onProgress(1);
    fileSeq += 1;
    return `file-${fileSeq}`;
  });
  const addQuote = vi.fn(async (_id: string, payload: AddQuotePayload) =>
    detailWith([{ id: 'quote-1', clientRef: payload.clientRef, fileIds: payload.photos.map((p) => p.platformFileId) }]),
  );
  const addPhoto = vi.fn(async () => detailWith([]));
  const deps: QueueDeps = {
    store,
    upload,
    addQuote,
    addPhoto,
    discardFile: vi.fn(async () => undefined),
    owner: () => state.owner,
    isOnline: () => state.online,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    uuid: () => `id-${++idSeq}`,
    ...overrides,
  };
  const queue = new UploadQueue(deps);
  return { queue, deps, state, upload, addQuote, addPhoto, store };
}

/** Let the queue's promise chain settle. */
async function settle() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

describe('upload queue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T07:30:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uploads at once, waits for a store, then binds the quote with clientRef', async () => {
    const { queue, upload, addQuote } = harness();
    await queue.start();
    const ref = await queue.capture('qr1', page());
    await settle();

    expect(upload).toHaveBeenCalledTimes(1);
    expect(addQuote).not.toHaveBeenCalled();
    expect(queue.getSnapshot()[0]?.phase).toBe('needsStore');

    await queue.setStore(ref!, { storeName: 'Hodan Hardware', label: 'Hodan Hardware' });
    await settle();

    expect(addQuote).toHaveBeenCalledWith('qr1', {
      clientRef: ref,
      storeName: 'Hodan Hardware',
      photos: [{ platformFileId: 'file-1', capturedAt: page().capturedAt, source: 'CAMERA' }],
    });
    // Bound items leave the queue: the server's quote takes over.
    expect(queue.getSnapshot()).toEqual([]);
  });

  it('sends a registered supplier as supplierId and every page of the quote', async () => {
    const { queue, addQuote } = harness();
    await queue.start();
    const ref = await queue.capture('qr1', page('a.jpg'));
    await queue.addPage(ref!, page('b.jpg'));
    await queue.setStore(ref!, { supplierId: 's1', label: 'Xamar Steel' });
    await settle();
    const payload = addQuote.mock.calls[0]![1];
    expect(payload.supplierId).toBe('s1');
    expect(payload.storeName).toBeUndefined();
    expect(payload.photos.map((p) => p.platformFileId)).toEqual(['file-1', 'file-2']);
  });

  it('backs off on a network failure (1 s, 2 s, … capped at 30 s) and recovers without user action', async () => {
    let failures = 2;
    const { queue, upload } = harness({
      upload: vi.fn(async () => {
        if (failures > 0) {
          failures -= 1;
          throw new TypeError('Failed to fetch');
        }
        return 'file-ok';
      }),
    });
    await queue.start();
    await queue.capture('qr1', page(), { storeName: 'Bakaara', label: 'Bakaara' });
    await settle();
    expect(queue.getSnapshot()[0]?.phase).toBe('retrying');

    await vi.advanceTimersByTimeAsync(999);
    expect(queue.getSnapshot()[0]?.phase).toBe('retrying');
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    // Second failure: now waits 2 s.
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();
    expect(queue.getSnapshot()).toEqual([]);
    expect(backoffMs(1)).toBe(1_000);
    expect(backoffMs(2)).toBe(2_000);
    expect(backoffMs(20)).toBe(BACKOFF_CAP_MS);
    void upload;
  });

  it('pauses while offline and resumes on the online event', async () => {
    const { queue, state, upload } = harness();
    state.online = false;
    await queue.start();
    await queue.capture('qr1', page(), { storeName: 'Xamar', label: 'Xamar' });
    await settle();
    expect(upload).not.toHaveBeenCalled();
    expect(queue.getSnapshot()[0]?.phase).toBe('offline');

    state.online = true;
    queue.pump();
    await settle();
    expect(queue.getSnapshot()).toEqual([]);
  });

  it('stops on a refusal with a reason and waits for tap-to-retry or discard', async () => {
    let refuse = true;
    const addQuote = vi.fn(async (_id: string, payload: AddQuotePayload) => {
      if (refuse) throw new HttpError(409, 'CONFLICT', { code: 'QUOTE_PHOTO_DUPLICATE' });
      return detailWith([{ id: 'quote-9', clientRef: payload.clientRef, fileIds: ['file-1'] }]);
    });
    const { queue } = harness({ addQuote });
    await queue.start();
    const ref = await queue.capture('qr1', page(), { storeName: 'Hodan', label: 'Hodan' });
    await settle();

    const item = queue.getSnapshot()[0]!;
    expect(item.phase).toBe('failed');
    expect(item.failureCode).toBe('QUOTE_PHOTO_DUPLICATE');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(addQuote).toHaveBeenCalledTimes(1);

    refuse = false;
    await queue.retry(ref!);
    await settle();
    expect(addQuote).toHaveBeenCalledTimes(2);
    expect(queue.getSnapshot()).toEqual([]);
  });

  it('resumes after a reload: persisted uploads are not repeated and the quote binds once', async () => {
    const store = new MemoryQueueStore();
    const first = harness({}, store);
    await first.queue.start();
    await first.queue.capture('qr1', page());
    await settle();
    expect(first.upload).toHaveBeenCalledTimes(1); // uploaded, waiting for a store

    // "Reload": a new queue over the same store.
    const second = harness({}, store);
    await second.queue.start();
    await settle();
    const ref = second.queue.getSnapshot()[0]!.clientRef;
    expect(second.queue.getSnapshot()[0]!.phase).toBe('needsStore');
    await second.queue.setStore(ref, { storeName: 'Hodan', label: 'Hodan' });
    await settle();

    expect(second.upload).not.toHaveBeenCalled();
    expect(second.addQuote).toHaveBeenCalledTimes(1);
    expect(second.addQuote.mock.calls[0]![1].photos[0]!.platformFileId).toBe('file-1');
  });

  it('replays POST quotes with the same clientRef when the response was lost (no duplicate quote)', async () => {
    let calls = 0;
    const refs: string[] = [];
    const addQuote = vi.fn(async (_id: string, payload: AddQuotePayload) => {
      calls += 1;
      refs.push(payload.clientRef);
      if (calls === 1) throw new TypeError('connection reset'); // server stored it, reply lost
      return detailWith([{ id: 'quote-1', clientRef: payload.clientRef, fileIds: ['file-1'] }]);
    });
    const { queue } = harness({ addQuote });
    await queue.start();
    await queue.capture('qr1', page(), { storeName: 'Hodan', label: 'Hodan' });
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(refs).toHaveLength(2);
    expect(refs[0]).toBe(refs[1]);
    expect(queue.getSnapshot()).toEqual([]);
  });

  it('adds extra pages to a quote the server already holds through POST photos', async () => {
    const { queue, addQuote, addPhoto } = harness();
    await queue.start();
    await queue.capturePageForQuote('qr1', 'quote-7', page());
    await settle();
    expect(addQuote).not.toHaveBeenCalled();
    expect(addPhoto).toHaveBeenCalledWith('qr1', 'quote-7', {
      platformFileId: 'file-1',
      capturedAt: page().capturedAt,
      source: 'CAMERA',
    });
  });

  it("never runs another user's items", async () => {
    const store = new MemoryQueueStore();
    const mine = harness({}, store);
    await mine.queue.start();
    await mine.queue.capture('qr1', page());
    await settle();

    const other = harness({ owner: () => 'org1:someone-else' }, store);
    await other.queue.start();
    await settle();
    expect(other.queue.getSnapshot()).toEqual([]);
    expect(other.upload).not.toHaveBeenCalled();
    expect(await store.getAll()).toHaveLength(1);
  });

  it('discard drops the item and releases its uploaded file', async () => {
    const { queue, deps } = harness();
    await queue.start();
    const ref = await queue.capture('qr1', page());
    await settle();
    await queue.discard(ref!);
    expect(queue.getSnapshot()).toEqual([]);
    expect(deps.discardFile).toHaveBeenCalledWith('file-1');
  });

  it('classifies errors: transient retries, refusals stop', () => {
    expect(classifyError(new TypeError('x')).retryable).toBe(true);
    expect(classifyError(new HttpError(503)).retryable).toBe(true);
    expect(classifyError(new HttpError(429)).retryable).toBe(true);
    expect(classifyError(new HttpError(409, 'X', { code: 'QUOTATION_FROZEN' }))).toEqual({
      retryable: false,
      code: 'QUOTATION_FROZEN',
    });
    const storage = Object.assign(new Error('x'), { name: 'StorageUploadError', status: 403 });
    expect(classifyError(storage).retryable).toBe(true);
    expect(classifyError(new Error('no secure context')).retryable).toBe(false);
  });

  it('never retries a CLIENT_REF_CONFLICT under the same clientRef: keeps the photo for a fresh add', async () => {
    const refs: string[] = [];
    let conflict = true;
    const addQuote = vi.fn(async (_id: string, payload: AddQuotePayload) => {
      refs.push(payload.clientRef);
      if (conflict) throw new HttpError(409, 'CLIENT_REF_CONFLICT', { code: 'CLIENT_REF_CONFLICT' });
      return detailWith([{ id: 'quote-2', clientRef: payload.clientRef, fileIds: payload.photos.map((p) => p.platformFileId) }]);
    });
    const { queue, upload } = harness({ addQuote });
    await queue.start();
    const first = await queue.capture('qr1', page(), { storeName: 'Hodan', label: 'Hodan' });
    await settle();

    const item = queue.getSnapshot()[0]!;
    expect(item.phase).toBe('failed');
    expect(item.failureCode).toBe('CLIENT_REF_CONFLICT');
    expect(item.clientRef).not.toBe(first);
    expect(item.pages).toHaveLength(1); // the photo is kept
    await vi.advanceTimersByTimeAsync(120_000);
    expect(addQuote).toHaveBeenCalledTimes(1);

    conflict = false;
    await queue.retry(item.clientRef);
    await settle();
    expect(refs).toEqual([first, item.clientRef]);
    expect(upload).toHaveBeenCalledTimes(2); // fresh upload for the fresh quote
    expect(queue.getSnapshot()).toEqual([]);
  });
});

describe('upload queue — store receipts (ADR-045 P12)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T07:30:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function receiptHarness(createImpl?: () => Promise<unknown>) {
    const addStoreDocument = vi.fn(
      createImpl ?? (async () => ({ id: 'sd-1', number: 'SD-00019', status: 'SUBMITTED' })),
    );
    const addStoreDocumentPhoto = vi.fn(async () => ({ id: 'sd-1' }));
    const h = harness({
      addStoreDocument: addStoreDocument as unknown as QueueDeps['addStoreDocument'],
      addStoreDocumentPhoto: addStoreDocumentPhoto as unknown as QueueDeps['addStoreDocumentPhoto'],
    });
    return { ...h, addStoreDocument, addStoreDocumentPhoto };
  }

  it('uploads the pages at once but creates the document only on Send, with every page and no amount', async () => {
    const { queue, upload, addStoreDocument, addQuote } = receiptHarness();
    await queue.start();
    const ref = await queue.captureStoreDocument('qr1', { purchaseOrderId: 'po1', kind: 'RECEIPT' }, page('a.jpg'));
    await queue.addPage(ref!, page('b.jpg'));
    await settle();

    expect(upload).toHaveBeenCalledTimes(2);
    expect(addStoreDocument).not.toHaveBeenCalled();
    expect(queue.getSnapshot()[0]?.phase).toBe('ready');

    await queue.sendStoreDocument(ref!);
    await settle();

    expect(addQuote).not.toHaveBeenCalled();
    expect(addStoreDocument).toHaveBeenCalledTimes(1);
    const payload = (addStoreDocument.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(payload).toEqual({
      clientRef: ref,
      purchaseOrderId: 'po1',
      kind: 'RECEIPT',
      photos: [
        { platformFileId: 'file-1', capturedAt: page().capturedAt, source: 'CAMERA' },
        { platformFileId: 'file-2', capturedAt: page().capturedAt, source: 'CAMERA' },
      ],
    });
    expect(Object.keys(payload)).not.toContain('amount');
    expect(Object.keys(payload)).not.toContain('total');
    expect(queue.getSnapshot()).toEqual([]);
  });

  it('retries a lost response with the same clientRef, so the server keeps one document', async () => {
    let failures = 1;
    const { queue, addStoreDocument } = receiptHarness(async () => {
      if (failures > 0) {
        failures -= 1;
        throw new TypeError('Failed to fetch');
      }
      return { storeDocument: { id: 'sd-1' } };
    });
    await queue.start();
    const ref = await queue.captureStoreDocument('qr1', { purchaseOrderId: 'po1', kind: 'RECEIPT' }, page());
    await queue.sendStoreDocument(ref!);
    await settle();
    expect(queue.getSnapshot()[0]?.phase).toBe('retrying');

    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(addStoreDocument).toHaveBeenCalledTimes(2);
    const refs = addStoreDocument.mock.calls.map((call) => (call as unknown as [{ clientRef: string }])[0].clientRef);
    expect(refs).toEqual([ref, ref]);
    expect(queue.getSnapshot()).toEqual([]);
  });

  it('waits while offline and sends when the signal is back', async () => {
    const { queue, state, addStoreDocument } = receiptHarness();
    await queue.start();
    state.online = false;
    const ref = await queue.captureStoreDocument('qr1', { purchaseOrderId: 'po1', kind: 'INVOICE' }, page());
    await queue.sendStoreDocument(ref!);
    await settle();
    expect(queue.getSnapshot()[0]?.phase).toBe('offline');
    expect(addStoreDocument).not.toHaveBeenCalled();

    state.online = true;
    queue.pump();
    await settle();
    expect(addStoreDocument).toHaveBeenCalledTimes(1);
    expect((addStoreDocument.mock.calls[0] as unknown as [{ kind: string }])[0].kind).toBe('INVOICE');
  });

  it('stops on a duplicate-photo refusal and waits for the buyer', async () => {
    const { queue } = receiptHarness(async () => {
      throw new HttpError(409, 'CONFLICT', { code: 'STORE_DOCUMENT_PHOTO_DUPLICATE' });
    });
    await queue.start();
    const ref = await queue.captureStoreDocument('qr1', { purchaseOrderId: 'po1', kind: 'RECEIPT' }, page());
    await queue.sendStoreDocument(ref!);
    await settle();
    const item = queue.getSnapshot()[0]!;
    expect(item.phase).toBe('failed');
    expect(item.failureCode).toBe('STORE_DOCUMENT_PHOTO_DUPLICATE');
  });
});

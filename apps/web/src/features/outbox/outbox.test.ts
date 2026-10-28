import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';

import { MemoryOutboxStore, Outbox, type OutboxDeps } from './outbox';

function make(over: Partial<OutboxDeps> = {}) {
  let n = 0;
  let online = true;
  const deps: OutboxDeps = {
    store: new MemoryOutboxStore(),
    owner: () => 'org1:user1',
    isOnline: () => online,
    upload: vi.fn(async () => 'file-1'),
    createMaterialRequest: vi.fn(async () => ({ id: 'mr-1' })),
    createGoodsReceipt: vi.fn(async () => ({ id: 'grn-1', status: 'DRAFT' })),
    attachGoodsReceiptFile: vi.fn(async () => undefined),
    postGoodsReceipt: vi.fn(async () => undefined),
    uuid: () => `ref-${++n}`,
    now: () => n,
    ...over,
  };
  return { outbox: new Outbox(deps), deps, setOnline: (v: boolean) => { online = v; } };
}

describe('form outbox (Step 7)', () => {
  it('sends at once when there is signal, with the clientRef', async () => {
    const { outbox, deps } = make();
    await expect(outbox.submit('MATERIAL_REQUEST', 'MR', { lines: [] })).resolves.toEqual({ sent: 'mr-1' });
    expect(deps.createMaterialRequest).toHaveBeenCalledWith({ lines: [], clientRef: 'ref-1' });
    expect(outbox.getSnapshot()).toEqual([]);
  });

  it('keeps it with no signal and sends the receipt, its photo and the post when signal returns', async () => {
    const { outbox, deps, setOnline } = make();
    setOnline(false);
    const photo = { blob: new Blob(['x']), name: 'note.jpg' };
    await expect(outbox.submit('GOODS_RECEIPT', 'Delivery', { purchaseOrderId: 'po1' }, photo)).resolves.toEqual({ queued: 'ref-1' });
    expect(outbox.getSnapshot()).toHaveLength(1);
    expect(deps.createGoodsReceipt).not.toHaveBeenCalled();

    setOnline(true);
    await outbox.flush();
    expect(deps.upload).toHaveBeenCalledTimes(1);
    expect(deps.createGoodsReceipt).toHaveBeenCalledWith({ purchaseOrderId: 'po1', clientRef: 'ref-1' });
    expect(deps.attachGoodsReceiptFile).toHaveBeenCalledWith('grn-1', 'file-1');
    expect(deps.postGoodsReceipt).toHaveBeenCalledWith('grn-1');
    expect(outbox.getSnapshot()).toEqual([]);
  });

  it('queues on a dropped connection, and resumes after the step that finished', async () => {
    const post = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(undefined);
    const { outbox, deps } = make({ postGoodsReceipt: post });
    await expect(outbox.submit('GOODS_RECEIPT', 'Delivery', { purchaseOrderId: 'po1' })).resolves.toEqual({ queued: 'ref-1' });
    // The receipt was created before the connection dropped; the retry must not create a second.
    await outbox.flush();
    expect(deps.createGoodsReceipt).toHaveBeenCalledTimes(2); // first send, then the queued item re-sent with its clientRef
    expect(post).toHaveBeenCalledTimes(2);
    expect(outbox.getSnapshot()).toEqual([]);
  });

  it('a refusal from the server is shown, not retried; only the owner sends their items', async () => {
    const refuse = vi.fn().mockRejectedValue(new ApiError(409, 'The order is closed'));
    const { outbox, setOnline } = make({ createGoodsReceipt: refuse });
    await expect(outbox.submit('GOODS_RECEIPT', 'Delivery', {})).rejects.toThrow('The order is closed');

    setOnline(false);
    await outbox.submit('GOODS_RECEIPT', 'Delivery', {});
    setOnline(true);
    await outbox.flush();
    expect(outbox.getSnapshot()[0]).toMatchObject({ status: 'failed', error: 'The order is closed' });
    expect(refuse).toHaveBeenCalledTimes(2);
  });

  it('keeps a form that failed for want of signal, and only posts a receipt that was already created', async () => {
    const { outbox, deps } = make();
    await outbox.queue('GOODS_RECEIPT', 'Delivery', { purchaseOrderId: 'po1', clientRef: 'form-ref' }, { recordId: 'grn-9' });
    await outbox.flush();
    expect(deps.createGoodsReceipt).not.toHaveBeenCalled();
    expect(deps.postGoodsReceipt).toHaveBeenCalledWith('grn-9');
  });
});

import { describe, expect, it } from 'vitest';

import {
  actionEnabled,
  allTotalsEntered,
  byWaitingDesc,
  collectTarget,
  durationParts,
  findAction,
  lowestQuoteIds,
  selectionBarCode,
  sendBlock,
  storeKey,
} from './quote-rules';
import type { QuotationAllowedAction } from './types';

describe('findAction / actionEnabled', () => {
  const actions: QuotationAllowedAction[] = [
    { action: 'ENTER_TOTAL', enabled: false, reasonCode: 'QUOTE_UPLOADER_CANNOT_SELECT' },
    { action: 'REOPEN', enabled: true, reasonCode: null },
  ];
  it('finds the verdict by the server action name', () => {
    expect(findAction(actions, 'ENTER_TOTAL')?.enabled).toBe(false);
    expect(findAction(actions, 'REOPEN')?.enabled).toBe(true);
    expect(findAction(actions, 'AWARD')).toBeNull();
  });
  it('falls back only when the server sent no verdict', () => {
    expect(actionEnabled(actions, 'ENTER_TOTAL', true)).toBe(false);
    expect(actionEnabled(actions, 'AWARD', true)).toBe(true);
    expect(actionEnabled(undefined, 'AWARD', false)).toBe(false);
  });
  it('reads the SoD bar from the server, never computing it', () => {
    expect(selectionBarCode({ allowedActions: actions })).toBe('QUOTE_UPLOADER_CANNOT_SELECT');
    expect(
      selectionBarCode({ allowedActions: [{ action: 'AWARD', enabled: false, reasonCode: 'QUOTE_TOTALS_MISSING' }] }),
    ).toBeNull();
    expect(selectionBarCode({ allowedActions: [] })).toBeNull();
  });
});

describe('storeKey', () => {
  it('normalises case and spaces for a new store, and uses the id for a supplier', () => {
    expect(storeKey({ storeName: '  Hodan   Hardware ' })).toBe('name:hodan hardware');
    expect(storeKey({ name: 'HODAN hardware' })).toBe('name:hodan hardware');
    expect(storeKey({ supplierId: 's1', storeName: 'whatever' })).toBe('supplier:s1');
  });
});

describe('collectTarget', () => {
  it('uses the server count, and asks for 3 when a visible estimate is unknown', () => {
    expect(collectTarget({ requiredQuoteCount: 1, estimateAmount: '80.00', moneyVisible: true })).toBe(1);
    expect(collectTarget({ requiredQuoteCount: 3, estimateAmount: '800.00', moneyVisible: true })).toBe(3);
    expect(collectTarget({ requiredQuoteCount: 1, estimateAmount: null, moneyVisible: true })).toBe(3);
    // Money-blind: null means hidden, not unknown — trust the server.
    expect(collectTarget({ requiredQuoteCount: 1, estimateAmount: null, moneyVisible: false })).toBe(1);
  });
});

describe('sendBlock', () => {
  const base = { pending: [], savedDistinct: 3, savedCount: 3, target: 3, exceptionReason: null };
  it('allows send with enough stores and nothing pending', () => {
    expect(sendBlock(base)).toBeNull();
  });
  it('blocks while uploads are moving, a store is missing, or one failed — failure first', () => {
    expect(sendBlock({ ...base, pending: [{ phase: 'uploading' }, { phase: 'retrying' }] })).toEqual({
      kind: 'uploading',
      count: 2,
    });
    expect(sendBlock({ ...base, pending: [{ phase: 'needsStore' }, { phase: 'uploading' }] })).toEqual({
      kind: 'needsStore',
      count: 1,
    });
    expect(sendBlock({ ...base, pending: [{ phase: 'failed' }, { phase: 'needsStore' }] })).toEqual({
      kind: 'failed',
      count: 1,
    });
  });
  it('needs at least one quote', () => {
    expect(sendBlock({ ...base, savedCount: 0, savedDistinct: 0 })).toEqual({ kind: 'empty' });
  });
  it('needs a reason chip only when short', () => {
    expect(sendBlock({ ...base, savedDistinct: 1, savedCount: 1 })).toEqual({ kind: 'reason' });
    expect(sendBlock({ ...base, savedDistinct: 1, savedCount: 1, exceptionReason: 'URGENT' })).toBeNull();
  });
});

describe('lowestQuoteIds / allTotalsEntered', () => {
  it('finds the minimum, with ties', () => {
    expect([...lowestQuoteIds([
      { id: 'a', total: '2350' },
      { id: 'b', total: '2295.00' },
      { id: 'c', total: '2295' },
    ])]).toEqual(['b', 'c']);
  });
  it('ignores blanks, zero and garbage', () => {
    expect([...lowestQuoteIds([{ id: 'a', total: '' }, { id: 'b', total: '0' }, { id: 'c', total: '12x' }])]).toEqual([]);
    expect([...lowestQuoteIds([{ id: 'a', total: '' }, { id: 'b', total: '10' }])]).toEqual(['b']);
  });
  it('requires a positive total on every quote', () => {
    expect(allTotalsEntered([{ total: '1' }, { total: '2' }])).toBe(true);
    expect(allTotalsEntered([{ total: '1' }, { total: '' }])).toBe(false);
    expect(allTotalsEntered([])).toBe(false);
  });
});

describe('waiting time', () => {
  it('splits minutes', () => {
    expect(durationParts(250)).toEqual({ hours: 4, minutes: 10 });
    expect(durationParts(null)).toEqual({ hours: 0, minutes: 0 });
  });
  it('orders the longest wait first', () => {
    const rows = [
      { id: 'a', waitingWorkingMinutes: 20, sentAt: '2026-10-07T09:00:00Z' },
      { id: 'b', waitingWorkingMinutes: 250, sentAt: '2026-10-07T05:00:00Z' },
      { id: 'c', waitingWorkingMinutes: 125, sentAt: '2026-10-07T07:00:00Z' },
    ];
    expect(byWaitingDesc(rows).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});

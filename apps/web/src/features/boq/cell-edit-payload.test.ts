import { describe, expect, it } from 'vitest';

import { cellEditPayload } from './cell-edit-payload';

const UNITS = [{ code: 'M2', name: 'Square metre', symbol: 'm²' }];

describe('cellEditPayload', () => {
  it('sends only the edited field', () => {
    expect(cellEditPayload('description', '  Tiling ', UNITS)).toEqual({ description: 'Tiling' });
    expect(cellEditPayload('quantity', '12.5', UNITS)).toEqual({ quantity: '12.5' });
    expect(cellEditPayload('unitRate', '9', UNITS)).toEqual({ unitRate: '9' });
  });

  it('normalises a unit only on the unit cell', () => {
    expect(cellEditPayload('unit', 'm2', UNITS)).toEqual({ unit: 'm²' });
    expect(cellEditPayload('unit', 'bags', UNITS)).toEqual({ unit: 'bags' });
  });

  it('writes a lump-sum amount as quantity 1 × rate', () => {
    expect(cellEditPayload('lumpSumAmount', '650', UNITS)).toEqual({ quantity: '1', unitRate: '650' });
  });
});

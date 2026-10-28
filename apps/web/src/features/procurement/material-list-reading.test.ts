import { describe, expect, it } from 'vitest';

import { itemsFromMaterialList } from './material-list-reading';
import type { Material, UnitOfMeasure } from './types';

const bag: UnitOfMeasure = { id: 'u1', code: 'BAG', name: 'Bag', symbol: 'bag', status: 'ACTIVE' } as UnitOfMeasure;
const m3: UnitOfMeasure = { id: 'u2', code: 'M3', name: 'Cubic metre', symbol: 'm³', status: 'ACTIVE' } as UnitOfMeasure;
const cement = { id: 'mat1', code: 'CEM-50', name: 'Portland cement 50kg', baseUom: bag, defaultSpendCategoryId: null } as unknown as Material;
const read = (description: string, quantity: string | null, unit: string | null) => ({ description, quantity, unit, unitPrice: null, amount: null });

describe('material list reading (Step 7)', () => {
  it('names a catalogue material when the words clearly match, else a one-off with its unit', () => {
    const items = itemsFromMaterialList(
      { lines: [read('Cement portland 50kg', '40', 'bags'), read('Sand', '6', 'm3'), read('Nails 4 inch', '3', 'boxes'), read('', '1', null)] },
      [cement], [bag, m3], (i) => `k${i}`,
    );
    expect(items.map((i) => [i.material?.id ?? null, i.description, i.uomCode, i.quantity])).toEqual([
      ['mat1', 'Portland cement 50kg', 'BAG', '40'],
      [null, 'Sand', 'M3', '6'],
      [null, 'Nails 4 inch', '', '3'],
    ]);
  });
});

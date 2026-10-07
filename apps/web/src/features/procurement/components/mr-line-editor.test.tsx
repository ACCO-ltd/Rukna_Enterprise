import { describe, expect, it } from 'vitest';

import type { Material } from '../types';
import {
  emptyMrItem,
  mrItemAmount,
  mrItemErrors,
  mrItemsTotal,
  oneOffItem,
  pickMaterial,
  toMrLinePayload,
  type MrItemDraft,
} from './mr-line-editor';

const rebar = {
  id: 'm1',
  code: 'RB-12',
  name: 'Rebar 12mm',
  status: 'ACTIVE',
  defaultSpendCategoryId: 'sc-steel',
  baseUom: { id: 'u1', code: 'TON', name: 'Tonne', symbol: 't', status: 'ACTIVE' },
} as Material;

const item = (patch: Partial<MrItemDraft> = {}): MrItemDraft => ({ ...emptyMrItem('k'), ...patch });

describe('pickMaterial', () => {
  it('takes the unit, spend category and type from the catalogue', () => {
    const picked = pickMaterial(item(), rebar);
    expect(picked).toMatchObject({
      material: rebar,
      description: 'Rebar 12mm',
      lineType: 'MATERIAL',
      uomCode: 'TON',
      spendCategoryId: 'sc-steel',
      estimatedUnitPrice: '',
    });
  });

  it("prefills the estimate from the material's own price, else the last price paid", () => {
    expect(pickMaterial(item(), { ...rebar, estimatedUnitPrice: '850.00' }).estimatedUnitPrice).toBe('850.00');
    expect(pickMaterial(item(), { ...rebar, lastPurchasePrice: '820.50' }).estimatedUnitPrice).toBe('820.50');
  });

  it('keeps a typed estimate when the material offers none', () => {
    expect(pickMaterial(item({ estimatedUnitPrice: '99' }), rebar).estimatedUnitPrice).toBe('99');
  });
});

describe('oneOffItem', () => {
  it('names the item by the typed text, as OTHER with no unit yet', () => {
    expect(oneOffItem(pickMaterial(item(), rebar), '  Site signage ')).toMatchObject({
      material: null,
      description: 'Site signage',
      lineType: 'OTHER',
      uomCode: '',
      spendCategoryId: '',
    });
  });

  it('keeps the type and unit already chosen on a one-off when renamed', () => {
    const service = item({ description: 'Crane hire', lineType: 'SERVICE', uomCode: 'DAY' });
    expect(oneOffItem(service, 'Mobile crane hire')).toMatchObject({ lineType: 'SERVICE', uomCode: 'DAY' });
  });
});

describe('mrItemErrors', () => {
  it('asks for an item, a unit and a quantity on an empty row', () => {
    expect(mrItemErrors(item())).toEqual({ item: 'item', unit: 'unit', quantity: 'quantity' });
  });

  it('needs no unit on a catalogue item — the material carries it', () => {
    expect(mrItemErrors({ ...pickMaterial(item(), rebar), quantity: '2' })).toEqual({});
  });

  it('needs a unit on a one-off item', () => {
    expect(mrItemErrors(item({ description: 'Signage', quantity: '1' }))).toEqual({ unit: 'unit' });
  });

  it('refuses a zero or unparseable quantity', () => {
    expect(mrItemErrors({ ...pickMaterial(item(), rebar), quantity: '0' })).toEqual({ quantity: 'quantity' });
    expect(mrItemErrors({ ...pickMaterial(item(), rebar), quantity: 'abc' })).toEqual({ quantity: 'quantity' });
  });
});

describe('estimates', () => {
  it('multiplies quantity by estimated price to the cent', () => {
    expect(mrItemAmount(item({ quantity: '2.5', estimatedUnitPrice: '10.50' }))).toBe('26.25');
    expect(mrItemAmount(item({ quantity: '2', estimatedUnitPrice: '' }))).toBeNull();
  });

  it('totals only the estimated items, and is null — not zero — when none is', () => {
    expect(
      mrItemsTotal([
        item({ quantity: '2', estimatedUnitPrice: '10' }),
        item({ quantity: '3', estimatedUnitPrice: '' }),
        item({ quantity: '1', estimatedUnitPrice: '5.25' }),
      ]),
    ).toBe('25.25');
    expect(mrItemsTotal([item({ quantity: '3' })])).toBeNull();
  });
});

describe('toMrLinePayload', () => {
  it('sends a catalogue item as MATERIAL with its code and base unit', () => {
    expect(toMrLinePayload({ ...pickMaterial(item(), rebar), quantity: '2.5', estimatedUnitPrice: '850' })).toEqual({
      lineType: 'MATERIAL',
      description: 'Rebar 12mm',
      uomCode: 'TON',
      requestedQuantity: 2.5,
      materialCode: 'RB-12',
      estimatedUnitPrice: 850,
      spendCategoryId: 'sc-steel',
    });
  });

  it('sends a one-off item with its own type and unit, and no estimate when blank', () => {
    expect(
      toMrLinePayload(item({ description: 'Crane hire', lineType: 'SERVICE', uomCode: 'DAY', quantity: '3' })),
    ).toEqual({ lineType: 'SERVICE', description: 'Crane hire', uomCode: 'DAY', requestedQuantity: 3 });
  });
});

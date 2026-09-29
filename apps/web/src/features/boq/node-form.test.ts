import { describe, expect, it } from 'vitest';

import {
  EMPTY_NODE_FORM,
  lumpSumOf,
  previewLineTotal,
  toCreateNodePayload,
  toNodeFormValues,
  toUpdateNodePayload,
  type NodeFormValues,
} from './node-form';
import { testNode } from './test-node';

function form(overrides: Partial<NodeFormValues> = {}): NodeFormValues {
  return { ...EMPTY_NODE_FORM, code: '01.01', description: 'Excavation', ...overrides };
}

describe('toCreateNodePayload — sections', () => {
  it('marks a section as not a leaf', () => {
    expect(toCreateNodePayload(form(), { kind: 'section' }).isLeaf).toBe(false);
  });

  /**
   * The server rejects pricing on a section outright (CONST-BOQ-015). Sending it would
   * imply the section had been priced directly, when its total comes from its descendants.
   */
  it('never sends measurement or pricing fields on a section', () => {
    const payload = toCreateNodePayload(form({ quantity: '10', unitRate: '5', unit: 'm3' }), {
      kind: 'section',
    });

    expect(payload).not.toHaveProperty('quantity');
    expect(payload).not.toHaveProperty('unitRate');
    expect(payload).not.toHaveProperty('unit');
    expect(payload).not.toHaveProperty('measurementMethod');
    expect(payload).not.toHaveProperty('pricingBasis');
  });

  it('omits the parent for a root-level section', () => {
    expect(toCreateNodePayload(form(), { kind: 'section' })).not.toHaveProperty('parentId');
    expect(toCreateNodePayload(form(), { kind: 'section', parentId: 'p1' }).parentId).toBe('p1');
  });

  /**
   * Sibling positions are dense, unique and server-owned (CONST-BOQ-017). The client used
   * to allocate them, which is how ties became storable.
   */
  it('never sends a sort order', () => {
    expect(toCreateNodePayload(form(), { kind: 'section' })).not.toHaveProperty('sortOrder');
  });
});

describe('toCreateNodePayload — items', () => {
  it('sends quantity and rate as the strings the user typed', () => {
    const payload = toCreateNodePayload(
      form({ unit: 'm3', quantity: '680.500', unitRate: '12.50' }),
      { kind: 'item' },
    );

    // Not 680.5. Trailing zeros in a BOQ quantity state the measurement precision, and a
    // round trip through Number would silently drop them.
    expect(payload.quantity).toBe('680.500');
    expect(payload.unitRate).toBe('12.50');
    expect(payload.isLeaf).toBe(true);
  });

  it('rejects malformed decimals rather than sending NaN', () => {
    const payload = toCreateNodePayload(form({ quantity: '12abc', unitRate: '1.2.3' }), {
      kind: 'item',
    });

    expect(payload).not.toHaveProperty('quantity');
    expect(payload).not.toHaveProperty('unitRate');
  });

  /**
   * A BOQ holds one currency, fixed at initialization and stamped by the server
   * (CONST-BOQ-013). The client used to write the project's currency onto each node as a
   * guard against the API permitting a mixed-currency BOQ; that is a backend invariant now.
   */
  it('never sends a currency', () => {
    const payload = toCreateNodePayload(
      form({ unit: 'm3', quantity: '10', unitRate: '5.00' }),
      { kind: 'item' },
    );

    expect(payload).not.toHaveProperty('currency');
  });

  it('carries measurement method and pricing basis', () => {
    const payload = toCreateNodePayload(
      form({ measurementMethod: 'MILESTONE', pricingBasis: 'LUMP_SUM' }),
      { kind: 'item' },
    );

    expect(payload.measurementMethod).toBe('MILESTONE');
    expect(payload.pricingBasis).toBe('LUMP_SUM');
  });

  it('trims whitespace off text fields', () => {
    const payload = toCreateNodePayload(
      form({ code: '  01.02  ', description: '  Fill  ', unit: '  m3  ' }),
      { kind: 'item' },
    );

    expect(payload.code).toBe('01.02');
    expect(payload.description).toBe('Fill');
    expect(payload.unit).toBe('m3');
  });
});

describe('toUpdateNodePayload', () => {
  /** An imported lump sum stored as 5 x 100: the amount is 500 whatever the quantity says. */
  const importedLumpSum = () =>
    toNodeFormValues(
      testNode({
        id: 'n1',
        code: '1.1',
        description: 'Site office',
        isLeaf: true,
        pricingBasis: 'LUMP_SUM',
        unit: 'LS',
        quantity: '5.000',
        unitRate: '100.00',
      }),
    );

  it('sends only what changed: a description edit on a 5 x 100 lump sum sends the description alone', () => {
    const initial = importedLumpSum();
    expect(initial.lumpSumAmount).toBe('500.00');
    const payload = toUpdateNodePayload({ ...initial, description: 'Site office and stores' }, { kind: 'item', initial });
    expect(payload).toEqual({ description: 'Site office and stores' });
  });

  it('rewrites a lump sum as 1 x amount only when the amount or the basis changed', () => {
    const initial = importedLumpSum();
    expect(toUpdateNodePayload({ ...initial, lumpSumAmount: '650' }, { kind: 'item', initial })).toEqual({
      quantity: '1',
      unitRate: '650',
    });
    const measured = form({ unit: 'm²', quantity: '42', unitRate: '160' });
    expect(
      toUpdateNodePayload({ ...measured, pricingBasis: 'LUMP_SUM', lumpSumAmount: '6720.00' }, { kind: 'item', initial: measured }),
    ).toEqual({ pricingBasis: 'LUMP_SUM', quantity: '1', unitRate: '6720.00' });
  });

  it('sends a unit only when it changed, and never a stored spelling the user left alone', () => {
    const initial = form({ unit: 'm2', quantity: '10', unitRate: '5' });
    expect(toUpdateNodePayload({ ...initial, description: 'Tiling' }, { kind: 'item', initial })).not.toHaveProperty('unit');
    expect(toUpdateNodePayload({ ...initial, unit: 'm²' }, { kind: 'item', initial })).toEqual({ unit: 'm²' });
  });

  it('without the cost tier, sends a measured quantity but never a rate, basis or lump-sum amount', () => {
    const initial = form({ unit: 'm²', quantity: '10', unitRate: '' });
    expect(
      toUpdateNodePayload({ ...initial, unitRate: '9', pricingBasis: 'LUMP_SUM', lumpSumAmount: '5' }, {
        kind: 'item',
        initial,
        pricing: false,
      }),
    ).toEqual({});
    expect(toUpdateNodePayload({ ...initial, quantity: '12' }, { kind: 'item', initial, pricing: false })).toEqual({
      quantity: '12',
    });
  });

  /**
   * Changing a section into an item is refused by the server once it has children, and the
   * two shapes collect different fields. Changing kind means delete and re-add, which is
   * explicit about what happens to the children.
   */
  it('never sends isLeaf', () => {
    expect(toUpdateNodePayload(form(), { kind: 'item', initial: form({ description: 'Old' }) })).not.toHaveProperty('isLeaf');
  });

  it('never sends a currency', () => {
    const payload = toUpdateNodePayload(form({ quantity: '10', unitRate: '5.00' }), {
      kind: 'item',
      initial: form(),
    });

    expect(payload).not.toHaveProperty('currency');
  });

});

describe('toNodeFormValues', () => {
  it('reads a node back into the form, with nulls as empty strings', () => {
    const values = toNodeFormValues(
      testNode({
        id: 'n1',
        code: '02.01',
        description: 'Rock excavation',
        isLeaf: true,
        unit: 'm3',
        quantity: '680.000',
        unitRate: null,
        measurementMethod: 'PERCENTAGE',
      }),
    );

    expect(values).toMatchObject({
      code: '02.01',
      description: 'Rock excavation',
      unit: 'm3',
      quantity: '680.000',
      unitRate: '',
      measurementMethod: 'PERCENTAGE',
    });
  });
});

describe('previewLineTotal', () => {
  it('multiplies in minor units so the preview matches what the server will store', () => {
    expect(previewLineTotal(form({ quantity: '680.000', unitRate: '12.50' }))).toBe('8500.00');
  });

  /**
   * 0.1 × 3 is 0.30000000000000004 in binary floating point. A BOQ preview that disagrees
   * with the saved amount by a cent is worse than no preview.
   */
  it('does not drift on values a float cannot represent', () => {
    expect(previewLineTotal(form({ quantity: '0.100', unitRate: '3.00' }))).toBe('0.30');
    expect(previewLineTotal(form({ quantity: '3.000', unitRate: '0.10' }))).toBe('0.30');
  });

  it('rounds to two decimal places, as the server does', () => {
    expect(previewLineTotal(form({ quantity: '1.005', unitRate: '1.00' }))).toBe('1.01');
  });

  it('returns null when either side is missing or malformed', () => {
    expect(previewLineTotal(form({ quantity: '10' }))).toBeNull();
    expect(previewLineTotal(form({ unitRate: '10' }))).toBeNull();
    expect(previewLineTotal(form({ quantity: 'abc', unitRate: '10' }))).toBeNull();
  });
});

/**
 * A lump sum is stored the way the rest of the BOQ already stores one — quantity 1 and
 * unitRate = amount — so `totalAmount = quantity × unitRate` holds everywhere.
 */
describe('lump sum', () => {
  it('saves the amount as quantity 1 × rate, on create and update', () => {
    const values = form({ pricingBasis: 'LUMP_SUM', lumpSumAmount: '25000.00', quantity: '42', unitRate: '160' });

    expect(toCreateNodePayload(values, { kind: 'item' })).toMatchObject({
      pricingBasis: 'LUMP_SUM',
      quantity: '1',
      unitRate: '25000.00',
    });
    expect(toUpdateNodePayload(values, { kind: 'item', initial: form() })).toMatchObject({
      pricingBasis: 'LUMP_SUM',
      quantity: '1',
      unitRate: '25000.00',
    });
  });

  it('sends neither quantity nor rate when no amount was typed — never a confident zero', () => {
    const payload = toCreateNodePayload(form({ pricingBasis: 'LUMP_SUM', quantity: '42', unitRate: '160' }), {
      kind: 'item',
    });
    expect(payload).not.toHaveProperty('quantity');
    expect(payload).not.toHaveProperty('unitRate');
  });

  it('reads a stored lump sum back as its amount, whatever quantity it was written with', () => {
    const base = { id: 'n1', isLeaf: true, pricingBasis: 'LUMP_SUM' as const };
    expect(toNodeFormValues(testNode({ ...base, quantity: '1.000', unitRate: '900.00' })).lumpSumAmount).toBe('900.00');
    expect(toNodeFormValues(testNode({ ...base, quantity: null, unitRate: '900.00' })).lumpSumAmount).toBe('900.00');
    expect(toNodeFormValues(testNode({ ...base, quantity: '3.000', unitRate: '100.00' })).lumpSumAmount).toBe('300.00');
    expect(lumpSumOf(null, null)).toBe('');
  });

  it('without the cost tier, a create carries no rate, basis or lump-sum amount', () => {
    const payload = toCreateNodePayload(form({ unit: 'm²', quantity: '3', unitRate: '9' }), { kind: 'item', pricing: false });
    expect(payload).toMatchObject({ quantity: '3', unit: 'm²' });
    expect(payload).not.toHaveProperty('unitRate');
    expect(payload).not.toHaveProperty('pricingBasis');
  });

  it('previews the lump-sum amount itself', () => {
    expect(previewLineTotal(form({ pricingBasis: 'LUMP_SUM', lumpSumAmount: '1234.5' }))).toBe('1234.50');
    expect(previewLineTotal(form({ pricingBasis: 'LUMP_SUM' }))).toBeNull();
  });
});

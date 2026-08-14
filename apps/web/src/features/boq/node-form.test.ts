import { describe, expect, it } from 'vitest';

import {
  EMPTY_NODE_FORM,
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
  /**
   * Changing a section into an item is refused by the server once it has children, and the
   * two shapes collect different fields. Changing kind means delete and re-add, which is
   * explicit about what happens to the children.
   */
  it('never sends isLeaf', () => {
    expect(toUpdateNodePayload(form(), { kind: 'item' })).not.toHaveProperty('isLeaf');
  });

  it('never sends a currency', () => {
    const payload = toUpdateNodePayload(form({ quantity: '10', unitRate: '5.00' }), {
      kind: 'item',
    });

    expect(payload).not.toHaveProperty('currency');
  });

  it('clears an emptied Arabic description rather than omitting it', () => {
    expect(toUpdateNodePayload(form({ descriptionAr: '' }), { kind: 'section' }).descriptionAr)
      .toBeUndefined();
  });
});

describe('toNodeFormValues', () => {
  it('reads a node back into the form, with nulls as empty strings', () => {
    const values = toNodeFormValues(
      testNode({
        id: 'n1',
        code: '02.01',
        description: 'Rock excavation',
        descriptionAr: null,
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
      descriptionAr: '',
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

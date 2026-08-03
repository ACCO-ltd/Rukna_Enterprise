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

const base = { sortOrder: 1, projectCurrency: 'USD' as string | null };

describe('toCreateNodePayload — sections', () => {
  it('marks a section as not a leaf', () => {
    expect(toCreateNodePayload(form(), { ...base, kind: 'section' }).isLeaf).toBe(false);
  });

  /**
   * The server computes a section's total from its descendants. Sending a rate on a
   * section would be ignored while implying the section had been priced directly.
   */
  it('never sends quantities, rates or currency on a section', () => {
    const payload = toCreateNodePayload(
      form({ quantity: '10', unitRate: '5', unit: 'm3' }),
      { ...base, kind: 'section' },
    );

    expect(payload).not.toHaveProperty('quantity');
    expect(payload).not.toHaveProperty('unitRate');
    expect(payload).not.toHaveProperty('unit');
    expect(payload).not.toHaveProperty('currency');
  });
});

describe('toCreateNodePayload — items', () => {
  it('marks an item as a leaf and carries its measurements', () => {
    const payload = toCreateNodePayload(
      form({ unit: 'm3', quantity: '1200', unitRate: '45.00' }),
      { ...base, kind: 'item' },
    );

    expect(payload).toMatchObject({
      isLeaf: true,
      unit: 'm3',
      quantity: 1200,
      unitRate: 45,
      sortOrder: 1,
    });
  });

  /**
   * THE CURRENCY LOCK. Currency is not a form field — it comes from the project, so a BOQ
   * cannot end up denominated in several currencies. See D1 and subtree-currency.ts.
   */
  it("takes currency from the project rather than the form", () => {
    const payload = toCreateNodePayload(form({ quantity: '1', unitRate: '2' }), {
      ...base,
      kind: 'item',
      projectCurrency: 'AED',
    });

    expect(payload.currency).toBe('AED');
  });

  it('omits currency when the project has none, rather than guessing', () => {
    const payload = toCreateNodePayload(form({ quantity: '1', unitRate: '2' }), {
      ...base,
      kind: 'item',
      projectCurrency: null,
    });

    expect(payload).not.toHaveProperty('currency');
  });

  // An unpriced row has nothing to denominate, and a stray currency on it would count
  // toward the mixed-currency check for no reason.
  it('omits currency on an item with no quantity or rate', () => {
    const payload = toCreateNodePayload(form(), { ...base, kind: 'item' });

    expect(payload).not.toHaveProperty('currency');
  });

  it('omits empty optional fields rather than sending empty strings', () => {
    const payload = toCreateNodePayload(form(), { ...base, kind: 'item' });

    expect(payload).not.toHaveProperty('unit');
    expect(payload).not.toHaveProperty('descriptionAr');
    expect(payload).not.toHaveProperty('quantity');
  });

  it('attaches a parent only when there is one', () => {
    expect(toCreateNodePayload(form(), { ...base, kind: 'item' })).not.toHaveProperty('parentId');
    expect(
      toCreateNodePayload(form(), { ...base, kind: 'item', parentId: 'p1' }).parentId,
    ).toBe('p1');
  });

  it('ignores a non-numeric quantity instead of sending NaN', () => {
    const payload = toCreateNodePayload(form({ quantity: 'abc' }), { ...base, kind: 'item' });

    expect(payload).not.toHaveProperty('quantity');
  });

  it('keeps a zero rate, which is a real price', () => {
    const payload = toCreateNodePayload(form({ quantity: '5', unitRate: '0' }), {
      ...base,
      kind: 'item',
    });

    expect(payload.unitRate).toBe(0);
  });
});

describe('toUpdateNodePayload', () => {
  // Switching kind is refused by the server once a node has children, and the two shapes
  // collect different fields — changing kind means delete and re-add.
  it('never sends isLeaf', () => {
    expect(toUpdateNodePayload(form(), { kind: 'item', projectCurrency: 'USD' })).not.toHaveProperty(
      'isLeaf',
    );
  });

  it('keeps the currency locked to the project on update too', () => {
    const payload = toUpdateNodePayload(form({ quantity: '3', unitRate: '4' }), {
      kind: 'item',
      projectCurrency: 'SOS',
    });

    expect(payload.currency).toBe('SOS');
  });

  it('sends no measurements for a section', () => {
    const payload = toUpdateNodePayload(form({ quantity: '3' }), {
      kind: 'section',
      projectCurrency: 'USD',
    });

    expect(payload).not.toHaveProperty('quantity');
    expect(payload).not.toHaveProperty('currency');
  });
});

describe('toNodeFormValues', () => {
  const node = testNode({
    id: 'n1',
    code: '01.01',
    description: 'Excavation',
    descriptionAr: 'حفر',
    unit: 'm3',
    quantity: '1200.000',
    unitRate: '45.00',
    currency: 'USD',
    totalAmount: '54000.00',
    isLeaf: true,
    computedTotal: 54000,
  });

  it('fills the form from an existing node', () => {
    expect(toNodeFormValues(node)).toEqual({
      code: '01.01',
      description: 'Excavation',
      descriptionAr: 'حفر',
      unit: 'm3',
      // Kept as the strings the API sent — they are never parsed for arithmetic.
      quantity: '1200.000',
      unitRate: '45.00',
    });
  });

  it('turns nulls into empty strings for the inputs', () => {
    const bare = { ...node, descriptionAr: null, unit: null, quantity: null, unitRate: null };

    expect(toNodeFormValues(bare)).toMatchObject({
      descriptionAr: '',
      unit: '',
      quantity: '',
      unitRate: '',
    });
  });
});

describe('previewLineTotal', () => {
  it('multiplies quantity by rate for a sanity check before saving', () => {
    expect(previewLineTotal(form({ quantity: '1200', unitRate: '45' }))).toBe(54000);
  });

  it('rounds to two places, matching what the server stores', () => {
    expect(previewLineTotal(form({ quantity: '3', unitRate: '0.335' }))).toBe(1.01);
  });

  it('has nothing to show until both figures are present', () => {
    expect(previewLineTotal(form({ quantity: '10' }))).toBeNull();
    expect(previewLineTotal(form({ unitRate: '10' }))).toBeNull();
    expect(previewLineTotal(form())).toBeNull();
  });
});

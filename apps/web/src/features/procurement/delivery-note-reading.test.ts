import { describe, expect, it } from 'vitest';

import type { GrnLineDraft } from './components/grn-line-editor';
import { applyDeliveryReading, similarity } from './delivery-note-reading';

const line = (key: string, description: string, ordered: string): GrnLineDraft => ({
  key, purchaseOrderLineId: key, description, uomSymbol: 'bag', orderedQuantity: ordered, receivedBefore: '0',
  unitPrice: null, delivered: ordered, problemOpen: false, rejected: '', reason: '',
});
const read = (description: string, quantity: string | null) => ({ description, quantity, unit: 'bag', unitPrice: null, amount: null });

describe('delivery note reading (Step 7)', () => {
  it('scores shared words, ignoring case and punctuation', () => {
    expect(similarity('Portland Cement 50kg', 'CEMENT, portland (50kg)')).toBe(1);
    expect(similarity('Steel bar Y12', 'Cement 50kg')).toBe(0);
  });

  it('matches note lines to order lines, once each; what is not on the note did not arrive', () => {
    const r = applyDeliveryReading(
      [line('a', 'Portland cement 50kg', '30'), line('b', 'Steel bar Y12 12m', '100'), line('c', 'Binding wire', '5')],
      { lines: [read('Cement Portland 50 kg bag', '20'), read('Y12 steel bar', '100'), read('Plywood sheet', '4')] },
    );
    expect(r.lines.map((l) => [l.key, l.delivered])).toEqual([['a', '20'], ['b', '100'], ['c', '']]);
    expect(r.unmatched).toEqual(['Plywood sheet · 4 bag']);
    expect(r.matchedCount).toBe(2);
  });

  it('leaves out lines whose quantity could not be read', () => {
    const r = applyDeliveryReading([line('a', 'Binding wire', '5')], { lines: [read('Binding wire', null)] });
    expect(r.lines[0].delivered).toBe('');
    expect(r.unmatched).toEqual([]);
  });
});

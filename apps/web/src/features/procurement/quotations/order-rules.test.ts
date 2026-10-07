import { describe, expect, it } from 'vitest';

import { checkOrderLines, initialOrderLines, trimQuantity } from './order-rules';
import type { OrderDraftLine } from './types';

const draft: OrderDraftLine[] = [
  { materialRequestLineId: 'l1', description: 'Cement', quantity: '50.0000', maxQuantity: '50.0000', uom: 'bag', amount: '1147.50' },
  { materialRequestLineId: 'l2', description: 'Rebar', quantity: '40.0000', maxQuantity: '40.0000', uom: 'pc', amount: '918.00' },
  { materialRequestLineId: 'l3', description: 'Tie wire', quantity: '10.0000', maxQuantity: '10.0000', uom: 'kg', amount: '229.50' },
];

describe('order rules', () => {
  it('prefills the server split with quantities as people write them', () => {
    expect(initialOrderLines(draft)).toEqual([
      { materialRequestLineId: 'l1', included: true, quantity: '50', amount: '1147.50' },
      { materialRequestLineId: 'l2', included: true, quantity: '40', amount: '918.00' },
      { materialRequestLineId: 'l3', included: true, quantity: '10', amount: '229.50' },
    ]);
    expect(trimQuantity('12.5000')).toBe('12.5');
  });

  it('sums exactly against the award and passes at the cap', () => {
    const check = checkOrderLines(initialOrderLines(draft), draft, '2295.00');
    expect(check.totalMinor).toBe(229500);
    expect(check.overMinor).toBe(0);
    expect(check.ok).toBe(true);
  });

  it('refuses a total over the award, a quantity over what is needed, and no lines', () => {
    const lines = initialOrderLines(draft);
    lines[0]!.amount = '1200.00';
    expect(checkOrderLines(lines, draft, '2295.00')).toMatchObject({ overMinor: 5250, ok: false });

    const more = initialOrderLines(draft);
    more[1]!.quantity = '41';
    expect(checkOrderLines(more, draft, '2295.00').quantityProblems.has('l2')).toBe(true);

    const none = initialOrderLines(draft).map((l) => ({ ...l, included: false }));
    expect(checkOrderLines(none, draft, '2295.00')).toMatchObject({ noLines: true, ok: false });
  });

  it('lets a line be dropped, and needs an amount on every included line (MANUAL)', () => {
    const dropped = initialOrderLines(draft);
    dropped[2]!.included = false;
    expect(checkOrderLines(dropped, draft, '2295.00').ok).toBe(true);

    const manual = initialOrderLines(draft.map((l) => ({ ...l, amount: null })));
    const check = checkOrderLines(manual, draft, '2295.00');
    expect(check.amountProblems.size).toBe(3);
    expect(check.ok).toBe(false);
  });
});

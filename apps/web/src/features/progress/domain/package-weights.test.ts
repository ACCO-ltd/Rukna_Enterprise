import { describe, expect, it } from 'vitest';

import { balanceTo100, percentTextOfUnits, unitsOfPercent, unitsOfWeight, weightOfUnits } from './package-weights';

describe('package weights', () => {
  it('converts between stored weights, typed percents and units without drift', () => {
    expect(unitsOfWeight('0.2721')).toBe(2721);
    expect(percentTextOfUnits(2721)).toBe('27.21');
    expect(percentTextOfUnits(3300)).toBe('33');
    expect(unitsOfPercent('27.21')).toBe(2721);
    expect(unitsOfPercent('101')).toBeNull();
    expect(unitsOfPercent('')).toBeNull();
    expect(weightOfUnits(2721)).toBe(0.2721);
  });

  it('balances the edited rows into what the untouched rows leave', () => {
    const rows = [
      { id: 'a', storedUnits: 2721 },
      { id: 'b', storedUnits: 4046, draft: '10' },
      { id: 'c', storedUnits: 3233, draft: '20' },
    ];
    // 100 − 27.21 = 72.79 split 1:2 by largest remainder.
    expect(balanceTo100(rows, 'edited')).toEqual({ b: '24.26', c: '48.53' });
  });

  it('cannot balance when the untouched rows alone exceed 100%, or nothing is edited', () => {
    expect(balanceTo100([{ id: 'a', storedUnits: 10500 }, { id: 'b', storedUnits: 0, draft: '5' }], 'edited')).toBeNull();
    expect(balanceTo100([{ id: 'a', storedUnits: 5000 }], 'edited')).toBeNull();
  });

  it('splits evenly when every edited value is zero', () => {
    expect(balanceTo100([{ id: 'a', storedUnits: 0, draft: '0' }, { id: 'b', storedUnits: 0, draft: '0' }, { id: 'c', storedUnits: 0, draft: '0' }], 'all')).toEqual({
      a: '33.34',
      b: '33.33',
      c: '33.33',
    });
  });
});

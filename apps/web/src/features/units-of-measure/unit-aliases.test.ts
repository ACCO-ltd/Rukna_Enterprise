import { describe, expect, it } from 'vitest';

import { canonicalUnit, resolveListedUnit, unitKey } from './unit-aliases';

const UNITS = [
  { code: 'M3', name: 'Cubic metre', symbol: 'm³' },
  { code: 'M2', name: 'Square metre', symbol: 'm²' },
  { code: 'M', name: 'Metre', symbol: 'm' },
  { code: 'KG', name: 'Kilogram', symbol: 'kg' },
  { code: 'TON', name: 'Tonne', symbol: 't' },
  { code: 'NR', name: 'Number', symbol: 'nr' },
  { code: 'ITEM', name: 'Item', symbol: 'item' },
  { code: 'LS', name: 'Lump sum', symbol: 'LS' },
  { code: 'SUM', name: 'Sum', symbol: 'sum' },
];

const symbolOf = (value: string) => resolveListedUnit(UNITS, value)?.symbol ?? null;

describe('unit aliases', () => {
  it.each([
    ['m²', ['m2', 'M2', 'm^2', 'sqm', 'sq.m', 'Sq. M', 'square metre']],
    ['m³', ['m3', 'M3', 'm^3', 'cum', 'cu.m', 'Cubic metre']],
    ['m', ['lm', 'rm', 'M', 'metre']],
    ['kg', ['kgs', 'KG']],
    ['t', ['ton', 'tonne', 'tons', 'TON']],
    ['nr', ['no', 'nos', 'No.', 'NOS', 'number']],
    ['LS', ['LS', 'ls', 'Lump sum']],
    ['sum', ['sum', 'SUM']],
  ])('resolves every spelling of %s', (symbol, spellings) => {
    for (const spelling of spellings) expect(symbolOf(spelling)).toBe(symbol);
  });

  it('leaves a truly unknown unit unresolved', () => {
    expect(symbolOf('bags')).toBeNull();
    expect(symbolOf('')).toBeNull();
    // An alias whose unit is not in this registry stays unknown rather than guessing.
    expect(resolveListedUnit(UNITS.filter((u) => u.code !== 'M2'), 'sqm')).toBeNull();
  });

  it('canonicalises for display and save, and keeps unknown values as stored', () => {
    expect(canonicalUnit(UNITS, 'm2')).toBe('m²');
    expect(canonicalUnit(UNITS, 'bags')).toBe('bags');
    expect(canonicalUnit(undefined, 'm2')).toBe('m2');
    expect(canonicalUnit([], 'm2')).toBe('m2');
  });

  it('keys like the seed does for m3/m^3', () => {
    expect(unitKey(' M^3 ')).toBe('m³');
    expect(unitKey('m2')).toBe('m²');
  });

  it('prefers an exact symbol, then symbol, code and name in that order', () => {
    const units = [
      { code: 'T', name: 'Truckload', symbol: 'trk' },
      { code: 'TON', name: 'Tonne', symbol: 't' },
    ];
    // "t" is the unit whose symbol is t, not the one coded T that happens to come first.
    expect(resolveListedUnit(units, 't')?.code).toBe('TON');
    expect(resolveListedUnit(units, 'T')?.code).toBe('TON');
    // The name is the last resort before aliases.
    expect(resolveListedUnit([{ code: 'A', name: 'box', symbol: 'bx' }, { code: 'BOX', name: 'Crate', symbol: 'box' }], 'Box')?.code).toBe('BOX');
  });
});

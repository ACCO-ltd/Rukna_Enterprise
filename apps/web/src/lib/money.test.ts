import { describe, expect, it } from 'vitest';

import {
  MONEY_SCALE,
  QUANTITY_SCALE,
  fromMinorUnits,
  parseMinorUnits,
  sumMinorUnits,
  toMinorUnits,
} from './money';

describe('parseMinorUnits', () => {
  it('scales a decimal string to integer minor units', () => {
    expect(parseMinorUnits('1234.50', MONEY_SCALE)).toBe(123450);
  });

  it('reads a whole number with no decimal point', () => {
    expect(parseMinorUnits('1234', MONEY_SCALE)).toBe(123400);
  });

  it('pads a short fraction', () => {
    expect(parseMinorUnits('1234.5', MONEY_SCALE)).toBe(123450);
  });

  it('carries the sign', () => {
    expect(parseMinorUnits('-1234.50', MONEY_SCALE)).toBe(-123450);
  });

  /**
   * The reason `scale` is a required argument. At a hardcoded 2 this returned 100 and threw
   * away the third decimal without a word — which is a quantity of 1.005 becoming 1.00 on a
   * goods receipt.
   */
  it('keeps the third decimal of a quantity', () => {
    expect(parseMinorUnits('1.005', QUANTITY_SCALE)).toBe(1005);
    expect(parseMinorUnits('1.005', MONEY_SCALE)).toBe(100);
  });

  it('truncates beyond the scale rather than rounding, as the column does', () => {
    expect(parseMinorUnits('1.999', MONEY_SCALE)).toBe(199);
  });

  describe('returns null rather than zero', () => {
    // Zero is a valid amount. A parse failure that returns it is indistinguishable from a
    // genuine nil, and in a journal editor that is a typo passing the balance check.
    it.each([
      [null],
      [undefined],
      [''],
      ['   '],
      ['abc'],
      ['12abc'],
      ['1.2.3'],
      ['1,234.50'],
      ['$1234.50'],
      ['NaN'],
      ['Infinity'],
      ['1e5'],
    ])('rejects %s', (input) => {
      expect(parseMinorUnits(input, MONEY_SCALE)).toBeNull();
    });

    it('rejects a value too large to hold exactly', () => {
      expect(parseMinorUnits('99999999999999999999.00', MONEY_SCALE)).toBeNull();
    });
  });

  it('accepts a leading decimal point', () => {
    expect(parseMinorUnits('.50', MONEY_SCALE)).toBe(50);
  });

  it('accepts a trailing decimal point', () => {
    expect(parseMinorUnits('1234.', MONEY_SCALE)).toBe(123400);
  });
});

describe('toMinorUnits', () => {
  it('coalesces an unparseable value to zero', () => {
    expect(toMinorUnits('abc', MONEY_SCALE)).toBe(0);
    expect(toMinorUnits(null, MONEY_SCALE)).toBe(0);
  });

  it('otherwise agrees with parseMinorUnits', () => {
    expect(toMinorUnits('1234.50', MONEY_SCALE)).toBe(123450);
  });
});

describe('fromMinorUnits', () => {
  it('renders minor units back to a decimal string', () => {
    expect(fromMinorUnits(123450, MONEY_SCALE)).toBe('1234.50');
  });

  it('pads the fraction', () => {
    expect(fromMinorUnits(5, MONEY_SCALE)).toBe('0.05');
  });

  it('carries the sign', () => {
    expect(fromMinorUnits(-123450, MONEY_SCALE)).toBe('-1234.50');
  });

  it('renders a quantity at three places', () => {
    expect(fromMinorUnits(1005, QUANTITY_SCALE)).toBe('1.005');
  });

  it('round-trips', () => {
    for (const value of ['0.00', '0.01', '1234.50', '-99.99', '98765432.10']) {
      expect(fromMinorUnits(parseMinorUnits(value, MONEY_SCALE)!, MONEY_SCALE)).toBe(value);
    }
  });
});

describe('sumMinorUnits', () => {
  it('adds decimal strings exactly where floats would drift', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. In minor units it is 10 + 20 === 30.
    expect(sumMinorUnits(['0.10', '0.20'], MONEY_SCALE)).toBe(30);
  });

  it('sums a ledger without drift', () => {
    const lines = Array.from({ length: 1000 }, () => '0.01');
    expect(sumMinorUnits(lines, MONEY_SCALE)).toBe(1000);
    expect(fromMinorUnits(sumMinorUnits(lines, MONEY_SCALE), MONEY_SCALE)).toBe('10.00');
  });

  it('treats an unparseable entry as nothing', () => {
    expect(sumMinorUnits(['1.00', null, 'abc'], MONEY_SCALE)).toBe(100);
  });

  it('is zero for an empty list', () => {
    expect(sumMinorUnits([], MONEY_SCALE)).toBe(0);
  });
});

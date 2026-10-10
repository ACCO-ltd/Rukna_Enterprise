import { describe, expect, it } from 'vitest';

import { absMoney, barPercent, isPositive, isZero, minor, share } from './figures';

describe('finance display figures (on money.ts minor units)', () => {
  it('reads decimal money exactly, absent as 0', () => {
    expect(minor('200000.10')).toBe(20000010);
    expect(minor(null)).toBe(0);
    expect(isPositive('0.01')).toBe(true);
    expect(isPositive('0.00')).toBe(false);
    expect(isZero('0.00')).toBe(true);
    expect(isZero(null)).toBe(false);
  });

  it('unsigns an amount without float drift', () => {
    expect(absMoney('-200000.00')).toBe('200000.00');
    expect(absMoney('-0.10')).toBe('0.10');
  });

  it('gives a whole-number share, or null with no denominator — never a 0% that claims a fact', () => {
    expect(share('200000.00', '500000.00')).toBe(40);
    expect(share('0.10', '0.30')).toBe(33);
    expect(share('1.00', '0.00')).toBeNull();
    expect(share('1.00', null)).toBeNull();
    expect(share(null, '1.00')).toBeNull();
  });

  it('clamps a bar to 0–100', () => {
    expect(barPercent('25.00', '100.00')).toBe(25);
    expect(barPercent('150.00', '100.00')).toBe(100);
    expect(barPercent('1.00', '0.00')).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { apportionUnits, apportionWeights } from '@erp/types';

/**
 * The web side of the shared largest-remainder rounding: the whole percents the Delivery Plan shows
 * and the four-place fractions the wizard stores both sum exactly.
 */
describe('apportion (shared with the API)', () => {
  it.each([3, 6, 7])('turns %i even shares into whole percents summing to exactly 100', (n) => {
    const units = apportionUnits(Array.from({ length: n }, () => 1 / n), 2);
    expect(units.reduce((a, b) => a + b, 0)).toBe(100);
    expect(Math.max(...units) - Math.min(...units)).toBeLessThanOrEqual(1);
  });

  it.each([3, 6, 7])('stores %i even shares at four places summing to exactly 1.0000', (n) => {
    const weights = apportionWeights(Array.from({ length: n }, () => 1 / n), 4);
    expect(weights.reduce((sum, w) => sum + Math.round(w * 10_000), 0)).toBe(10_000);
  });

  it('rounds value shares the same way', () => {
    expect(apportionUnits([0.26667, 0.73333], 2)).toEqual([27, 73]);
    expect(apportionUnits([0.6667, 0.3333], 2)).toEqual([67, 33]);
  });
});

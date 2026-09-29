import { apportionUnits, apportionWeights, PROGRESS_WEIGHT_DECIMALS } from '@erp/types';

/**
 * Largest-remainder rounding (shared with the web): weights rounded to the stored precision sum to
 * EXACTLY 1, so the roll-up's `weightsComplete` holds for an accepted suggestion.
 */
const sumUnits = (shares: number[], decimals = PROGRESS_WEIGHT_DECIMALS) =>
  apportionUnits(shares, decimals).reduce((a, b) => a + b, 0);

describe('apportionWeights', () => {
  it.each([3, 6, 7])('splits %i even shares so they sum to exactly 1.0000', (n) => {
    const shares = Array.from({ length: n }, () => 1);
    expect(sumUnits(shares)).toBe(10_000);
    const weights = apportionWeights(shares, 4);
    expect(weights.every((w) => /^\d(\.\d{1,4})?$/.test(String(w)))).toBe(true);
    expect(Math.max(...weights) - Math.min(...weights)).toBeCloseTo(0.0001, 6);
  });

  it('gives the leftover unit to the largest remainder, ties to the earlier entry', () => {
    expect(apportionWeights([1, 1, 1], 4)).toEqual([0.3334, 0.3333, 0.3333]);
    expect(apportionUnits([1, 1, 1], 2)).toEqual([34, 33, 33]);
  });

  it('rounds value shares to exactly 1 as well', () => {
    const values = [123_456.78, 98_765.43, 55_555.55, 1_000];
    expect(sumUnits(values)).toBe(10_000);
    expect(sumUnits(values, 2)).toBe(100);
    expect(apportionWeights([2, 1], 4)).toEqual([0.6667, 0.3333]);
  });

  it('keeps zero shares at zero and answers all-zero with all zeros', () => {
    expect(apportionWeights([0, 1, 1, 0], 4)).toEqual([0, 0.5, 0.5, 0]);
    expect(apportionWeights([0, 0], 4)).toEqual([0, 0]);
    expect(apportionWeights([], 4)).toEqual([]);
  });
});

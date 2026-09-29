/**
 * Largest-remainder apportionment of progress weights — shared by the API (the weights it suggests)
 * and the web (the weights it shows and stores), so a set of weights rounded to the precision that is
 * actually stored always sums to EXACTLY 1.
 *
 * Rounding each share on its own does not: three even thirds at four places are 0.3333 × 3 = 0.9999,
 * and the roll-up's `weightsComplete` then reads the plan as incomplete. Here every share is floored
 * to whole units of the stored precision, and the units left over go one each to the shares with the
 * largest remainders (ties to the earlier entry), so the units sum to exactly 10^decimals.
 *
 * A share of 0 stays 0. When every share is 0 (nothing to weigh) every result is 0.
 */
export function apportionUnits(shares: readonly number[], decimals: number): number[] {
  const scale = 10 ** decimals;
  const positive = shares.map((share) => (Number.isFinite(share) && share > 0 ? share : 0));
  const total = positive.reduce((sum, share) => sum + share, 0);
  if (total <= 0) return positive.map(() => 0);

  const exact = positive.map((share) => (share / total) * scale);
  const units = exact.map((value) => Math.floor(value));
  let leftover = scale - units.reduce((sum, unit) => sum + unit, 0);

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .filter((entry) => entry.remainder > 0)
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const entry of order) {
    if (leftover <= 0) break;
    units[entry.index]! += 1;
    leftover -= 1;
  }
  return units;
}

/** As `apportionUnits`, as fractions: `decimals: 4` → 0.3334, 0.3333, 0.3333 (sum exactly 1.0000). */
export function apportionWeights(shares: readonly number[], decimals: number): number[] {
  const scale = 10 ** decimals;
  return apportionUnits(shares, decimals).map((unit) => Number((unit / scale).toFixed(decimals)));
}

/** The precision a work-package `progressWeight` is stored at (the DTO's `maxDecimalPlaces: 4`). */
export const PROGRESS_WEIGHT_DECIMALS = 4;

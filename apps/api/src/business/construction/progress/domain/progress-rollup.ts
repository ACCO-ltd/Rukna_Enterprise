/**
 * How a work package's own percentage is derived from the BOQ leaves allocated to it.
 *
 * ─── Why this is not a plain average ─────────────────────────────────────────────
 *
 * It used to be. Every leaf in a package counted equally, so a package holding
 *
 *   Setting-out and site clearing     1 lot      done      100%
 *   Reinforced concrete          10,000 m³    500 m³        5%
 *
 * read **52.5% complete** with 9,500 m³ still in the ground. Weighted by what the work is worth,
 * the same package reads ~5% — which is what the money says has been built, and what a quantity
 * surveyor means by progress. The distortion was worst exactly where it mattered most: the big,
 * slow structural packages that dominate a programme.
 *
 * `BoqNode.totalAmount` is the server-computed value of the line (quantity × rate), so nothing new
 * has to be derived and the weighting always agrees with the BOQ's own arithmetic.
 *
 * ─── The unpriced case ───────────────────────────────────────────────────────────
 *
 * A leaf with no rate is worth nothing, and a package where *nothing* is priced has no values to
 * weight by. Rather than report 0% for work that has genuinely happened, such a package falls back
 * to the plain average. This is the only place the old behaviour survives, and it survives on a
 * working BOQ that has not been priced yet — never on one that has.
 *
 * Pure and synchronous: the caller supplies the leaves, their percentages and their values.
 */

import { Decimal } from '@prisma/client/runtime/library';

const ZERO = new Decimal(0);

export function weightedPackagePercent(
  leafIds: readonly string[],
  percentByLeaf: ReadonlyMap<string, number>,
  valueByLeaf: ReadonlyMap<string, Decimal>,
): number {
  if (leafIds.length === 0) return 0;

  let totalValue = ZERO;
  let weighted = ZERO;
  for (const id of leafIds) {
    const value = valueByLeaf.get(id) ?? ZERO;
    totalValue = totalValue.plus(value);
    weighted = weighted.plus(value.mul(percentByLeaf.get(id) ?? 0));
  }

  if (totalValue.greaterThan(ZERO)) return weighted.div(totalValue).toNumber();

  // Nothing in this package carries a value yet — see "the unpriced case" above.
  return leafIds.reduce((sum, id) => sum + (percentByLeaf.get(id) ?? 0), 0) / leafIds.length;
}

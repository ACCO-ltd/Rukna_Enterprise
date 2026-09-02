import type { BoqTreeNodeResponse } from '@erp/types';

import { fromMinorUnits, MONEY_SCALE, toMinorUnits } from '@/lib/money';

import { isPriced } from './boq-rows';

/**
 * The BOQ's headline arithmetic — the project budget line, and the rolled-up subtotal on
 * every section.
 *
 * Pure and JSX-free so the one place money is summed on this screen can be tested without
 * mounting a 400-row grid. Everything works in integer minor units through `lib/money.ts`;
 * no float ever touches a decimal string (see the note at the top of that file).
 *
 * ─── Where the numbers come from ────────────────────────────────────────────────
 *
 * The server already sends `computedTotal` on every node — a leaf's own amount, a section's
 * descendant sum (CONST-BOQ, `BoqTreeNodeResponse.computedTotal`). We sum only the **leaves**
 * here rather than trusting each section's `computedTotal`, so the rollup cannot double-count
 * a section total against its children's, and so the headline total is provably the same set
 * of rows as the per-section subtotals. Summing the leaves' `computedTotal` reproduces the
 * server's version total exactly — both are ∑(leaf computedTotal) in Decimal — which is why
 * the metric strip and the version panel show the identical figure.
 */

export interface BoqTotals {
  /** ∑ of every priced leaf's amount, as a decimal string. Null when nothing is priced. */
  totalAmount: string | null;
  itemCount: number;
  pricedCount: number;
  /**
   * Items with no line amount yet. Reported as a **count**, never a currency figure: an
   * unpriced item has no rate, so its "value" is genuinely unknown, and inventing a dollar
   * amount for it would violate the honesty rule in the UX doctrine (§4). The metric line
   * labels this "N unpriced", not a money value.
   */
  unpricedCount: number;
  /** 0–100, rounded. Share of billable items that carry a line amount. */
  pricedPercent: number;
}

/**
 * The rollup: a section id → its descendant-leaf subtotal (decimal string), plus the tree
 * totals. Computed in one depth-first pass so a deep tree is walked once, and memoized by the
 * caller on the tree reference.
 *
 * A section with no priced descendant maps to `null`, not `"0.00"` — an unpriced section has
 * no amount yet, the same distinction `formatMoney` preserves by returning null for absence.
 */
export interface BoqRollup {
  /** Section node id → subtotal decimal string (or null when it has no priced leaf). */
  sectionTotals: ReadonlyMap<string, string | null>;
  totals: BoqTotals;
}

export function computeRollup(nodes: BoqTreeNodeResponse[]): BoqRollup {
  const sectionMinor = new Map<string, number>();
  const sectionHasPriced = new Map<string, boolean>();

  let itemCount = 0;
  let pricedCount = 0;
  let totalMinor = 0;

  // Walk once, returning each subtree's minor-unit subtotal so a parent accumulates its
  // children without a second pass.
  const walk = (node: BoqTreeNodeResponse): number => {
    if (node.isLeaf) {
      itemCount += 1;
      if (isPriced(node)) {
        pricedCount += 1;
        const minor = toMinorUnits(node.computedTotal, MONEY_SCALE);
        totalMinor += minor;
        return minor;
      }
      return 0;
    }

    let subtotal = 0;
    let anyPriced = false;
    for (const child of node.children) {
      subtotal += walk(child);
      if (child.isLeaf ? isPriced(child) : sectionHasPriced.get(child.id)) anyPriced = true;
    }
    sectionMinor.set(node.id, subtotal);
    sectionHasPriced.set(node.id, anyPriced);
    return subtotal;
  };

  for (const node of nodes) walk(node);

  const sectionTotals = new Map<string, string | null>();
  for (const [id, minor] of sectionMinor) {
    sectionTotals.set(id, sectionHasPriced.get(id) ? fromMinorUnits(minor, MONEY_SCALE) : null);
  }

  return {
    sectionTotals,
    totals: {
      totalAmount: pricedCount > 0 ? fromMinorUnits(totalMinor, MONEY_SCALE) : null,
      itemCount,
      pricedCount,
      unpricedCount: itemCount - pricedCount,
      pricedPercent: itemCount === 0 ? 0 : Math.round((pricedCount / itemCount) * 100),
    },
  };
}

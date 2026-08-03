import type { BoqTreeNode } from './types';

/**
 * The currency a subtree's total is denominated in.
 *
 * WHY THIS EXISTS
 *
 * `currency` is an optional field on each individual BOQ node, and nothing on the server
 * constrains siblings to agree. `BoqTreeService.sumTotals` adds every descendant's
 * `computedTotal` together without looking at currency at all — so a BOQ holding a USD
 * leaf and an AED leaf yields a parent total that is arithmetically the sum of two
 * different currencies.
 *
 * That number is meaningless, and rendering it with a single currency symbol would be
 * confidently wrong in a document used for contract valuation. Whether a BOQ may ever hold
 * more than one currency is a domain question for Eng Ahmed, raised as D1.
 *
 * Until it is answered the rule is: a subtree total is shown only when every priced
 * descendant agrees on a currency. Where they disagree the UI says so instead of printing
 * a number. A missing total is a visible gap; a wrong total gets paid.
 */
export type SubtreeCurrency =
  /** No priced descendant carries a currency — show the amount unlabelled. */
  | { kind: 'none' }
  /** Every priced descendant agrees. */
  | { kind: 'single'; currency: string }
  /** Descendants disagree — the total is not meaningful. */
  | { kind: 'mixed'; currencies: string[] };

/**
 * Resolves the currency for a node's total.
 *
 * A leaf answers for itself. A summary answers for everything beneath it, because that is
 * exactly the set of amounts the server summed into `computedTotal`.
 */
export function resolveSubtreeCurrency(node: BoqTreeNode): SubtreeCurrency {
  const currencies = collectCurrencies(node);

  if (currencies.size === 0) return { kind: 'none' };
  if (currencies.size === 1) return { kind: 'single', currency: [...currencies][0]! };

  return { kind: 'mixed', currencies: [...currencies].sort() };
}

/** True when the subtree's computed total is safe to display as a monetary amount. */
export function hasDisplayableTotal(node: BoqTreeNode): boolean {
  return node.computedTotal !== null && resolveSubtreeCurrency(node).kind !== 'mixed';
}

/**
 * Currencies of every node in the subtree that actually carries an amount.
 *
 * Nodes with no `totalAmount` are skipped: an unpriced node contributes nothing to the sum,
 * so its currency — or lack of one — cannot make the total ambiguous.
 */
function collectCurrencies(node: BoqTreeNode, into = new Set<string>()): Set<string> {
  if (node.totalAmount !== null && node.currency) {
    into.add(node.currency);
  }

  for (const child of node.children) {
    collectCurrencies(child, into);
  }

  return into;
}

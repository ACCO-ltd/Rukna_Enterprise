import { describe, expect, it } from 'vitest';

import { hasDisplayableTotal, resolveSubtreeCurrency } from './subtree-currency';
import { testNode as node } from './test-node';
import type { BoqTreeNode } from './types';

function leaf(id: string, currency: string | null, total: string | null): BoqTreeNode {
  return node({
    id,
    isLeaf: true,
    currency,
    totalAmount: total,
    computedTotal: total === null ? null : Number(total),
  });
}

describe('resolveSubtreeCurrency', () => {
  it('reports none when nothing is priced', () => {
    expect(resolveSubtreeCurrency(node({ id: 'a' }))).toEqual({ kind: 'none' });
  });

  it('reports a leaf’s own currency', () => {
    expect(resolveSubtreeCurrency(leaf('a', 'USD', '100.00'))).toEqual({
      kind: 'single',
      currency: 'USD',
    });
  });

  it('reports a single currency when every descendant agrees', () => {
    const parent = node({
      id: 'p',
      computedTotal: 300,
      children: [leaf('a', 'USD', '100.00'), leaf('b', 'USD', '200.00')],
    });

    expect(resolveSubtreeCurrency(parent)).toEqual({ kind: 'single', currency: 'USD' });
  });

  /**
   * The case this module exists for. BoqTreeService.sumTotals adds computedTotal across
   * children without inspecting currency, so this parent's total is USD 100 + AED 200 =
   * "300" — a number that means nothing.
   */
  it('reports mixed when descendants disagree', () => {
    const parent = node({
      id: 'p',
      computedTotal: 300,
      children: [leaf('a', 'USD', '100.00'), leaf('b', 'AED', '200.00')],
    });

    expect(resolveSubtreeCurrency(parent)).toEqual({ kind: 'mixed', currencies: ['AED', 'USD'] });
  });

  it('detects a disagreement nested several levels down', () => {
    const parent = node({
      id: 'p',
      children: [
        node({ id: 'a', children: [leaf('a1', 'USD', '100.00')] }),
        node({ id: 'b', children: [node({ id: 'b1', children: [leaf('b2', 'SOS', '5.00')] })] }),
      ],
    });

    expect(resolveSubtreeCurrency(parent).kind).toBe('mixed');
  });

  /**
   * An unpriced node contributes nothing to the sum, so its currency cannot make the
   * total ambiguous. Treating it as a disagreement would hide correct totals.
   */
  it('ignores nodes that carry no amount', () => {
    const parent = node({
      id: 'p',
      children: [leaf('a', 'USD', '100.00'), leaf('b', 'AED', null)],
    });

    expect(resolveSubtreeCurrency(parent)).toEqual({ kind: 'single', currency: 'USD' });
  });

  it('ignores a priced node that carries no currency', () => {
    const parent = node({
      id: 'p',
      children: [leaf('a', 'USD', '100.00'), leaf('b', null, '50.00')],
    });

    expect(resolveSubtreeCurrency(parent)).toEqual({ kind: 'single', currency: 'USD' });
  });

  it('lists the conflicting currencies in a stable order', () => {
    const parent = node({
      id: 'p',
      children: [leaf('a', 'USD', '1.00'), leaf('b', 'AED', '1.00'), leaf('c', 'SOS', '1.00')],
    });

    expect(resolveSubtreeCurrency(parent)).toEqual({
      kind: 'mixed',
      currencies: ['AED', 'SOS', 'USD'],
    });
  });
});

describe('hasDisplayableTotal', () => {
  it('is true for a consistent, priced subtree', () => {
    expect(hasDisplayableTotal(leaf('a', 'USD', '100.00'))).toBe(true);
  });

  it('is false when there is no total at all', () => {
    expect(hasDisplayableTotal(node({ id: 'a' }))).toBe(false);
  });

  // Better a visible gap than a number that gets paid.
  it('is false when the subtree mixes currencies, even though the server sent a total', () => {
    const parent = node({
      id: 'p',
      computedTotal: 300,
      children: [leaf('a', 'USD', '100.00'), leaf('b', 'AED', '200.00')],
    });

    expect(parent.computedTotal).not.toBeNull();
    expect(hasDisplayableTotal(parent)).toBe(false);
  });
});

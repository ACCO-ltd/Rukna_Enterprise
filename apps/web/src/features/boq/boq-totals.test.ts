import { describe, expect, it } from 'vitest';

import { computeRollup } from './boq-totals';
import { testNode } from './test-node';

/**
 *  01  Preliminaries                                     → 45,000.00
 *    01.001  Site office setup   (priced 45,000.00)
 *    01.002  Temporary fencing   (unpriced — no rate)
 *  02  Substructure                                      → 51,000.00
 *    02.01  Excavation                                   → 51,000.00
 *      02.01.001  Bulk excavation (priced 51,000.00)
 *
 * Section `computedTotal`s are deliberately set to a WRONG value in this fixture, to prove the
 * rollup sums the leaves rather than trusting the section node's own figure.
 */
function tree() {
  return [
    testNode({
      id: 's1',
      code: '01',
      description: 'Preliminaries',
      computedTotal: '999999.99', // wrong on purpose — must be ignored
      children: [
        testNode({
          id: 'i1',
          code: '01.001',
          isLeaf: true,
          unit: 'LS',
          quantity: '1.000',
          unitRate: '45000.00',
          computedTotal: '45000.00',
        }),
        testNode({
          id: 'i2',
          code: '01.002',
          isLeaf: true,
          unit: 'm',
          quantity: '620.000',
          unitRate: null,
          computedTotal: null,
        }),
      ],
    }),
    testNode({
      id: 's2',
      code: '02',
      description: 'Substructure',
      computedTotal: '0.00', // wrong on purpose — must be ignored
      children: [
        testNode({
          id: 's3',
          code: '02.01',
          description: 'Excavation',
          children: [
            testNode({
              id: 'i3',
              code: '02.01.001',
              isLeaf: true,
              unit: 'm3',
              quantity: '4250.000',
              unitRate: '12.00',
              computedTotal: '51000.00',
            }),
          ],
        }),
      ],
    }),
  ];
}

describe('computeRollup — headline totals', () => {
  it('sums only the priced leaves, matching the server version total', () => {
    const { totals } = computeRollup(tree());

    // 45,000.00 + 51,000.00 — the unpriced fencing contributes nothing.
    expect(totals.totalAmount).toBe('96000.00');
    expect(totals.itemCount).toBe(3);
    expect(totals.pricedCount).toBe(2);
    expect(totals.unpricedCount).toBe(1);
  });

  it('reports the priced percentage of billable items', () => {
    // 2 of 3 priced → 67%.
    expect(computeRollup(tree()).totals.pricedPercent).toBe(67);
  });

  it('reports a null total and 0% for a tree with no priced items', () => {
    const { totals } = computeRollup([
      testNode({ id: 's', children: [testNode({ id: 'i', isLeaf: true, unit: 'm' })] }),
    ]);

    expect(totals.totalAmount).toBeNull();
    expect(totals.pricedPercent).toBe(0);
    expect(totals.pricedCount).toBe(0);
    expect(totals.unpricedCount).toBe(1);
  });

  it('is exact to the cent on decimal amounts (no float drift)', () => {
    const { totals } = computeRollup([
      testNode({
        id: 's',
        children: [
          testNode({ id: 'a', isLeaf: true, unit: 'm', quantity: '1', unitRate: '0.10', computedTotal: '0.10' }),
          testNode({ id: 'b', isLeaf: true, unit: 'm', quantity: '1', unitRate: '0.20', computedTotal: '0.20' }),
        ],
      }),
    ]);

    // 0.10 + 0.20 must be exactly 0.30 — a float sum is 0.30000000000000004.
    expect(totals.totalAmount).toBe('0.30');
  });
});

describe('computeRollup — section subtotals', () => {
  it('rolls each section up from its descendant leaves, ignoring the section node computedTotal', () => {
    const { sectionTotals } = computeRollup(tree());

    expect(sectionTotals.get('s1')).toBe('45000.00');
    expect(sectionTotals.get('s2')).toBe('51000.00');
    // A nested section rolls up its own subtree.
    expect(sectionTotals.get('s3')).toBe('51000.00');
  });

  it('does not double-count a nested section against its parent', () => {
    const { totals } = computeRollup(tree());
    // s2 (51,000) contains s3 (51,000) contains i3 (51,000). The total is 96,000, not 147,000.
    expect(totals.totalAmount).toBe('96000.00');
  });

  it('maps a section with no priced descendant to null, not zero', () => {
    const { sectionTotals } = computeRollup([
      testNode({
        id: 'empty',
        children: [testNode({ id: 'i', isLeaf: true, unit: 'm', quantity: '1', unitRate: null })],
      }),
    ]);

    expect(sectionTotals.get('empty')).toBeNull();
  });
});

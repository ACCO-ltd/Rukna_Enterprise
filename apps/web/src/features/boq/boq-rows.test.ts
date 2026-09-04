import { describe, expect, it } from 'vitest';

import { buildRows, collectSectionIds, countTree, isIncomplete, type RowOptions } from './boq-rows';
import { testNode } from './test-node';

/**
 *  01  Preliminaries
 *    01.001  Site office setup   (priced)
 *    01.002  Temporary fencing   (missing a rate)
 *  02  Substructure
 *    02.01  Excavation
 *      02.01.001  Bulk excavation (priced)
 */
function tree() {
  return [
    testNode({
      id: 's1',
      code: '01',
      description: 'Preliminaries',
      children: [
        testNode({
          id: 'i1',
          code: '01.001',
          description: 'Site office setup',
          isLeaf: true,
          unit: 'LS',
          quantity: '1.000',
          unitRate: '45000.00',
          totalAmount: '45000.00',
          computedTotal: '45000.00',
        }),
        testNode({
          id: 'i2',
          code: '01.002',
          description: 'Temporary fencing',
          isLeaf: true,
          unit: 'm',
          quantity: '620.000',
          unitRate: null,
        }),
      ],
    }),
    testNode({
      id: 's2',
      code: '02',
      description: 'Substructure',
      children: [
        testNode({
          id: 's3',
          code: '02.01',
          description: 'Excavation',
          children: [
            testNode({
              id: 'i3',
              code: '02.01.001',
              description: 'Bulk excavation',
              isLeaf: true,
              unit: 'm3',
              quantity: '4250.000',
              unitRate: '12.00',
              totalAmount: '51000.00',
              computedTotal: '51000.00',
            }),
          ],
        }),
      ],
    }),
  ];
}

const defaults: RowOptions = { collapsed: new Set(), search: '', pricing: 'all' };

describe('buildRows', () => {
  it('flattens the tree depth-first with the depth each row renders at', () => {
    const rows = buildRows(tree(), defaults);

    expect(rows.map((row) => row.node.code)).toEqual([
      '01',
      '01.001',
      '01.002',
      '02',
      '02.01',
      '02.01.001',
    ]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 1, 0, 1, 2]);
  });

  it('hides the children of a collapsed section', () => {
    const rows = buildRows(tree(), { ...defaults, collapsed: new Set(['s1']) });

    expect(rows.map((row) => row.node.code)).toEqual(['01', '02', '02.01', '02.01.001']);
    expect(rows[0]!.expanded).toBe(false);
  });

  /**
   * A search that returned the item without the section above it would strip away the only
   * thing that makes the code mean anything — `02.01.001` on its own is not "Substructure ›
   * Excavation › Bulk excavation".
   */
  it('keeps the ancestors of a match so the result stays in context', () => {
    const rows = buildRows(tree(), { ...defaults, search: 'bulk' });

    expect(rows.map((row) => row.node.code)).toEqual(['02', '02.01', '02.01.001']);
  });

  it('matches on code as well as description, case-insensitively', () => {
    expect(buildRows(tree(), { ...defaults, search: '01.002' }).map((r) => r.node.code)).toEqual([
      '01',
      '01.002',
    ]);
    expect(buildRows(tree(), { ...defaults, search: 'FENCING' }).map((r) => r.node.code)).toEqual([
      '01',
      '01.002',
    ]);
  });

  /**
   * Codes nest, so a substring search is deliberately generous: "01.00" is inside
   * "02.01.001" too. Narrowing to a prefix match would hide the deeper line a surveyor is
   * usually looking for.
   */
  it('matches a code fragment anywhere it appears', () => {
    expect(buildRows(tree(), { ...defaults, search: '01.00' }).map((r) => r.node.code)).toEqual([
      '01',
      '01.001',
      '01.002',
      '02',
      '02.01',
      '02.01.001',
    ]);
  });

  /**
   * Otherwise a match can land inside a section the user closed earlier and the search
   * appears to return nothing.
   */
  it('ignores collapse state while a filter is active', () => {
    const rows = buildRows(tree(), {
      ...defaults,
      collapsed: new Set(['s1', 's2', 's3']),
      search: 'bulk',
    });

    expect(rows.map((row) => row.node.code)).toEqual(['02', '02.01', '02.01.001']);
  });

  it('narrows to the items that block a baseline', () => {
    const rows = buildRows(tree(), { ...defaults, pricing: 'incomplete' });

    expect(rows.map((row) => row.node.code)).toEqual(['01', '01.002']);
  });

  it('keeps pinned nodes regardless of the active filter', () => {
    const rows = buildRows(tree(), {
      ...defaults,
      pricing: 'incomplete',
      pinned: new Set(['i3']),
    });

    expect(rows.map((row) => row.node.code)).toContain('02.01.001');
  });

  it('returns nothing when a search matches no row', () => {
    expect(buildRows(tree(), { ...defaults, search: 'nothing here' })).toEqual([]);
  });
});

describe('isIncomplete', () => {
  it('flags a billable item that cannot produce a line amount', () => {
    expect(isIncomplete(testNode({ id: 'x', isLeaf: true, unit: 'm', quantity: '1' }))).toBe(true);
  });

  /** A section is never incomplete — its total comes from its descendants. */
  it('never flags a section', () => {
    expect(isIncomplete(testNode({ id: 'x', isLeaf: false }))).toBe(false);
  });

  /** Zero is a legitimate provisional rate, not a missing one. */
  it('treats a zero rate as priced', () => {
    expect(
      isIncomplete(
        testNode({ id: 'x', isLeaf: true, unit: 'LS', quantity: '1.000', unitRate: '0.00' }),
      ),
    ).toBe(false);
  });
});

describe('countTree', () => {
  it('counts sections, items and priced items across the whole tree', () => {
    expect(countTree(tree())).toEqual({ sections: 3, items: 3, priced: 2 });
  });
});

describe('collectSectionIds', () => {
  it('returns only the nodes that can be collapsed', () => {
    expect(collectSectionIds(tree())).toEqual(['s1', 's2', 's3']);
  });
});

describe('source filter (Phase 6 — original vs variation scope)', () => {
  const mixed = () => [
    testNode({
      id: 'o1',
      code: '01',
      isLeaf: false,
      children: [
        testNode({ id: 'o1a', code: '01.001', isLeaf: true, sourceType: 'BASELINE', children: [] }),
        testNode({
          id: 'v1a',
          code: '01.002',
          isLeaf: true,
          sourceType: 'VARIATION',
          sourceChangeOrderId: 'vo-3',
          children: [],
        }),
      ],
    }),
  ];

  it('keeps only variation lines, with their section for context', () => {
    const rows = buildRows(mixed(), { ...defaults, pricing: 'variations' });
    expect(rows.map((row) => row.node.code)).toEqual(['01', '01.002']);
  });

  it('keeps only original scope', () => {
    const rows = buildRows(mixed(), { ...defaults, pricing: 'original' });
    expect(rows.map((row) => row.node.code)).toEqual(['01', '01.001']);
  });
});

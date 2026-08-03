import { describe, expect, it } from 'vitest';

import { getNodeActions, nextSortOrder, planReorder, sortSiblings } from './node-actions';
import type { BoqTreeNode } from './types';

function node(overrides: Partial<BoqTreeNode> & { id: string }): BoqTreeNode {
  return {
    boqId: 'b1',
    versionId: 'v1',
    parentId: null,
    path: overrides.id,
    depth: 0,
    sortOrder: 1,
    code: '01',
    description: 'Section',
    descriptionAr: null,
    unit: null,
    quantity: null,
    unitRate: null,
    currency: null,
    totalAmount: null,
    isLeaf: false,
    originNodeId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    children: [],
    computedTotal: null,
    ...overrides,
  };
}

describe('getNodeActions', () => {
  // "Cannot add children to a leaf node" — BoqTreeService.
  it('allows children on a section but not on an item', () => {
    expect(getNodeActions(node({ id: 'a' }), []).canAddChild).toBe(true);
    expect(getNodeActions(node({ id: 'a', isLeaf: true }), []).canAddChild).toBe(false);
  });

  // "Cannot delete a node that has children."
  it('allows deleting only a node with no children', () => {
    const childless = node({ id: 'a' });
    const parent = node({ id: 'p', children: [childless] });

    expect(getNodeActions(childless, []).canDelete).toBe(true);
    expect(getNodeActions(parent, []).canDelete).toBe(false);
  });

  it('offers reordering according to position among siblings', () => {
    const first = node({ id: 'a', sortOrder: 1 });
    const middle = node({ id: 'b', sortOrder: 2 });
    const last = node({ id: 'c', sortOrder: 3 });
    const siblings = [first, middle, last];

    expect(getNodeActions(first, siblings)).toMatchObject({ canMoveUp: false, canMoveDown: true });
    expect(getNodeActions(middle, siblings)).toMatchObject({ canMoveUp: true, canMoveDown: true });
    expect(getNodeActions(last, siblings)).toMatchObject({ canMoveUp: true, canMoveDown: false });
  });

  it('offers no reordering for an only child', () => {
    const only = node({ id: 'a' });

    expect(getNodeActions(only, [only])).toMatchObject({ canMoveUp: false, canMoveDown: false });
  });
});

describe('sortSiblings', () => {
  it('orders by sortOrder without mutating the input', () => {
    const input = [node({ id: 'b', sortOrder: 2 }), node({ id: 'a', sortOrder: 1 })];

    expect(sortSiblings(input).map((n) => n.id)).toEqual(['a', 'b']);
    expect(input.map((n) => n.id)).toEqual(['b', 'a']);
  });
});

describe('nextSortOrder', () => {
  // The server requires sortOrder on create and never allocates one.
  it('starts at 1 for the first child', () => {
    expect(nextSortOrder([])).toBe(1);
  });

  it('appends after the highest existing position', () => {
    expect(nextSortOrder([node({ id: 'a', sortOrder: 1 }), node({ id: 'b', sortOrder: 5 })])).toBe(6);
  });

  // Guards against reusing a position, which would tie the order — see B13.
  it('does not collide when positions are not contiguous', () => {
    const siblings = [node({ id: 'a', sortOrder: 3 }), node({ id: 'b', sortOrder: 1 })];

    expect(nextSortOrder(siblings)).toBe(4);
    expect(siblings.some((s) => s.sortOrder === nextSortOrder(siblings))).toBe(false);
  });
});

describe('planReorder', () => {
  const a = node({ id: 'a', sortOrder: 1 });
  const b = node({ id: 'b', sortOrder: 2 });
  const c = node({ id: 'c', sortOrder: 3 });
  const siblings = [a, b, c];

  /**
   * Expressed as a swap because moveNode writes only the node it is given and never
   * reindexes siblings (B13). Swapping touches two rows and leaves the rest alone.
   */
  it('swaps positions with the previous sibling when moving up', () => {
    expect(planReorder(b, siblings, 'up')).toEqual({
      moved: { id: 'b', sortOrder: 1 },
      displaced: { id: 'a', sortOrder: 2 },
    });
  });

  it('swaps positions with the next sibling when moving down', () => {
    expect(planReorder(b, siblings, 'down')).toEqual({
      moved: { id: 'b', sortOrder: 3 },
      displaced: { id: 'c', sortOrder: 2 },
    });
  });

  it('refuses to move the first sibling up or the last one down', () => {
    expect(planReorder(a, siblings, 'up')).toBeNull();
    expect(planReorder(c, siblings, 'down')).toBeNull();
  });

  it('returns null for a node that is not in the list', () => {
    expect(planReorder(node({ id: 'z' }), siblings, 'up')).toBeNull();
  });

  /**
   * Sibling positions can already be tied, because the server permits duplicates. Swapping
   * equal values would be a no-op, so the pair is given distinct positions instead.
   */
  it('breaks a tie rather than swapping two identical positions', () => {
    const tied = [node({ id: 'x', sortOrder: 2 }), node({ id: 'y', sortOrder: 2 })];
    const plan = planReorder(tied[1]!, tied, 'up');

    expect(plan).not.toBeNull();
    expect(plan!.moved.sortOrder).toBeLessThan(plan!.displaced.sortOrder);
  });
});

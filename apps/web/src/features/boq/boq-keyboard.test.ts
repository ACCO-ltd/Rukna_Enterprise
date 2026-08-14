import { describe, expect, it } from 'vitest';

import { clamp, isNavigationKey, resolveKeyIntent } from './boq-keyboard';
import { buildRows } from './boq-rows';
import { testNode } from './test-node';

/**
 *  0  01        Preliminaries        section, expanded
 *  1    01.001  Site office          item
 *  2    01.002  Fencing              item
 *  3  02        Substructure         section, expanded
 *  4    02.01   Excavation           section, expanded
 *  5      02.01.001  Bulk excavation item
 */
const tree = () => [
  testNode({
    id: 's1',
    code: '01',
    children: [
      testNode({ id: 'i1', code: '01.001', isLeaf: true }),
      testNode({ id: 'i2', code: '01.002', isLeaf: true }),
    ],
  }),
  testNode({
    id: 's2',
    code: '02',
    children: [
      testNode({
        id: 's3',
        code: '02.01',
        children: [testNode({ id: 'i3', code: '02.01.001', isLeaf: true })],
      }),
    ],
  }),
];

const rows = (collapsed: string[] = []) =>
  buildRows(tree(), { collapsed: new Set(collapsed), search: '', pricing: 'all' });

describe('resolveKeyIntent — moving', () => {
  it('steps down and up the visible rows', () => {
    expect(resolveKeyIntent('ArrowDown', 0, rows())).toEqual({ type: 'focus', index: 1 });
    expect(resolveKeyIntent('ArrowUp', 3, rows())).toEqual({ type: 'focus', index: 2 });
  });

  /** Arrowing past either end should sit still, not wrap — wrapping loses your place. */
  it('stops at the ends rather than wrapping', () => {
    expect(resolveKeyIntent('ArrowUp', 0, rows())).toEqual({ type: 'focus', index: 0 });
    expect(resolveKeyIntent('ArrowDown', 5, rows())).toEqual({ type: 'focus', index: 5 });
  });

  it('jumps to the first and last visible rows', () => {
    expect(resolveKeyIntent('Home', 4, rows())).toEqual({ type: 'focus', index: 0 });
    expect(resolveKeyIntent('End', 0, rows())).toEqual({ type: 'focus', index: 5 });
  });

  /** Collapsed children are not in the row list, so "next" skips them without special care. */
  it('walks only what is on screen', () => {
    const collapsed = rows(['s1']);

    expect(collapsed.map((row) => row.node.code)).toEqual(['01', '02', '02.01', '02.01.001']);
    expect(resolveKeyIntent('ArrowDown', 0, collapsed)).toEqual({ type: 'focus', index: 1 });
  });
});

describe('resolveKeyIntent — folding', () => {
  it('opens a closed section with the deeper arrow', () => {
    expect(resolveKeyIntent('ArrowRight', 0, rows(['s1']))).toEqual({
      type: 'toggle',
      nodeId: 's1',
      index: 0,
    });
  });

  it('steps into an already-open section instead of re-toggling it', () => {
    expect(resolveKeyIntent('ArrowRight', 0, rows())).toEqual({ type: 'focus', index: 1 });
  });

  it('closes an open section with the shallower arrow', () => {
    expect(resolveKeyIntent('ArrowLeft', 0, rows())).toEqual({
      type: 'toggle',
      nodeId: 's1',
      index: 0,
    });
  });

  it('steps out to the enclosing section from a leaf', () => {
    // Row 5 is 02.01.001, nested under 02.01 at row 4.
    expect(resolveKeyIntent('ArrowLeft', 5, rows())).toEqual({ type: 'focus', index: 4 });
    // And again, from 02.01 out to 02.
    expect(resolveKeyIntent('ArrowLeft', 4, rows())).toEqual({ type: 'toggle', nodeId: 's3', index: 4 });
  });

  it('does nothing going deeper on a leaf, or shallower at the root', () => {
    expect(resolveKeyIntent('ArrowRight', 1, rows())).toBeNull();
    expect(resolveKeyIntent('ArrowLeft', 0, rows(['s1']))).toBeNull();
  });

  /**
   * In Arabic the tree opens towards the leading edge, which is the right-hand side, so the
   * arrows swap. Reusing the LTR mapping would fold the tree backwards for half the users.
   */
  it('swaps the arrows in RTL', () => {
    expect(resolveKeyIntent('ArrowLeft', 0, rows(['s1']), true)).toEqual({
      type: 'toggle',
      nodeId: 's1',
      index: 0,
    });
    expect(resolveKeyIntent('ArrowRight', 0, rows(), true)).toEqual({
      type: 'toggle',
      nodeId: 's1',
      index: 0,
    });
  });
});

describe('resolveKeyIntent — opening', () => {
  it('opens the focused row on Enter and Space', () => {
    expect(resolveKeyIntent('Enter', 2, rows())).toEqual({ type: 'open', index: 2 });
    expect(resolveKeyIntent(' ', 2, rows())).toEqual({ type: 'open', index: 2 });
  });

  it('ignores keys it does not own, so typing still reaches the browser', () => {
    expect(resolveKeyIntent('a', 0, rows())).toBeNull();
    expect(resolveKeyIntent('Tab', 0, rows())).toBeNull();
    expect(isNavigationKey('Tab')).toBe(false);
    expect(isNavigationKey('ArrowDown')).toBe(true);
  });

  it('does nothing at all on an empty grid', () => {
    expect(resolveKeyIntent('ArrowDown', 0, [])).toBeNull();
    expect(resolveKeyIntent('Enter', 0, [])).toBeNull();
  });
});

describe('clamp', () => {
  /**
   * Collapsing a section shortens the list under the remembered index. Clamping keeps the
   * tab stop near where the user was; resetting to zero would throw them to the top of a
   * 400-row BOQ every time they folded something away.
   */
  it('keeps the tab stop on a real row as the list shrinks', () => {
    expect(clamp(40, 6)).toBe(5);
    expect(clamp(-3, 6)).toBe(0);
    expect(clamp(3, 6)).toBe(3);
    expect(clamp(2, 0)).toBe(0);
  });
});

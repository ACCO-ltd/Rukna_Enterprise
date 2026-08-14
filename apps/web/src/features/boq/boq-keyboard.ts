import type { BoqRow } from './boq-rows';

/**
 * Keyboard navigation for the BOQ grid.
 *
 * Kept pure and out of the component so the mapping can be tested against a row list rather
 * than a rendered 400-row table, and so the same rules cannot drift between the key handler
 * and anything else that moves focus.
 *
 * The grid had no keyboard path at all before this: rows were `<tr onClick>` with
 * `cursor-pointer` and no `tabIndex`, `role` or key handler, so opening a BOQ item — the
 * primary action on the densest screen in the product — was mouse-only. WCAG 2.1.1, Level A.
 *
 * Left and Right follow the tree conventions people already know from a file explorer:
 * Right opens a closed section or steps into an open one, Left closes an open section or
 * steps out to the parent. A surveyor arrowing through 400 lines should not have to learn a
 * new idiom to fold a section away.
 */

export type BoqKeyIntent =
  | { type: 'focus'; index: number }
  | { type: 'toggle'; nodeId: string; index: number }
  | { type: 'open'; index: number }
  | null;

/** Keys this grid claims. Anything else falls through to the browser. */
const HANDLED = new Set([
  'ArrowDown',
  'ArrowUp',
  'ArrowRight',
  'ArrowLeft',
  'Home',
  'End',
  'Enter',
  ' ',
]);

export function isNavigationKey(key: string): boolean {
  return HANDLED.has(key);
}

/**
 * Resolves a keypress against the currently visible rows.
 *
 * `rows` is the same flat list the grid renders — `buildRows` already collapses hidden
 * children out of it, so "next row" means the next row a person can actually see. Returns
 * null when the key does nothing here, so the caller knows not to preventDefault.
 *
 * `rtl` swaps Left and Right: in an Arabic layout the tree opens towards the leading edge,
 * which is the right-hand side, so ArrowLeft is "deeper" and ArrowRight is "out".
 */
export function resolveKeyIntent(
  key: string,
  currentIndex: number,
  rows: readonly BoqRow[],
  rtl = false,
): BoqKeyIntent {
  if (rows.length === 0) return null;

  const index = clamp(currentIndex, rows.length);
  const row = rows[index];
  if (!row) return null;

  const deeper = rtl ? 'ArrowLeft' : 'ArrowRight';
  const shallower = rtl ? 'ArrowRight' : 'ArrowLeft';

  switch (key) {
    case 'ArrowDown':
      return { type: 'focus', index: Math.min(index + 1, rows.length - 1) };

    case 'ArrowUp':
      return { type: 'focus', index: Math.max(index - 1, 0) };

    case 'Home':
      return { type: 'focus', index: 0 };

    case 'End':
      return { type: 'focus', index: rows.length - 1 };

    case 'Enter':
    case ' ':
      return { type: 'open', index };

    case deeper:
      // Closed section → open it. Open section → step to its first child, which is the row
      // immediately below. A leaf has nowhere deeper to go, so the key does nothing.
      if (!row.hasChildren) return null;
      if (!row.expanded) return { type: 'toggle', nodeId: row.node.id, index };
      return { type: 'focus', index: Math.min(index + 1, rows.length - 1) };

    case shallower: {
      // Open section → close it. Anything else → step out to the parent.
      if (row.hasChildren && row.expanded) {
        return { type: 'toggle', nodeId: row.node.id, index };
      }
      const parent = findParentIndex(rows, index);
      return parent === null ? null : { type: 'focus', index: parent };
    }

    default:
      return null;
  }
}

/**
 * The nearest row above that sits one level shallower.
 *
 * Walks the rendered list rather than the tree because that is what the user is looking at:
 * the parent of a row is the enclosing section they can see, not an ancestor filtered out
 * of view by a search.
 */
function findParentIndex(rows: readonly BoqRow[], index: number): number | null {
  const depth = rows[index]?.depth ?? 0;
  if (depth === 0) return null;

  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    if ((rows[candidate]?.depth ?? 0) < depth) return candidate;
  }
  return null;
}

/**
 * Keeps the roving tab stop on a real row as the list changes underneath it.
 *
 * Filtering, collapsing or deleting can leave the remembered index past the end. Clamping
 * rather than resetting to zero means collapsing a section does not throw the user back to
 * the top of a 400-row BOQ.
 */
export function clamp(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

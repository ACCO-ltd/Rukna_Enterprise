import type { BoqTreeNode } from './types';

/**
 * Reordering is withheld from the UI until B14 is fixed.
 *
 * `POST .../nodes/:id/move` answers 500 for every call: the descendant-path update binds
 * `substring("path", $n)` with a JS number, which Prisma sends as bigint, and Postgres has
 * no `substring(text, bigint)`. The two statements are not in a transaction, so the first
 * has already committed when the second throws — the node's parent, path, depth and
 * sortOrder change while its descendants keep stale paths, leaving the materialized-path
 * tree inconsistent.
 *
 * A control that half-applies and corrupts the tree is worse than no control, so the
 * buttons are not rendered. The planning logic below is correct and tested; flipping this
 * flag is the whole re-enable.
 */
export const REORDER_ENABLED = false;

/**
 * What a node permits, mirroring BoqTreeService's rules so the UI offers only operations
 * that will succeed rather than buttons that answer 400.
 */
export interface NodeActions {
  /** Sections take children; leaves do not ("Cannot add children to a leaf node"). */
  canAddChild: boolean;
  /** Deleting is refused while a node still has children. */
  canDelete: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export function getNodeActions(node: BoqTreeNode, siblings: BoqTreeNode[]): NodeActions {
  const ordered = sortSiblings(siblings);
  const index = ordered.findIndex((s) => s.id === node.id);

  return {
    canAddChild: !node.isLeaf,
    canDelete: node.children.length === 0,
    canMoveUp: index > 0,
    canMoveDown: index >= 0 && index < ordered.length - 1,
  };
}

export function sortSiblings(siblings: BoqTreeNode[]): BoqTreeNode[] {
  return [...siblings].sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Position for a node appended to the end of a sibling list.
 *
 * The server requires `sortOrder` on create and never allocates one, so the client picks
 * it. Taking max + 1 keeps appended nodes distinct from their siblings; starting at 1
 * matches the numbering the API examples use.
 */
export function nextSortOrder(siblings: BoqTreeNode[]): number {
  if (siblings.length === 0) return 1;
  return Math.max(...siblings.map((s) => s.sortOrder)) + 1;
}

/**
 * The two writes needed to swap a node with its neighbour.
 *
 * Reordering is expressed as a swap rather than a renumber because `moveNode` updates only
 * the node it is given and never reindexes siblings (B13). Swapping touches exactly two
 * rows and leaves every other position untouched, so it cannot disturb the rest of the
 * list.
 *
 * Returns null when the move is not possible. The caller must apply both writes; if the
 * second fails the two nodes momentarily share a sortOrder, which the server tolerates but
 * which leaves their relative order undefined until a further move fixes it. That is a
 * consequence of B13, not of the swap.
 */
export function planReorder(
  node: BoqTreeNode,
  siblings: BoqTreeNode[],
  direction: 'up' | 'down',
): { moved: { id: string; sortOrder: number }; displaced: { id: string; sortOrder: number } } | null {
  const ordered = sortSiblings(siblings);
  const index = ordered.findIndex((s) => s.id === node.id);
  if (index === -1) return null;

  const neighbourIndex = direction === 'up' ? index - 1 : index + 1;
  const neighbour = ordered[neighbourIndex];
  if (!neighbour) return null;

  // Equal sortOrders would make the swap a no-op, so give the pair distinct positions
  // based on their current display order instead.
  if (neighbour.sortOrder === node.sortOrder) {
    return {
      moved: { id: node.id, sortOrder: direction === 'up' ? node.sortOrder - 1 : node.sortOrder + 1 },
      displaced: { id: neighbour.id, sortOrder: neighbour.sortOrder },
    };
  }

  return {
    moved: { id: node.id, sortOrder: neighbour.sortOrder },
    displaced: { id: neighbour.id, sortOrder: node.sortOrder },
  };
}

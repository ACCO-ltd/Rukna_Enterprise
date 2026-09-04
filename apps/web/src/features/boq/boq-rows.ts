import type { BoqTreeNodeResponse } from '@erp/types';

/**
 * Turning the BOQ tree into the rows a table renders.
 *
 * Pure and JSX-free so the rules that decide what a user sees — which rows a search keeps,
 * which stay collapsed, which are flagged — can be tested without mounting a 400-row grid.
 */

export interface BoqRow {
  node: BoqTreeNodeResponse;
  depth: number;
  /** False for a billable item, or a section whose children are all filtered out. */
  hasChildren: boolean;
  expanded: boolean;
}

export type PricingFilter =
  | 'all'
  | 'incomplete'
  | 'priced'
  | 'sections'
  | 'items'
  // Provenance (BOQ refinement Phase 6): original contract scope vs work scoped in by a variation.
  | 'original'
  | 'variations';

export interface RowOptions {
  collapsed: ReadonlySet<string>;
  search: string;
  pricing: PricingFilter;
  /** Node ids to keep regardless of the filters — the readiness banner's blockers. */
  pinned?: ReadonlySet<string>;
}

/** A billable item is priced when it can produce a line amount. */
export function isPriced(node: BoqTreeNodeResponse): boolean {
  return Boolean(node.unit) && node.quantity !== null && node.unitRate !== null;
}

export function isIncomplete(node: BoqTreeNodeResponse): boolean {
  return node.isLeaf && !isPriced(node);
}

/**
 * Filters the tree, then flattens what survives into display rows.
 *
 * Filtering happens before flattening so a matching item drags its ancestors along: a
 * search for "excavation" that returned the item without the section it sits under would
 * strip away the only thing that makes the code `02.01.002` mean anything. A section is
 * kept when it matches directly *or* when any descendant does.
 */
export function buildRows(
  nodes: BoqTreeNodeResponse[],
  options: RowOptions,
): BoqRow[] {
  const filtered = filterTree(nodes, options);
  const rows: BoqRow[] = [];

  // Searching implies you want to see what you found, so collapse state is ignored while a
  // filter is active — otherwise a match can be hidden inside a section the user closed.
  const filtering = options.search.trim().length > 0 || options.pricing !== 'all';

  const walk = (list: BoqTreeNodeResponse[], depth: number): void => {
    for (const node of list) {
      const expanded = filtering || !options.collapsed.has(node.id);
      rows.push({ node, depth, hasChildren: node.children.length > 0, expanded });
      if (node.children.length > 0 && expanded) walk(node.children, depth + 1);
    }
  };

  walk(filtered, 0);
  return rows;
}

function filterTree(
  nodes: BoqTreeNodeResponse[],
  options: RowOptions,
): BoqTreeNodeResponse[] {
  const term = options.search.trim().toLocaleLowerCase();
  if (!term && options.pricing === 'all') return nodes;

  const keep = (node: BoqTreeNodeResponse): BoqTreeNodeResponse | null => {
    const children = node.children
      .map(keep)
      .filter((child): child is BoqTreeNodeResponse => child !== null);

    if (children.length > 0) return { ...node, children };
    return matches(node, term, options) ? { ...node, children: [] } : null;
  };

  return nodes.map(keep).filter((node): node is BoqTreeNodeResponse => node !== null);
}

function matches(node: BoqTreeNodeResponse, term: string, options: RowOptions): boolean {
  if (options.pinned?.has(node.id)) return true;

  if (term) {
    const haystack = [node.code, node.description]
      .join(' ')
      .toLocaleLowerCase();
    if (!haystack.includes(term)) return false;
  }

  switch (options.pricing) {
    case 'incomplete':
      return isIncomplete(node);
    case 'priced':
      return node.isLeaf && isPriced(node);
    case 'sections':
      return !node.isLeaf;
    case 'items':
      return node.isLeaf;
    case 'variations':
      return node.sourceType === 'VARIATION';
    case 'original':
      return node.sourceType === 'BASELINE';
    default:
      return true;
  }
}

/** Every node id in the tree — for expand-all / collapse-all. */
export function collectSectionIds(nodes: BoqTreeNodeResponse[]): string[] {
  const ids: string[] = [];
  const walk = (list: BoqTreeNodeResponse[]): void => {
    for (const node of list) {
      if (node.children.length > 0) {
        ids.push(node.id);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return ids;
}

/** Depth-first flatten with no filtering — used by export and by the item picker. */
export function flattenTree(nodes: BoqTreeNodeResponse[]): BoqTreeNodeResponse[] {
  const flat: BoqTreeNodeResponse[] = [];
  const walk = (list: BoqTreeNodeResponse[]): void => {
    for (const node of list) {
      flat.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return flat;
}

/** Counts for the summary strip, derived from the tree the user is actually looking at. */
export function countTree(nodes: BoqTreeNodeResponse[]): {
  sections: number;
  items: number;
  priced: number;
} {
  let sections = 0;
  let items = 0;
  let priced = 0;

  for (const node of flattenTree(nodes)) {
    if (node.isLeaf) {
      items += 1;
      if (isPriced(node)) priced += 1;
    } else {
      sections += 1;
    }
  }

  return { sections, items, priced };
}

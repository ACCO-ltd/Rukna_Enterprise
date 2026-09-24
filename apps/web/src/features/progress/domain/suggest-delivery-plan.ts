import type { BoqTreeNodeResponse } from '@erp/types';

/**
 * Pure suggestion engine for the Delivery Plan setup flow — reads the project's committed BOQ tree
 * (already fetched by the caller via `useBoqTree`, the same read the leaf-allocation picker uses —
 * `GET .../tree` returns the ROOT nodes with `children` nested, not a flat list) and proposes one
 * work package per top-level BOQ section that still has unallocated scope.
 *
 * Nothing here writes anything. A suggestion is a starting point the PM edits (name, code, owner,
 * weight, which leaves) before any Save — this module never decides what gets persisted, only what
 * gets proposed. BOQ-value weight is a suggestion, never treated as an approved physical weight
 * (the caller/UI must keep every suggested weight editable).
 */

export interface SuggestedPackage {
  /** Auto-generated, not colliding with any existing or sibling-suggested code. Editable by the PM. */
  code: string;
  /** The section's own description. Editable by the PM. */
  name: string;
  /** The top-level BOQ section this package was derived from, for "inspect assigned leaves". */
  sectionNodeId: string;
  sectionCode: string;
  leafIds: string[];
  /** Σ totalAmount of the suggested leaves, in the BOQ's currency. */
  totalValue: number;
  /** Fraction 0..1 of the suggested (unallocated) value across ALL suggested packages. */
  suggestedWeight: number;
}

export interface DeliveryPlanSuggestion {
  packages: SuggestedPackage[];
  /**
   * Suggested leaves that carry no price yet — included in a package (so nothing measurable goes
   * untracked), but flagged: their contribution to the section's weight is zero, which understates
   * that package's suggested weight until someone prices them.
   */
  unpricedLeafIds: string[];
  /**
   * An unallocated WORK leaf that is itself a top-level node (no section to group it under).
   * Should not occur on a well-formed BOQ; surfaced rather than silently dropped.
   */
  orphanLeafIds: string[];
}

/**
 * @param roots the top-level nodes of the committed BOQ version's tree, each with `children` nested
 * @param existingCodes work-package codes already used in this project (suggested codes never collide)
 * @param alreadyAllocatedLeafIds BOQ leaf ids already allocated to an existing work package (excluded)
 */
export function suggestDeliveryPlan(
  roots: readonly BoqTreeNodeResponse[],
  existingCodes: ReadonlySet<string>,
  alreadyAllocatedLeafIds: ReadonlySet<string>,
): DeliveryPlanSuggestion {
  const orphanLeafIds: string[] = [];
  const candidates: Array<{ section: BoqTreeNodeResponse; leaves: BoqTreeNodeResponse[] }> = [];

  for (const root of roots) {
    if (root.isLeaf) {
      // A leaf sitting at the top level has no section to group it under.
      if (isUnallocatedWorkLeaf(root, alreadyAllocatedLeafIds)) orphanLeafIds.push(root.id);
      continue;
    }
    const leaves = collectUnallocatedWorkLeaves(root, alreadyAllocatedLeafIds);
    if (leaves.length > 0) candidates.push({ section: root, leaves });
  }

  const totalValue = candidates.reduce((sum, c) => sum + sumValue(c.leaves), 0);
  const codes = assignCodes(candidates.length, existingCodes);
  const unpricedLeafIds: string[] = [];

  const packages: SuggestedPackage[] = candidates.map((c, index) => {
    const value = sumValue(c.leaves);
    for (const leaf of c.leaves) {
      if (!leafValue(leaf)) unpricedLeafIds.push(leaf.id);
    }
    return {
      code: codes[index]!,
      name: c.section.description,
      sectionNodeId: c.section.id,
      sectionCode: c.section.code,
      leafIds: c.leaves.map((l) => l.id),
      totalValue: value,
      suggestedWeight: totalValue > 0 ? value / totalValue : 0,
    };
  });

  return { packages, unpricedLeafIds, orphanLeafIds };
}

function isUnallocatedWorkLeaf(node: BoqTreeNodeResponse, alreadyAllocatedLeafIds: ReadonlySet<string>): boolean {
  return node.isActive && node.nodeRole === 'WORK' && !alreadyAllocatedLeafIds.has(node.id);
}

/** Every unallocated, active, WORK leaf under `node` (which may itself be the leaf). */
function collectUnallocatedWorkLeaves(
  node: BoqTreeNodeResponse,
  alreadyAllocatedLeafIds: ReadonlySet<string>,
): BoqTreeNodeResponse[] {
  if (node.isLeaf) {
    return isUnallocatedWorkLeaf(node, alreadyAllocatedLeafIds) ? [node] : [];
  }
  return node.children.flatMap((child) => collectUnallocatedWorkLeaves(child, alreadyAllocatedLeafIds));
}

function leafValue(leaf: BoqTreeNodeResponse): number {
  return leaf.totalAmount ? Number(leaf.totalAmount) : 0;
}

function sumValue(leaves: readonly BoqTreeNodeResponse[]): number {
  return leaves.reduce((sum, l) => sum + leafValue(l), 0);
}

/** The next `count` WP-NN codes not already in `existingCodes`, in ascending order. */
function assignCodes(count: number, existingCodes: ReadonlySet<string>): string[] {
  const used = new Set(existingCodes);
  const codes: string[] = [];
  let n = 1;
  while (codes.length < count) {
    const code = `WP-${String(n).padStart(2, '0')}`;
    if (!used.has(code)) {
      codes.push(code);
      used.add(code);
    }
    n += 1;
  }
  return codes;
}

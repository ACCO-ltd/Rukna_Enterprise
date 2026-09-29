import type { BoqImportPreviewNode, BoqTreeNodeResponse } from '@erp/types';

/**
 * The import preview as a real tree.
 *
 * The planner returns its nodes level by level (every root, then every depth-1 node, …), so a
 * flat list read top to bottom showed 1, 2, 1.1, 1.2, 2.1, 1.1.1. The review has to show the bill
 * the way it will land — 1, 1.1, 1.1.1, 1.2, 2, 2.1 — so this rebuilds the hierarchy from
 * `parentCode`, keeping the planner's order among siblings.
 *
 * The nodes are shaped as `BoqTreeNodeResponse` so the review can render with the same read-only
 * BOQ grid as the workspace. Fields the preview does not carry get neutral values; nothing here is
 * ever sent back to the server. A node whose parent is not in the preview (APPEND onto an existing
 * section) becomes a root of the preview.
 */
export function previewToTree(nodes: readonly BoqImportPreviewNode[], currency: string): BoqTreeNodeResponse[] {
  const byCode = new Map<string, BoqTreeNodeResponse>();
  const now = new Date(0).toISOString();

  for (const node of nodes) {
    byCode.set(node.code, {
      id: `preview:${node.code}`,
      boqId: 'preview',
      versionId: 'preview',
      parentId: node.parentCode ? `preview:${node.parentCode}` : null,
      path: node.code,
      depth: node.depth,
      sortOrder: 0,
      code: node.code,
      description: node.description,
      isLeaf: node.isLeaf,
      measurementMethod: 'QUANTITY',
      pricingBasis: 'UNIT_RATE',
      unit: node.unit,
      quantity: node.quantity,
      unitRate: node.unitRate,
      currency,
      totalAmount: node.totalAmount,
      originNodeId: null,
      sourceType: 'BASELINE',
      sourceChangeOrderId: null,
      nodeRole: 'WORK',
      commercialTreatment: 'IN_CONTRACT',
      isActive: true,
      createdAt: now,
      updatedAt: now,
      children: [],
      computedTotal: node.isLeaf ? node.totalAmount : null,
      // The preview is the importer's own file — its figures are already on screen.
      priced: node.isLeaf && Boolean(node.unit) && node.quantity !== null && node.unitRate !== null,
      valueShare: null,
    });
  }

  const roots: BoqTreeNodeResponse[] = [];
  for (const node of nodes) {
    const built = byCode.get(node.code)!;
    const parent = node.parentCode ? byCode.get(node.parentCode) : undefined;
    if (parent) {
      parent.children.push(built);
    } else {
      built.parentId = null;
      roots.push(built);
    }
  }

  // Siblings keep the planner's order; renumber sortOrder to match so move bounds read true.
  const number = (list: BoqTreeNodeResponse[]) =>
    list.forEach((node, index) => {
      node.sortOrder = index;
      number(node.children);
    });
  number(roots);
  return roots;
}

/** Depth-first codes — the order a reader sees. For tests and for keys. */
export function treeOrder(nodes: readonly BoqTreeNodeResponse[]): string[] {
  return nodes.flatMap((node) => [node.code, ...treeOrder(node.children)]);
}

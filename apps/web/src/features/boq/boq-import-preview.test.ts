import { describe, expect, it } from 'vitest';
import type { BoqImportPreviewNode } from '@erp/types';

import { previewToTree, treeOrder } from './boq-import-preview';
import { buildRows } from './boq-rows';

function node(code: string, parentCode: string | null, isLeaf = false): BoqImportPreviewNode {
  return {
    code,
    parentCode,
    description: `Line ${code}`,
    isLeaf,
    depth: code.split('.').length - 1,
    unit: isLeaf ? 'm3' : null,
    quantity: isLeaf ? '1' : null,
    unitRate: isLeaf ? '2.00' : null,
    totalAmount: isLeaf ? '2.00' : null,
    autoCreated: false,
  };
}

describe('previewToTree', () => {
  // The planner returns nodes level by level; the review must read as the bill will land.
  const levelByLevel = [
    node('1', null),
    node('2', null),
    node('1.1', '1'),
    node('1.2', '1', true),
    node('2.1', '2', true),
    node('1.1.1', '1.1', true),
  ];

  it('rebuilds the true hierarchy: 1, 1.1, 1.1.1, 1.2, 2, 2.1', () => {
    expect(treeOrder(previewToTree(levelByLevel, 'USD'))).toEqual(['1', '1.1', '1.1.1', '1.2', '2', '2.1']);
  });

  it('renders in that order through the same row builder the grid uses', () => {
    const rows = buildRows(previewToTree(levelByLevel, 'USD'), { collapsed: new Set(), search: '', pricing: 'all' });
    expect(rows.map((row) => [row.node.code, row.depth])).toEqual([
      ['1', 0],
      ['1.1', 1],
      ['1.1.1', 2],
      ['1.2', 1],
      ['2', 0],
      ['2.1', 1],
    ]);
  });

  it('keeps the planner order among siblings, and roots a line whose parent already exists', () => {
    const tree = previewToTree([node('3.2', '3', true), node('3.1', '3', true)], 'USD');
    // Parent "3" is an existing section (APPEND), not in the preview: both lines become roots.
    expect(treeOrder(tree)).toEqual(['3.2', '3.1']);
    expect(tree.every((line) => line.parentId === null)).toBe(true);
  });

  it('carries the server-computed line amount as the leaf total', () => {
    const [root] = previewToTree([node('1', null), node('1.1', '1', true)], 'USD');
    expect(root!.children[0]!.computedTotal).toBe('2.00');
  });
});

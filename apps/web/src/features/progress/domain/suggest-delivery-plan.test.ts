import { describe, expect, it } from 'vitest';
import type { BoqTreeNodeResponse } from '@erp/types';

import { suggestDeliveryPlan } from './suggest-delivery-plan';

const node = (over: Partial<BoqTreeNodeResponse>): BoqTreeNodeResponse => ({
  id: 'n', boqId: 'boq-1', versionId: 'v-1', parentId: null, path: 'n', depth: 0,
  sortOrder: 0, code: '1', description: 'Node', isLeaf: false, children: [],
  measurementMethod: 'QUANTITY', pricingBasis: 'UNIT_RATE', unit: null, quantity: null,
  unitRate: null, currency: 'USD', totalAmount: null, computedTotal: null, originNodeId: null,
  sourceType: 'BASELINE', sourceChangeOrderId: null, nodeRole: 'WORK',
  commercialTreatment: 'IN_CONTRACT', isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const leaf = (over: Partial<BoqTreeNodeResponse>): BoqTreeNodeResponse =>
  node({ isLeaf: true, children: [], ...over });

// A two-section BOQ: 1 Substructure (2 leaves), 2 Superstructure (1 leaf).
const leaf1 = leaf({ id: 'leaf-1', code: '1.1', description: 'Excavation', totalAmount: '60000' });
const leaf2 = leaf({ id: 'leaf-2', code: '1.2', description: 'Foundation concrete', totalAmount: '40000' });
const substructure = node({ id: 'sec-1', code: '1', description: 'Substructure', children: [leaf1, leaf2] });

const leaf3 = leaf({ id: 'leaf-3', code: '2.1', description: 'Columns', totalAmount: '50000' });
const superstructure = node({ id: 'sec-2', code: '2', description: 'Superstructure', children: [leaf3] });

const roots = [substructure, superstructure];

describe('suggestDeliveryPlan', () => {
  it('proposes one package per top-level section with unallocated scope, weighted by BOQ value', () => {
    const result = suggestDeliveryPlan(roots, new Set(), new Set());

    expect(result.packages).toHaveLength(2);
    const sub = result.packages.find((p) => p.sectionNodeId === 'sec-1')!;
    const sup = result.packages.find((p) => p.sectionNodeId === 'sec-2')!;

    expect(sub.name).toBe('Substructure');
    expect(sub.leafIds.sort()).toEqual(['leaf-1', 'leaf-2']);
    expect(sub.totalValue).toBe(100000);
    // 100k of 150k total.
    expect(sub.suggestedWeight).toBeCloseTo(100000 / 150000, 6);

    expect(sup.name).toBe('Superstructure');
    expect(sup.leafIds).toEqual(['leaf-3']);
    expect(sup.suggestedWeight).toBeCloseTo(50000 / 150000, 6);

    // Weights sum to 1 across all suggestions.
    const totalWeight = result.packages.reduce((sum, p) => sum + p.suggestedWeight, 0);
    expect(totalWeight).toBeCloseTo(1, 6);
  });

  it('auto-generates codes that do not collide with existing work packages', () => {
    const result = suggestDeliveryPlan(roots, new Set(['WP-01']), new Set());
    expect(result.packages.map((p) => p.code)).toEqual(['WP-02', 'WP-03']);
  });

  it('excludes leaves already allocated to an existing work package, and drops a fully-allocated section entirely', () => {
    // leaf-3 (all of Superstructure) is already allocated — that section should not be suggested.
    const result = suggestDeliveryPlan(roots, new Set(), new Set(['leaf-3']));
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]!.sectionNodeId).toBe('sec-1');
  });

  it('suggests only the unallocated remainder of a partially-allocated section', () => {
    const result = suggestDeliveryPlan(roots, new Set(), new Set(['leaf-1']));
    const sub = result.packages.find((p) => p.sectionNodeId === 'sec-1')!;
    expect(sub.leafIds).toEqual(['leaf-2']);
    expect(sub.totalValue).toBe(40000);
  });

  it('flags an unpriced leaf without excluding it, and does not let it poison the weight math', () => {
    const unpriced = { ...leaf2, totalAmount: null };
    const section = { ...substructure, children: [leaf1, unpriced] };
    const result = suggestDeliveryPlan([section, superstructure], new Set(), new Set());
    expect(result.unpricedLeafIds).toEqual(['leaf-2']);
    const sub = result.packages.find((p) => p.sectionNodeId === 'sec-1')!;
    expect(sub.leafIds.sort()).toEqual(['leaf-1', 'leaf-2']); // still included
    expect(sub.totalValue).toBe(60000); // unpriced leaf contributes 0
  });

  it('excludes CONTINGENCY leaves from suggestions (not physical work)', () => {
    const contingency = leaf({
      id: 'leaf-4', code: '2.2', description: 'Contingency allowance', totalAmount: '10000', nodeRole: 'CONTINGENCY',
    });
    const section = { ...superstructure, children: [leaf3, contingency] };
    const result = suggestDeliveryPlan([substructure, section], new Set(), new Set());
    const sup = result.packages.find((p) => p.sectionNodeId === 'sec-2')!;
    expect(sup.leafIds).toEqual(['leaf-3']); // contingency leaf never appears
  });

  it('excludes inactive (superseded) leaves', () => {
    const superseded = { ...leaf2, isActive: false };
    const section = { ...substructure, children: [leaf1, superseded] };
    const result = suggestDeliveryPlan([section, superstructure], new Set(), new Set());
    const sub = result.packages.find((p) => p.sectionNodeId === 'sec-1')!;
    expect(sub.leafIds).toEqual(['leaf-1']);
  });

  it('produces nothing when every leaf is already allocated', () => {
    const result = suggestDeliveryPlan(roots, new Set(), new Set(['leaf-1', 'leaf-2', 'leaf-3']));
    expect(result.packages).toEqual([]);
  });

  it('flags a top-level leaf (no section to group under) as an orphan rather than dropping it silently', () => {
    const dangling = leaf({ id: 'leaf-5', code: '9.9', description: 'Dangling', totalAmount: '1000' });
    const result = suggestDeliveryPlan([dangling], new Set(), new Set());
    expect(result.orphanLeafIds).toEqual(['leaf-5']);
    expect(result.packages).toEqual([]);
  });

  it('does not flag an already-allocated top-level leaf as an orphan', () => {
    const dangling = leaf({ id: 'leaf-5', code: '9.9', description: 'Dangling', totalAmount: '1000' });
    const result = suggestDeliveryPlan([dangling], new Set(), new Set(['leaf-5']));
    expect(result.orphanLeafIds).toEqual([]);
  });
});

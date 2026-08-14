import type { BoqTreeNodeResponse } from '@erp/types';

/**
 * Builds a BOQ tree node for tests.
 *
 * Defaults describe a section: no money, not a leaf, no children. Pass overrides for the
 * fields under test — an id is required so paths and assertions stay readable.
 *
 * This lived as three identical copies across the BOQ test files until `measurementMethod`
 * and `pricingBasis` had to be added to all of them at once.
 */
export function testNode(
  overrides: Partial<BoqTreeNodeResponse> & { id: string },
): BoqTreeNodeResponse {
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
    measurementMethod: 'QUANTITY',
    pricingBasis: 'UNIT_RATE',
    unit: null,
    quantity: null,
    unitRate: null,
    // A node always reports a currency now — the BOQ's, stamped by the server
    // (CONST-BOQ-013). It was nullable and per-node before ADR-016.
    currency: 'USD',
    totalAmount: null,
    isLeaf: false,
    originNodeId: null,
    sourceType: 'BASELINE',
    sourceChangeOrderId: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    children: [],
    computedTotal: null,
    ...overrides,
  };
}

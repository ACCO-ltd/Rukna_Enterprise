import { MeasurementMethod, PricingBasis } from '@erp/types';

import type { BoqTreeNode } from './types';

/**
 * Builds a BOQ tree node for tests.
 *
 * Defaults describe a section: no money, not a leaf, no children. Pass overrides for the
 * fields under test — an id is required so paths and assertions stay readable.
 *
 * This lived as three identical copies across the BOQ test files until `measurementMethod`
 * and `pricingBasis` had to be added to all of them at once.
 */
export function testNode(overrides: Partial<BoqTreeNode> & { id: string }): BoqTreeNode {
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
    measurementMethod: MeasurementMethod.QUANTITY,
    pricingBasis: PricingBasis.UNIT_RATE,
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

import { describe, expect, it } from 'vitest';

import {
  activeRevision,
  poLineCostTargetLabel,
  systemFinds,
} from './bill-po-match';
import type { GoodsReceipt, PurchaseOrder, PurchaseOrderLine } from './types';

/**
 * The "System finds …" derivation (Slice ④, D6). These are the numbers behind the line the
 * owner's sketch shows before any bill line is entered, so the tests pin exactly which
 * receipts count (POSTED only) and what a line inherits from its PO line.
 */

function poLine(overrides: Partial<PurchaseOrderLine> = {}): PurchaseOrderLine {
  return {
    id: 'pol-1',
    lineNumber: 1,
    lineType: 'MATERIAL',
    description: '50kg cement bags',
    orderedQuantity: '285',
    unitPrice: '10.00',
    extendedAmount: '2850.00',
    materialId: 'mat-1',
    spendCategoryId: null,
    material: { code: 'CEM-50', name: 'Cement 50kg' },
    uom: { code: 'BAG', symbol: 'bag' },
    spendCategory: null,
    projectId: 'prj-1',
    boqNodeId: 'boq-1',
    project: { id: 'prj-1', code: 'WBR-26-0065', name: 'West Bank Road' },
    boqNode: { id: 'boq-1', code: '03.10', description: 'Concrete' },
    ...overrides,
  };
}

function po(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 'po-1',
    poNumber: 'PO-0042',
    status: 'OPEN',
    supplierId: 'sup-1',
    currentRevisionId: 'rev-1',
    supplier: { id: 'sup-1', name: 'ABC Trading' },
    approvalInstanceId: null,
    revisions: [
      {
        id: 'rev-1',
        revisionNumber: 1,
        status: 'ACTIVE',
        currencyCode: 'USD',
        effectiveFrom: '2026-08-01T00:00:00.000Z',
        reason: null,
        deliveryAddress: null,
        expectedDeliveryDate: null,
        approvedAt: '2026-08-01T00:00:00.000Z',
        approvedBy: 'user-1',
        lines: [poLine()],
      },
    ],
    ...overrides,
  };
}

function grn(id: string, grnNumber: string, status: GoodsReceipt['status'], accepted: string): GoodsReceipt {
  return {
    id,
    grnNumber,
    status,
    purchaseOrderId: 'po-1',
    purchaseOrderRevisionId: 'rev-1',
    supplierId: 'sup-1',
    deliveryDate: '2026-08-10T00:00:00.000Z',
    deliveryNoteRef: null,
    postedAt: status === 'POSTED' ? '2026-08-10T00:00:00.000Z' : null,
    postedBy: null,
    lines: [
      {
        id: `${id}-l1`,
        lineNumber: 1,
        purchaseOrderLineId: 'pol-1',
        lineType: 'MATERIAL',
        orderedQuantity: '285',
        previouslyReceivedQty: '0',
        receivedQuantity: accepted,
        acceptedQuantity: accepted,
        rejectedQuantity: '0',
        rejectionReason: null,
        qualityStatus: 'ACCEPTED',
        notes: null,
        materialId: 'mat-1',
        material: { code: 'CEM-50', name: 'Cement 50kg' },
        uom: { code: 'BAG', symbol: 'bag' },
      },
    ],
  };
}

describe('activeRevision', () => {
  it('returns the ACTIVE revision', () => {
    expect(activeRevision(po())?.id).toBe('rev-1');
  });

  it('returns null when there is no ACTIVE revision', () => {
    const draftOnly = po({
      revisions: [{ ...po().revisions[0]!, status: 'DRAFT' }],
    });
    expect(activeRevision(draftOnly)).toBeNull();
  });

  it('returns null for an undefined PO', () => {
    expect(activeRevision(undefined)).toBeNull();
  });
});

describe('systemFinds', () => {
  it('summarises the PO and only its POSTED receipts, newest-first as given', () => {
    const found = systemFinds(po(), [
      grn('grn-1', 'GR-0081', 'POSTED', '185'),
      grn('grn-2', 'GR-0093', 'POSTED', '100'),
      grn('grn-3', 'GR-0100', 'DRAFT', '50'),
    ]);

    expect(found).not.toBeNull();
    expect(found!.poNumber).toBe('PO-0042');
    expect(found!.postedReceipts).toEqual([
      { id: 'grn-1', grnNumber: 'GR-0081', acceptedQuantity: 185 },
      { id: 'grn-2', grnNumber: 'GR-0093', acceptedQuantity: 100 },
    ]);
    expect(found!.noReceipts).toBe(false);
    expect(found!.poLines).toHaveLength(1);
  });

  it('flags a PO with an active revision but no posted receipt (two-way)', () => {
    const found = systemFinds(po(), [grn('grn-3', 'GR-0100', 'DRAFT', '50')]);
    expect(found!.noReceipts).toBe(true);
    expect(found!.postedReceipts).toEqual([]);
  });

  it('returns null when the PO has no active revision — not billable', () => {
    const draftOnly = po({ revisions: [{ ...po().revisions[0]!, status: 'DRAFT' }] });
    expect(systemFinds(draftOnly, [])).toBeNull();
  });

  it('returns null for an unresolved PO', () => {
    expect(systemFinds(undefined, [])).toBeNull();
  });
});

describe('poLineCostTargetLabel', () => {
  it('names the project and BOQ node for a project-cost line', () => {
    expect(poLineCostTargetLabel(poLine())).toBe('WBR-26-0065 · 03.10 Concrete');
  });

  it('returns null for an org/overhead line (no target)', () => {
    expect(
      poLineCostTargetLabel(poLine({ project: null, boqNode: null, projectId: null, boqNodeId: null })),
    ).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import {
  NO_PROJECT,
  addDays,
  billTotalsMinor,
  buildDirectBillPayload,
  buildPoBillPayload,
  directLineCostTarget,
  directLineErrors,
  dueDateFromTerms,
  emptyDirectLine,
  findDuplicateBill,
  normalizeInvoiceNumber,
  overBilling,
  poLineErrors,
  receivedByPoLine,
  seedPoLine,
  type DirectLineDraft,
  type PoLineDraft,
} from './bill-create';
import type { GoodsReceipt, PurchaseOrderLine, SupplierBill } from './types';

/**
 * The rules behind the one New bill page (ADR-037). Migrated from the two forms it replaced —
 * `bill-form.test.tsx` (non-PO) and `po-bill-form.test.tsx` (PO) — keeping every rule they
 * pinned, plus the new ones: duplicate numbers, due date from terms, over-billing notes.
 */

const HEADER = { supplierId: 'sup-1', invoiceNumber: ' INV-9044 ', billDate: '2026-09-01', dueDate: '2026-10-01' };

const DIRECT: DirectLineDraft = {
  key: 'l1',
  description: 'Office rent',
  expenseProfileCode: 'OFFICE_EXPENSE',
  quantity: '1',
  unitPrice: '400.00',
  vatAmount: '0',
  costLine: '',
};

const PO_LINE: PoLineDraft = {
  poLineId: 'pol-1',
  description: '50kg cement bags',
  unit: 'bag',
  ordered: '285',
  received: { acceptedMinor: 185_000, grnNumbers: ['GR-0081'] },
  quantity: '185',
  unitPrice: '10.00',
  vatAmount: '0',
  expenseProfileCode: 'MATERIAL_PURCHASE',
  costTargetLabel: null,
};

// ─── Direct lines (was billLineError) ─────────────────────────────────────────

describe('directLineErrors', () => {
  it('accepts a complete overhead line, including zero VAT', () => {
    expect(directLineErrors(DIRECT, NO_PROJECT)).toEqual({});
  });

  it('requires a description', () => {
    expect(directLineErrors({ ...DIRECT, description: '   ' }, NO_PROJECT)).toEqual({ description: 'description' });
  });

  /**
   * A4. `vatAmount` is `@IsNumber() @Min(0)` with no default. An empty field must not be sent
   * as 0: "no VAT" and "VAT not entered yet" are different facts on a document that posts to
   * the ledger, and only one of them is a decision the user made.
   */
  it('requires VAT to be typed, and accepts an explicit zero', () => {
    expect(directLineErrors({ ...DIRECT, vatAmount: '' }, NO_PROJECT)).toEqual({ vat: 'vat' });
    expect(directLineErrors({ ...DIRECT, vatAmount: '0' }, NO_PROJECT)).toEqual({});
  });

  it('rejects a negative or unparseable price rather than reading it as zero', () => {
    expect(directLineErrors({ ...DIRECT, unitPrice: '-5' }, NO_PROJECT)).toEqual({ unitPrice: 'unitPrice' });
    expect(directLineErrors({ ...DIRECT, unitPrice: 'abc' }, NO_PROJECT)).toEqual({ unitPrice: 'unitPrice' });
  });

  it('requires a positive quantity', () => {
    expect(directLineErrors({ ...DIRECT, quantity: '0' }, NO_PROJECT)).toEqual({ quantity: 'quantity' });
    expect(directLineErrors({ ...DIRECT, quantity: '' }, NO_PROJECT)).toEqual({ quantity: 'quantity' });
  });

  it('requires an expense profile', () => {
    expect(directLineErrors({ ...DIRECT, expenseProfileCode: '' }, NO_PROJECT)).toEqual({ profile: 'profile' });
  });

  it('reports every problem on the line at once, one per column', () => {
    expect(directLineErrors({ ...emptyDirectLine(), quantity: '' }, NO_PROJECT)).toEqual({
      description: 'description',
      profile: 'profile',
      quantity: 'quantity',
      unitPrice: 'unitPrice',
      vat: 'vat',
    });
  });

  /**
   * A direct bill is the only path where project cost coding is keyed by hand. A project named
   * without saying what it is spending on is the unclassified bucket the server refuses
   * (PROJECT_WITHOUT_COST_TARGET); a BOQ item or a project cost category each satisfy it.
   */
  it('requires a cost line on a project bill, and accepts either project attribution', () => {
    expect(directLineErrors(DIRECT, 'prj-1')).toEqual({ costLine: 'costLine' });
    expect(directLineErrors({ ...DIRECT, costLine: 'node:n1' }, 'prj-1')).toEqual({});
    expect(directLineErrors({ ...DIRECT, costLine: 'category:c1' }, 'prj-1')).toEqual({});
  });

  it('does not ask for a cost line on an overhead bill', () => {
    expect(directLineErrors(DIRECT, NO_PROJECT).costLine).toBeUndefined();
  });
});

describe('directLineCostTarget', () => {
  it('maps the three attributions onto the cost-target shape the server validates', () => {
    expect(directLineCostTarget(NO_PROJECT, '')).toEqual({
      notChargeable: true, projectId: null, boqNodeId: null, spendCategoryId: null,
    });
    expect(directLineCostTarget('prj-1', 'node:n1')).toMatchObject({ projectId: 'prj-1', boqNodeId: 'n1', spendCategoryId: null });
    expect(directLineCostTarget('prj-1', 'category:c1')).toMatchObject({ projectId: 'prj-1', boqNodeId: null, spendCategoryId: 'c1' });
  });
});

// ─── PO lines (was poBillLineError) ───────────────────────────────────────────

describe('poLineErrors', () => {
  it('accepts a complete PO-backed line', () => {
    expect(poLineErrors(PO_LINE)).toEqual({});
  });

  it('requires a positive quantity — it is what the match compares', () => {
    expect(poLineErrors({ ...PO_LINE, quantity: '0' })).toEqual({ quantity: 'quantity' });
    expect(poLineErrors({ ...PO_LINE, quantity: '' })).toEqual({ quantity: 'quantity' });
  });

  it('requires a unit price of zero or more', () => {
    expect(poLineErrors({ ...PO_LINE, unitPrice: '-1' })).toEqual({ unitPrice: 'unitPrice' });
    expect(poLineErrors({ ...PO_LINE, unitPrice: '' })).toEqual({ unitPrice: 'unitPrice' });
  });

  it('requires VAT to be typed, accepting an explicit zero', () => {
    expect(poLineErrors({ ...PO_LINE, vatAmount: '' })).toEqual({ vat: 'vat' });
    expect(poLineErrors({ ...PO_LINE, vatAmount: '0' })).toEqual({});
  });

  it('requires an expense profile', () => {
    expect(poLineErrors({ ...PO_LINE, expenseProfileCode: '' })).toEqual({ profile: 'profile' });
  });
});

// ─── Totals (was billTotalMinor / poBillTotalMinor) ───────────────────────────

describe('billTotalsMinor', () => {
  it('sums quantity × price as the subtotal, plus VAT, in minor units', () => {
    // 285 × 10.00 = 2850.00; 4 × 25.00 = 100.00 → subtotal 2950.00; VAT 5.00 → 2955.00.
    expect(
      billTotalsMinor([
        { quantity: '285', unitPrice: '10.00', vatAmount: '0' },
        { quantity: '4', unitPrice: '25.00', vatAmount: '5.00' },
      ]),
    ).toEqual({ subtotal: 295000, vat: 500, total: 295500 });
  });

  it('treats an empty line as zero rather than NaN', () => {
    expect(billTotalsMinor([{ ...emptyDirectLine(), quantity: '' }])).toEqual({ subtotal: 0, vat: 0, total: 0 });
  });

  it('carries the quantity scale change correctly (3dp × 2dp → 2dp)', () => {
    expect(billTotalsMinor([{ quantity: '2.5', unitPrice: '3.33', vatAmount: '0' }]).subtotal).toBe(833);
  });
});

// ─── Duplicate supplier invoice numbers ───────────────────────────────────────

describe('normalizeInvoiceNumber / findDuplicateBill', () => {
  const bill = (over: Partial<SupplierBill>) =>
    ({ id: 'b1', billNumber: 'BILL-2026-0042', supplierId: 'sup-1', supplierInvoiceNumber: 'BCC/INV/5531', ...over }) as SupplierBill;

  it('normalises exactly like the server: trim, upper-case, strip all but A–Z and 0–9', () => {
    expect(normalizeInvoiceNumber('  bcc/inv-5531 ')).toBe('BCCINV5531');
  });

  it('finds the supplier bill holding the same normalised number', () => {
    expect(findDuplicateBill([bill({})], 'sup-1', 'bcc inv 5531')?.billNumber).toBe('BILL-2026-0042');
  });

  it("ignores another supplier's bill and an empty number", () => {
    expect(findDuplicateBill([bill({ supplierId: 'sup-2' })], 'sup-1', 'BCC/INV/5531')).toBeNull();
    expect(findDuplicateBill([bill({})], 'sup-1', ' / ')).toBeNull();
  });
});

// ─── Due date from payment terms ──────────────────────────────────────────────

describe('dueDateFromTerms', () => {
  it('adds the supplier terms to the bill date, across a month end', () => {
    expect(dueDateFromTerms('2026-09-15', 30)).toBe('2026-10-15');
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('treats Net 0 as due on the bill date', () => {
    expect(dueDateFromTerms('2026-09-15', 0)).toBe('2026-09-15');
  });

  it('gives nothing when the supplier has no terms or there is no bill date', () => {
    expect(dueDateFromTerms('2026-09-15', null)).toBeNull();
    expect(dueDateFromTerms('', 30)).toBeNull();
  });
});

// ─── PO seeding, received quantities, over-billing ────────────────────────────

const POL: PurchaseOrderLine = {
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
} as PurchaseOrderLine;

const receipt = (id: string, status: GoodsReceipt['status'], accepted: string) =>
  ({
    id,
    grnNumber: id.toUpperCase(),
    status,
    lines: [{ purchaseOrderLineId: 'pol-1', acceptedQuantity: accepted }],
  }) as unknown as GoodsReceipt;

describe('receivedByPoLine', () => {
  it('sums accepted quantity from POSTED receipts only, naming each receipt', () => {
    const byLine = receivedByPoLine([
      receipt('gr-0081', 'POSTED', '185'),
      receipt('gr-0093', 'POSTED', '100.5'),
      receipt('gr-0099', 'DRAFT', '999'),
    ]);
    expect(byLine.get('pol-1')).toEqual({ acceptedMinor: 285_500, grnNumbers: ['GR-0081', 'GR-0093'] });
  });
});

describe('seedPoLine', () => {
  it('prefills billed quantity and price from the order, and carries the inherited cost target', () => {
    const line = seedPoLine(POL, new Map(), true);
    expect(line).toMatchObject({
      poLineId: 'pol-1',
      quantity: '285',
      unitPrice: '10.00',
      unit: 'bag',
      vatAmount: '',
      expenseProfileCode: '',
      costTargetLabel: 'WBR-26-0065 · 03.10 Concrete',
      received: { acceptedMinor: 0, grnNumbers: [] },
    });
  });

  it('has no received figure on a two-way (no receipts) match', () => {
    expect(seedPoLine(POL, new Map(), false).received).toBeNull();
  });
});

describe('overBilling', () => {
  it('flags billing beyond what was received, naming the receipts', () => {
    expect(overBilling({ ...PO_LINE, quantity: '205' })).toEqual({
      kind: 'received',
      excessMinor: 20_000,
      grnNumbers: ['GR-0081'],
    });
  });

  it('is quiet when billing within what was received', () => {
    expect(overBilling({ ...PO_LINE, quantity: '185' })).toBeNull();
  });

  it('compares with the order on a two-way match', () => {
    expect(overBilling({ ...PO_LINE, received: null, quantity: '300' })).toEqual({ kind: 'ordered', excessMinor: 15_000 });
    expect(overBilling({ ...PO_LINE, received: null, quantity: '285' })).toBeNull();
  });
});

// ─── Payloads ─────────────────────────────────────────────────────────────────

describe('buildPoBillPayload', () => {
  it('sends the PO, the billed figures and the computed net — and no cost coding (D7)', () => {
    const payload = buildPoBillPayload(HEADER, 'po-1', [{ ...PO_LINE, vatAmount: '12.50' }]);
    expect(payload).toEqual({
      supplierId: 'sup-1',
      purchaseOrderId: 'po-1',
      supplierInvoiceNumber: 'INV-9044',
      billDate: '2026-09-01',
      dueDate: '2026-10-01',
      currencyCode: 'USD',
      lines: [
        {
          description: '50kg cement bags',
          quantity: 185,
          unitPrice: 10,
          netAmount: 1850,
          vatAmount: 12.5,
          expenseProfileCode: 'MATERIAL_PURCHASE',
        },
      ],
    });
  });
});

describe('buildDirectBillPayload', () => {
  it('sends no project for an overhead bill', () => {
    const payload = buildDirectBillPayload(HEADER, NO_PROJECT, [DIRECT]);
    expect(payload).not.toHaveProperty('projectId');
    expect(payload).not.toHaveProperty('purchaseOrderId');
    expect(payload.lines[0]).toEqual({
      description: 'Office rent',
      quantity: 1,
      unitPrice: 400,
      netAmount: 400,
      vatAmount: 0,
      expenseProfileCode: 'OFFICE_EXPENSE',
    });
  });

  it('sends the bill project and each line target for a project bill', () => {
    const payload = buildDirectBillPayload(HEADER, 'prj-1', [
      { ...DIRECT, costLine: 'node:n1' },
      { ...DIRECT, key: 'l2', costLine: 'category:c1' },
    ]);
    expect(payload.projectId).toBe('prj-1');
    expect(payload.lines[0]).toMatchObject({ projectId: 'prj-1', boqNodeId: 'n1' });
    expect(payload.lines[0]).not.toHaveProperty('spendCategoryId');
    expect(payload.lines[1]).toMatchObject({ projectId: 'prj-1', spendCategoryId: 'c1' });
    expect(payload.lines[1]).not.toHaveProperty('boqNodeId');
  });
});

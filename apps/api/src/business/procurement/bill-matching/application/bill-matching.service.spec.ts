import { Decimal } from '@prisma/client/runtime/library';

import { BillMatchingService } from './bill-matching.service.js';

/**
 * ADR-018 — the control must hold. These unit tests drive the engine's verdict logic with a mocked
 * repository and assert: per-dimension flags (CONST-MATCH-003), the derived overall verdict and
 * EXCEPTION status for out-of-tolerance (CONST-MATCH-004), three-way quantity judged against
 * received (CONST-MATCH-005), and cumulative matching across bills (CONST-MATCH-006).
 */
const identity = { userId: 'u1', activeOrganizationId: 'o1' } as never;

function build(over: {
  billLines: Array<{ id: string; quantity: string; unitPrice: string; lineType: string; materialId?: string }>;
  poLines: Array<{ id: string; orderedQuantity: string; unitPrice: string; materialId?: string }>;
  policy?: Record<string, unknown> | null;
  received?: string | null; // cumulative received for the (single) po line
  priorBilled?: string | null; // cumulative billed on other bills for the po line
}) {
  let capturedLines: Array<Record<string, Decimal | boolean | string | undefined>> = [];
  let capturedStatus = '';
  const repo = {
    findBillForMatching: jest.fn().mockResolvedValue({
      id: 'bill1',
      postingStatus: 'NOT_POSTED',
      purchaseOrderRevisionId: 'rev1',
      lines: over.billLines.map((l, i) => ({
        id: l.id,
        lineNumber: i + 1,
        quantity: new Decimal(l.quantity),
        unitPrice: new Decimal(l.unitPrice),
        lineType: l.lineType,
        materialId: l.materialId,
      })),
    }),
    findPoRevisionForMatching: jest.fn().mockResolvedValue({
      purchaseOrderId: 'po1',
      lines: over.poLines.map((l) => ({
        id: l.id,
        orderedQuantity: new Decimal(l.orderedQuantity),
        unitPrice: new Decimal(l.unitPrice),
        materialId: l.materialId,
      })),
    }),
    findPoTolerancePolicy: jest.fn().mockResolvedValue(null),
    findOrgTolerancePolicy: jest.fn().mockResolvedValue(over.policy ?? null),
    findGrnLineForPoLine: jest.fn().mockResolvedValue(over.received != null ? { id: 'grn-l1' } : null),
    sumReceivedForPoLine: jest.fn().mockResolvedValue(over.received != null ? new Decimal(over.received) : null),
    sumBilledForPoLineExcludingBill: jest
      .fn()
      .mockResolvedValue(over.priorBilled != null ? new Decimal(over.priorBilled) : null),
    createOrReplace: jest.fn().mockImplementation((_p, _b, _t, lines) => {
      capturedLines = lines;
      return Promise.resolve({});
    }),
    updateStatus: jest.fn().mockImplementation((_p, _b, status) => {
      capturedStatus = status;
      return Promise.resolve({});
    }),
    updateBillMatchStatus: jest.fn().mockResolvedValue({}),
    findByBillId: jest.fn().mockImplementation(() => Promise.resolve({ status: capturedStatus, lines: capturedLines })),
  };
  const tenancy = { getClient: () => ({}) } as never;
  const svc = new BillMatchingService(tenancy, repo as never);
  return { svc, line: () => capturedLines[0], status: () => capturedStatus };
}

const pctPolicy = (price: string, qty: string) => ({ priceVariancePercent: price, quantityVariancePercent: qty });

describe('BillMatchingService.runMatching — ADR-018 control', () => {
  it('exact two-way match → MATCHED, all dimensions within tolerance', async () => {
    const { svc, line, status } = build({
      billLines: [{ id: 'bl1', quantity: '100', unitPrice: '500', lineType: 'SERVICE' }],
      poLines: [{ id: 'pl1', orderedQuantity: '100', unitPrice: '500' }],
      policy: pctPolicy('5', '5'),
    });
    await svc.runMatching(identity, 'bill1');
    expect(status()).toBe('MATCHED');
    expect(line().priceWithinTolerance).toBe(true);
    expect(line().quantityWithinTolerance).toBe(true);
    expect(line().withinTolerance).toBe(true);
  });

  it('within-tolerance non-zero variance → MATCHED_WITH_TOLERANCE', async () => {
    const { svc, status } = build({
      billLines: [{ id: 'bl1', quantity: '100', unitPrice: '510', lineType: 'SERVICE' }],
      poLines: [{ id: 'pl1', orderedQuantity: '100', unitPrice: '500' }],
      policy: pctPolicy('5', '5'), // 2% price variance, within 5%
    });
    await svc.runMatching(identity, 'bill1');
    expect(status()).toBe('MATCHED_WITH_TOLERANCE');
  });

  it('price out of tolerance → EXCEPTION with priceWithinTolerance=false', async () => {
    const { svc, line, status } = build({
      billLines: [{ id: 'bl1', quantity: '100', unitPrice: '600', lineType: 'SERVICE' }],
      poLines: [{ id: 'pl1', orderedQuantity: '100', unitPrice: '500' }], // 20% price variance
      policy: pctPolicy('5', '5'),
    });
    await svc.runMatching(identity, 'bill1');
    expect(status()).toBe('EXCEPTION');
    expect(line().priceWithinTolerance).toBe(false);
    expect(line().withinTolerance).toBe(false);
  });

  it('three-way: billing more than received → quantity EXCEPTION (CONST-MATCH-005)', async () => {
    const { svc, line, status } = build({
      billLines: [{ id: 'bl1', quantity: '100', unitPrice: '500', lineType: 'MATERIAL', materialId: 'm1' }],
      poLines: [{ id: 'pl1', orderedQuantity: '100', unitPrice: '500', materialId: 'm1' }],
      received: '80', // only 80 received, billing 100
      policy: pctPolicy('5', '5'),
    });
    await svc.runMatching(identity, 'bill1');
    expect(status()).toBe('EXCEPTION');
    expect(line().quantityWithinTolerance).toBe(false);
  });

  it('three-way: billing within received → quantity within tolerance', async () => {
    const { svc, line } = build({
      billLines: [{ id: 'bl1', quantity: '80', unitPrice: '500', lineType: 'MATERIAL', materialId: 'm1' }],
      poLines: [{ id: 'pl1', orderedQuantity: '100', unitPrice: '500', materialId: 'm1' }],
      received: '80',
      policy: pctPolicy('5', '5'),
    });
    await svc.runMatching(identity, 'bill1');
    expect(line().quantityWithinTolerance).toBe(true);
  });

  it('cumulative: prior bills already consumed the quantity → EXCEPTION (CONST-MATCH-006)', async () => {
    const { svc, line, status } = build({
      billLines: [{ id: 'bl1', quantity: '60', unitPrice: '500', lineType: 'SERVICE' }],
      poLines: [{ id: 'pl1', orderedQuantity: '100', unitPrice: '500' }],
      priorBilled: '80', // 80 already billed on other bills; 80 + 60 = 140 > 100
      policy: pctPolicy('5', '5'),
    });
    await svc.runMatching(identity, 'bill1');
    expect(status()).toBe('EXCEPTION');
    expect(line().quantityWithinTolerance).toBe(false);
  });

  it('amount tolerance breach → EXCEPTION (CONST-MATCH-003 amount dimension)', async () => {
    const { svc, line, status } = build({
      billLines: [{ id: 'bl1', quantity: '100', unitPrice: '501', lineType: 'SERVICE' }],
      poLines: [{ id: 'pl1', orderedQuantity: '100', unitPrice: '500' }],
      // price 0.2% within pct tolerance, but amount variance 100 exceeds a $50 absolute limit
      policy: { priceVariancePercent: '5', quantityVariancePercent: '5', amountVarianceAbsolute: '50' },
    });
    await svc.runMatching(identity, 'bill1');
    expect(status()).toBe('EXCEPTION');
    expect(line().amountWithinTolerance).toBe(false);
    expect(line().priceWithinTolerance).toBe(true);
  });
});

import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { BillMatchingService } from './bill-matching.service.js';

/**
 * ADR-018 — the control must hold. These unit tests drive the engine's verdict logic with a mocked
 * repository and assert: per-dimension flags (CONST-MATCH-003), the derived overall verdict and
 * EXCEPTION status for out-of-tolerance (CONST-MATCH-004), three-way quantity judged against
 * received (CONST-MATCH-005), and cumulative matching across bills (CONST-MATCH-006).
 */
const identity = { userId: 'u1', activeOrganizationId: 'o1', roles: ['CFO'], permissions: [] } as never;

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
      purchaseOrderId: 'po1',
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
    findActivePoRevisionForPo: jest.fn().mockResolvedValue({
      id: 'rev1', // same as the bill's revision → no re-point
      purchaseOrderId: 'po1',
      lines: over.poLines.map((l) => ({
        id: l.id,
        orderedQuantity: new Decimal(l.orderedQuantity),
        unitPrice: new Decimal(l.unitPrice),
        materialId: l.materialId,
      })),
    }),
    repointBillToRevision: jest.fn().mockResolvedValue({}),
    findPoTolerancePolicy: jest.fn().mockResolvedValue(null),
    findOrgTolerancePolicy: jest.fn().mockResolvedValue(over.policy ?? null),
    findGrnLineForPoLine: jest.fn().mockResolvedValue(over.received != null ? { id: 'grn-l1' } : null),
    findGrnLineForPoMaterial: jest.fn().mockResolvedValue(over.received != null ? { id: 'grn-l1' } : null),
    sumReceivedForPoLine: jest.fn().mockResolvedValue(over.received != null ? new Decimal(over.received) : null),
    sumReceivedForPoMaterial: jest.fn().mockResolvedValue(over.received != null ? new Decimal(over.received) : null),
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

  it('Phase 2b: re-matches against the current active revision and re-points the bill (CONST-MATCH-010)', async () => {
    let captured = '';
    const repo = {
      findBillForMatching: jest.fn().mockResolvedValue({
        id: 'bill1',
        postingStatus: 'NOT_POSTED',
        purchaseOrderId: 'po1',
        purchaseOrderRevisionId: 'rev1', // bill was created against rev1 (old price 500)
        lines: [{ id: 'bl1', lineNumber: 1, quantity: new Decimal('100'), unitPrice: new Decimal('600'), lineType: 'SERVICE' }],
      }),
      // An approved revision rev2 raised the agreed price to 600 — the bill now matches exactly.
      findActivePoRevisionForPo: jest.fn().mockResolvedValue({
        id: 'rev2',
        purchaseOrderId: 'po1',
        lines: [{ id: 'pl2', orderedQuantity: new Decimal('100'), unitPrice: new Decimal('600') }],
      }),
      repointBillToRevision: jest.fn().mockResolvedValue({}),
      findPoTolerancePolicy: jest.fn().mockResolvedValue(null),
      findOrgTolerancePolicy: jest.fn().mockResolvedValue({ priceVariancePercent: '5', quantityVariancePercent: '5' }),
      findGrnLineForPoLine: jest.fn(),
      findGrnLineForPoMaterial: jest.fn(),
      sumReceivedForPoLine: jest.fn().mockResolvedValue(null),
      sumReceivedForPoMaterial: jest.fn().mockResolvedValue(null),
      sumBilledForPoLineExcludingBill: jest.fn().mockResolvedValue(null),
      createOrReplace: jest.fn().mockResolvedValue({}),
      updateStatus: jest.fn().mockResolvedValue({}),
      updateBillMatchStatus: jest.fn().mockImplementation((_p, _b, s) => {
        captured = s;
        return Promise.resolve({});
      }),
      findByBillId: jest.fn().mockResolvedValue({}),
    };
    const svc = new BillMatchingService({ getClient: () => ({}) } as never, repo as never);

    await svc.runMatching(identity, 'bill1');

    // The bill is re-pointed from rev1 to the active rev2, and now matches (price 600 = 600).
    expect(repo.repointBillToRevision).toHaveBeenCalledWith(expect.anything(), 'bill1', 'rev2');
    expect(captured).toBe('MATCHED');
  });
});

describe('BillMatchingService.runMatching — ADR-018/ADR-024 item D tolerances', () => {
  // No policy → runs on the platform fallback (price 2% / qty 0%). These assert the fallback numbers
  // and the per-invoice USD-5 rounding absorb, including the interaction with a quantity over-bill.

  it('2a — small price rounding, bill total ≤ $5, qty exact → MATCHED_WITH_TOLERANCE (absorbed)', async () => {
    // 3 units, PO $100, billed $101 → price 1% (within 2% fallback → not even a line exception).
    // To exercise the ABSORB, push price just over 2% but keep total variance ≤ $5:
    // 1 unit, PO $100, billed $103 → price 3% > 2% (line exception), total amount variance $3 ≤ $5.
    const { svc, line, status } = build({
      billLines: [{ id: 'bl1', quantity: '1', unitPrice: '103', lineType: 'SERVICE' }],
      poLines: [{ id: 'pl1', orderedQuantity: '1', unitPrice: '100' }],
      // no policy → fallback 2% / 0%
    });
    await svc.runMatching(identity, 'bill1');
    expect(line().priceWithinTolerance).toBe(false); // 3% > 2% — line is out of tolerance
    expect(line().quantityWithinTolerance).toBe(true); // no over-bill
    expect(status()).toBe('MATCHED_WITH_TOLERANCE'); // absorbed by the per-invoice $5
  });

  it('2b — price > 2% and total amount variance > $5 → EXCEPTION (not absorbed)', async () => {
    // 10 units, PO $100, billed $110 → price 10% > 2%, total amount variance $100 > $5.
    const { svc, line, status } = build({
      billLines: [{ id: 'bl1', quantity: '10', unitPrice: '110', lineType: 'SERVICE' }],
      poLines: [{ id: 'pl1', orderedQuantity: '10', unitPrice: '100' }],
    });
    await svc.runMatching(identity, 'bill1');
    expect(line().priceWithinTolerance).toBe(false);
    expect(status()).toBe('EXCEPTION');
  });

  it('2c — quantity over-bill is NEVER absorbed by the $5, even for a tiny dollar amount → EXCEPTION', async () => {
    // Three-way: received 5, billed 6 at PO price $1 → qty over-bill (0% fallback tolerates none),
    // total amount variance only $1 (≤ $5) — must still be an EXCEPTION (accepted-quantity only).
    const { svc, line, status } = build({
      billLines: [{ id: 'bl1', quantity: '6', unitPrice: '1', lineType: 'MATERIAL', materialId: 'm1' }],
      poLines: [{ id: 'pl1', orderedQuantity: '10', unitPrice: '1', materialId: 'm1' }],
      received: '5',
    });
    await svc.runMatching(identity, 'bill1');
    expect(line().quantityWithinTolerance).toBe(false);
    expect(status()).toBe('EXCEPTION'); // $1 ≤ $5 but a qty over-bill is never absorbed
  });

  it('2d — exact match on the fallback → MATCHED', async () => {
    const { svc, line, status } = build({
      billLines: [{ id: 'bl1', quantity: '10', unitPrice: '100', lineType: 'SERVICE' }],
      poLines: [{ id: 'pl1', orderedQuantity: '10', unitPrice: '100' }],
    });
    await svc.runMatching(identity, 'bill1');
    expect(line().withinTolerance).toBe(true);
    expect(status()).toBe('MATCHED');
  });

  it('fallback price 2% exactly clears; 0% qty tolerates no over-bill', async () => {
    // Price exactly 2% (billed $102 vs $100) → within; three-way received == billed → qty exact.
    const { svc, line, status } = build({
      billLines: [{ id: 'bl1', quantity: '5', unitPrice: '102', lineType: 'MATERIAL', materialId: 'm1' }],
      poLines: [{ id: 'pl1', orderedQuantity: '5', unitPrice: '100', materialId: 'm1' }],
      received: '5',
    });
    await svc.runMatching(identity, 'bill1');
    expect(line().priceWithinTolerance).toBe(true); // 2% == 2% fallback
    expect(line().quantityWithinTolerance).toBe(true);
    expect(status()).toBe('MATCHED_WITH_TOLERANCE'); // tolerated non-zero price variance
  });
});

describe('BillMatchingService exception-approval authority — ADR-018/ADR-024 item D (FM ≤ $1,000, CFO above)', () => {
  function buildApprove(over: { status?: string; billTotal: string }) {
    const repo = {
      findByBillId: jest.fn().mockResolvedValue({ status: over.status ?? 'EXCEPTION' }),
      findBillTotal: jest.fn().mockResolvedValue(new Decimal(over.billTotal)),
      updateStatus: jest.fn().mockResolvedValue({}),
      updateBillMatchStatus: jest.fn().mockResolvedValue({}),
    };
    const svc = new BillMatchingService({ getClient: () => ({}) } as never, repo as never);
    return { svc, repo };
  }
  const fmIdentity = { userId: 'u1', activeOrganizationId: 'o1', roles: ['FINANCE_OFFICER'], permissions: [] } as never;
  const cfoIdentity = { userId: 'u2', activeOrganizationId: 'o1', roles: ['CFO'], permissions: [] } as never;

  it('FM approves an exception ≤ $1,000 → allowed', async () => {
    const { svc, repo } = buildApprove({ billTotal: '1000' });
    await svc.approveException(fmIdentity, 'bill1', { approvalReason: 'rounding' });
    expect(repo.updateBillMatchStatus).toHaveBeenCalledWith(expect.anything(), 'bill1', 'APPROVED_EXCEPTION');
  });

  it('FM approving an exception > $1,000 → ForbiddenException (requires CFO)', async () => {
    const { svc, repo } = buildApprove({ billTotal: '1000.01' });
    await expect(
      svc.approveException(fmIdentity, 'bill1', { approvalReason: 'rounding' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.updateBillMatchStatus).not.toHaveBeenCalled();
  });

  it('CFO approves an exception > $1,000 → allowed', async () => {
    const { svc, repo } = buildApprove({ billTotal: '25000' });
    await svc.approveException(cfoIdentity, 'bill1', { approvalReason: 'CFO signed off' });
    expect(repo.updateBillMatchStatus).toHaveBeenCalledWith(expect.anything(), 'bill1', 'APPROVED_EXCEPTION');
  });

  it('authority also gates resolveException on an APPROVE reason (FM > $1,000 → Forbidden)', async () => {
    const { svc } = buildApprove({ billTotal: '5000' });
    await expect(
      svc.resolveException(fmIdentity, 'bill1', { reason: 'ROUNDING_VARIANCE' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a DISPUTE reason carries no amount band — FM may dispute a > $1,000 bill', async () => {
    const { svc, repo } = buildApprove({ billTotal: '5000' });
    await svc.resolveException(fmIdentity, 'bill1', { reason: 'SUPPLIER_INVOICE_ERROR' } as never);
    expect(repo.updateBillMatchStatus).toHaveBeenCalledWith(expect.anything(), 'bill1', 'DISPUTED');
  });
});

describe('BillMatchingService.resolveException — ADR-018 CONST-MATCH-007/008/009', () => {
  function buildResolve(status = 'EXCEPTION') {
    let updated: Record<string, unknown> = {};
    const repo = {
      findByBillId: jest.fn().mockResolvedValue({ status }),
      findBillTotal: jest.fn().mockResolvedValue(new Decimal('500')), // ≤ $1,000, CFO identity → authorised
      updateStatus: jest.fn().mockImplementation((_p, _b, s, extra) => {
        updated = { status: s, ...extra };
        return Promise.resolve({});
      }),
      updateBillMatchStatus: jest.fn().mockResolvedValue({}),
    };
    const svc = new BillMatchingService({ getClient: () => ({}) } as never, repo as never);
    return { svc, repo, updated: () => updated };
  }

  it.each([
    ['ROUNDING_VARIANCE', 'APPROVE', 'APPROVED_EXCEPTION'],
    ['FREIGHT_OR_ADDITIONAL_CHARGE', 'APPROVE', 'APPROVED_EXCEPTION'],
    ['OTHER', 'APPROVE', 'APPROVED_EXCEPTION'],
    ['SUPPLIER_INVOICE_ERROR', 'DISPUTE', 'DISPUTED'],
    ['AGREED_PRICE_CHANGE', 'REQUIRE_PO_REVISION', 'EXCEPTION'],
    ['PO_QUANTITY_CHANGE', 'REQUIRE_PO_REVISION', 'EXCEPTION'],
    ['RECEIPT_CORRECTION', 'REQUIRE_RECEIPT_CORRECTION', 'EXCEPTION'],
  ])('reason %s routes to action %s and status %s', async (reason, action, expectedStatus) => {
    const { svc, repo, updated } = buildResolve();
    await svc.resolveException(identity, 'bill1', { reason } as never);
    expect(updated().status).toBe(expectedStatus);
    expect(updated().resolutionReason).toBe(reason);
    expect(updated().resolutionAction).toBe(action);
    expect(repo.updateBillMatchStatus).toHaveBeenCalledWith(expect.anything(), 'bill1', expectedStatus);
  });

  it('records the resolver and notes as the audit trail (CONST-MATCH-014)', async () => {
    const { svc, updated } = buildResolve();
    await svc.resolveException(identity, 'bill1', { reason: 'OTHER', notes: 'CFO agreed' } as never);
    expect(updated().approvedBy).toBe('u1');
    expect(updated().approvedAt).toBeInstanceOf(Date);
    expect(updated().resolutionNotes).toBe('CFO agreed');
  });

  it('rejects resolving anything that is not an EXCEPTION', async () => {
    const { svc } = buildResolve('MATCHED_WITH_TOLERANCE');
    await expect(
      svc.resolveException(identity, 'bill1', { reason: 'OTHER' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

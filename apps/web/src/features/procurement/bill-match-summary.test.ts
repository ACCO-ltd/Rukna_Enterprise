import { describe, expect, it } from 'vitest';

import { billMatchReconciliation } from './bill-match-summary';
import type { BillMatchLine, BillMatchResult } from './types';

/**
 * The "Matched" reconciliation (Slice ④, D6): PO applicable · Accepted receipts · Bill. The
 * healthy case has all three agree — the sketch's $2,850 / $2,850 / $2,850 — so the tests pin
 * the derivation exactly, including the two-way fallback where a line has no receipt.
 */

function line(overrides: Partial<BillMatchLine> = {}): BillMatchLine {
  return {
    id: 'ml-1',
    purchaseOrderLineId: 'pol-1',
    goodsReceiptLineId: 'grl-1',
    description: null,
    poQuantity: '285',
    receivedQuantity: '285',
    billedQuantity: '285',
    poUnitPrice: '10.00',
    billedUnitPrice: '10.00',
    quantityVariance: '0',
    priceVariance: '0.00',
    amountVariance: '0.00',
    quantityWithinTolerance: true,
    priceWithinTolerance: true,
    amountWithinTolerance: true,
    withinTolerance: true,
    exceptionReason: null,
    purchaseOrderLine: { lineNumber: 1, description: '50kg cement bags' },
    ...overrides,
  };
}

function result(lines: BillMatchLine[]): BillMatchResult {
  return {
    id: 'match-1',
    supplierBillId: 'bill-1',
    matchType: 'THREE_WAY',
    status: 'MATCHED',
    matchedAt: null,
    matchedBy: null,
    approvalReason: null,
    approvedBy: null,
    approvedAt: null,
    lines,
  };
}

describe('billMatchReconciliation', () => {
  it('computes PO applicable and accepted receipts equal to the bill on a clean match', () => {
    const recon = billMatchReconciliation(result([line()]));
    expect(recon.poApplicable).toBe('2850.00');
    expect(recon.acceptedReceipts).toBe('2850.00');
  });

  it('sums across lines', () => {
    const recon = billMatchReconciliation(
      result([
        line({ id: 'a', poQuantity: '100', poUnitPrice: '10.00', receivedQuantity: '100' }),
        line({ id: 'b', poQuantity: '50', poUnitPrice: '20.00', receivedQuantity: '50' }),
      ]),
    );
    // 100×10 + 50×20 = 1000 + 1000 = 2000
    expect(recon.poApplicable).toBe('2000.00');
    expect(recon.acceptedReceipts).toBe('2000.00');
  });

  it('reflects a short receipt: accepted receipts is below PO applicable', () => {
    const recon = billMatchReconciliation(result([line({ receivedQuantity: '270' })]));
    expect(recon.poApplicable).toBe('2850.00'); // 285 × 10
    expect(recon.acceptedReceipts).toBe('2700.00'); // 270 × 10
  });

  it('falls back to PO quantity when a line has no receipt (two-way match)', () => {
    const recon = billMatchReconciliation(result([line({ receivedQuantity: null })]));
    expect(recon.acceptedReceipts).toBe('2850.00');
  });

  it('handles fractional quantities without a cent drift', () => {
    const recon = billMatchReconciliation(
      result([line({ poQuantity: '2.5', poUnitPrice: '3.33', receivedQuantity: '2.5' })]),
    );
    // 2.5 × 3.33 = 8.325 → 8.33 (half-up)
    expect(recon.poApplicable).toBe('8.33');
  });
});

import { describe, expect, it } from 'vitest';

import {
  allocationSectionProblem,
  applyToBills,
  buildAllocations,
  prefillAmountMinor,
  rowProblem,
  totalAppliedMinor,
  unappliedMinor,
  type AllocationRowInput,
} from './payment-allocations';
import type { SupplierBill } from './types';

/**
 * The D9 allocate-on-create maths. Every case here is the client mirror of a rule
 * `SupplierPaymentService.create` enforces server-side (A16, commit eb826bb), plus the two prefill
 * conveniences the server does not — full-settlement prefill and the running unapplied balance.
 */

function bill(overrides: Partial<SupplierBill> = {}): SupplierBill {
  return {
    id: 'bill-1',
    billNumber: null,
    supplierId: 'sup-1',
    supplier: { id: 'sup-1', code: 'SUP-001', name: 'Al-Rashid Trading' },
    supplierInvoiceNumber: 'INV-9044',
    billDate: '2026-08-31',
    dueDate: '2026-09-30',
    currencyCode: 'USD',
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    matchStatus: 'NOT_RUN',
    purchaseOrderId: null,
    purchaseOrderRevisionId: null,
    projectId: null,
    subtotal: '2850.00',
    vatAmount: '0.00',
    totalAmount: '2850.00',
    outstandingAmount: '2850.00',
    ...overrides,
  };
}

// ─── applyToBills — the "Apply to bills" list ────────────────────────────────────

describe('applyToBills', () => {
  it('keeps only this supplier, this currency, POSTED, still-outstanding bills', () => {
    const bills = [
      bill({ id: 'keep', supplierInvoiceNumber: 'INV-1' }),
      bill({ id: 'other-supplier', supplierId: 'sup-2' }),
      bill({ id: 'other-currency', currencyCode: 'EUR' }),
      bill({ id: 'not-posted', postingStatus: 'NOT_POSTED' }),
      bill({ id: 'settled', outstandingAmount: '0.00' }),
    ];

    const result = applyToBills('sup-1', 'USD', bills);

    expect(result.map((b) => b.id)).toEqual(['keep']);
  });

  it('sorts oldest bill first', () => {
    const bills = [
      bill({ id: 'newest', billDate: '2026-08-31' }),
      bill({ id: 'oldest', billDate: '2026-08-10' }),
      bill({ id: 'middle', billDate: '2026-08-20' }),
    ];

    expect(applyToBills('sup-1', 'USD', bills).map((b) => b.id)).toEqual([
      'oldest',
      'middle',
      'newest',
    ]);
  });

  it('returns nothing when the supplier has no outstanding posted bills (pure advance)', () => {
    expect(applyToBills('sup-1', 'USD', [])).toEqual([]);
    expect(
      applyToBills('sup-1', 'USD', [bill({ postingStatus: 'NOT_POSTED' })]),
    ).toEqual([]);
  });
});

// ─── prefillAmountMinor — full-settlement prefill ────────────────────────────────

describe('prefillAmountMinor', () => {
  it('prefills full settlement when the payment can cover the bill', () => {
    // outstanding 2,850.00 · remaining 5,700.00 → prefill the whole 2,850.00
    expect(prefillAmountMinor(285000, 570000)).toBe(285000);
  });

  it('prefills only the remaining unallocated when the payment runs out first', () => {
    // outstanding 2,850.00 · remaining 1,400.00 → prefill the 1,400.00 partial
    expect(prefillAmountMinor(285000, 140000)).toBe(140000);
  });

  it('prefills 0 when nothing is left to apply', () => {
    expect(prefillAmountMinor(285000, 0)).toBe(0);
  });

  it('never returns a negative prefill', () => {
    expect(prefillAmountMinor(285000, -100)).toBe(0);
  });
});

// ─── totalAppliedMinor / unappliedMinor — the live footer ────────────────────────

describe('the Applied · Unapplied footer', () => {
  it('sums the checked rows across multiple bills', () => {
    // INV-9044 2,850 + INV-9051 2,850 checked; INV-9060 unchecked
    const applied = totalAppliedMinor([
      { checked: true, amountMinor: 285000 },
      { checked: true, amountMinor: 285000 },
      { checked: false, amountMinor: 140000 },
    ]);
    expect(applied).toBe(570000);
  });

  it('ignores unparseable in-progress edits so the footer never jumps', () => {
    expect(
      totalAppliedMinor([
        { checked: true, amountMinor: 285000 },
        { checked: true, amountMinor: null },
      ]),
    ).toBe(285000);
  });

  it('leaves the whole amount unapplied when nothing is checked (pure advance)', () => {
    const applied = totalAppliedMinor([{ checked: false, amountMinor: 285000 }]);
    expect(applied).toBe(0);
    expect(unappliedMinor(570000, applied)).toBe(570000);
  });

  it('computes unapplied as amount − applied, and shows the advance remainder', () => {
    // amount 5,700.00, applied 4,250.00 → 1,450.00 becomes a supplier advance
    expect(unappliedMinor(570000, 425000)).toBe(145000);
  });

  it('shows zero unapplied when the payment is fully allocated', () => {
    expect(unappliedMinor(570000, 570000)).toBe(0);
  });

  it('never reports a negative unapplied balance', () => {
    // over-application is a validation error, not a negative advance
    expect(unappliedMinor(570000, 600000)).toBe(0);
  });
});

// ─── rowProblem — per-bill apply ≤ outstanding ───────────────────────────────────

describe('rowProblem', () => {
  const base: AllocationRowInput = {
    billId: 'bill-1',
    checked: true,
    amountMinor: 285000,
    outstandingMinor: 285000,
  };

  it('accepts a checked row applying no more than the bill owes', () => {
    expect(rowProblem(base)).toBeNull();
    expect(rowProblem({ ...base, amountMinor: 140000 })).toBeNull(); // partial
  });

  it('flags a checked row that exceeds the bill outstanding', () => {
    expect(rowProblem({ ...base, amountMinor: 285001 })).toBe('exceeds-bill');
  });

  it('flags a checked row with an empty or non-positive amount', () => {
    expect(rowProblem({ ...base, amountMinor: null })).toBe('empty');
    expect(rowProblem({ ...base, amountMinor: 0 })).toBe('not-positive');
    expect(rowProblem({ ...base, amountMinor: -1 })).toBe('not-positive');
  });

  it('never flags an unchecked row, whatever it holds', () => {
    expect(rowProblem({ ...base, checked: false, amountMinor: 999999 })).toBeNull();
    expect(rowProblem({ ...base, checked: false, amountMinor: null })).toBeNull();
  });
});

// ─── allocationSectionProblem — Σ applied ≤ amount ───────────────────────────────

describe('allocationSectionProblem', () => {
  const rows = (
    ...specs: [checked: boolean, amountMinor: number | null, outstandingMinor: number][]
  ): AllocationRowInput[] =>
    specs.map(([checked, amountMinor, outstandingMinor], i) => ({
      billId: `bill-${i}`,
      checked,
      amountMinor,
      outstandingMinor,
    }));

  it('is valid when the checked bills sum to no more than the payment amount', () => {
    // 2,850 + 2,850 = 5,700 applied against a 5,700.00 payment
    expect(
      allocationSectionProblem(rows([true, 285000, 285000], [true, 285000, 285000]), 570000),
    ).toBeNull();
  });

  it('is valid for a pure advance (nothing checked)', () => {
    expect(allocationSectionProblem(rows([false, null, 285000]), 570000)).toBeNull();
  });

  it('is valid with an unapplied remainder (partial allocation of the payment)', () => {
    // apply 2,850 of a 5,700 payment; 2,850 stays as an advance
    expect(allocationSectionProblem(rows([true, 285000, 285000]), 570000)).toBeNull();
  });

  it('reports the total overrun when every row is individually valid', () => {
    // both rows fit their own bill, but together 5,700 > 5,000 payment
    expect(
      allocationSectionProblem(rows([true, 285000, 285000], [true, 285000, 285000]), 500000),
    ).toBe('exceeds-amount');
  });

  it('prefers the row error over the total error when a row overshoots its bill', () => {
    // the first row exceeds its own bill; fix that before worrying about the sum
    expect(
      allocationSectionProblem(rows([true, 300000, 285000], [true, 285000, 285000]), 500000),
    ).toBe('exceeds-bill');
  });
});

// ─── buildAllocations — the create payload array ─────────────────────────────────

describe('buildAllocations', () => {
  it('sends only checked rows carrying a positive amount, as JSON numbers', () => {
    const payload = buildAllocations([
      { billId: 'a', checked: true, amountMinor: 285000, outstandingMinor: 285000 },
      { billId: 'b', checked: true, amountMinor: 140000, outstandingMinor: 285000 },
      { billId: 'c', checked: false, amountMinor: 285000, outstandingMinor: 285000 },
    ]);

    expect(payload).toEqual([
      { supplierBillId: 'a', amount: 2850 },
      { supplierBillId: 'b', amount: 1400 },
    ]);
  });

  it('drops a checked row prefilled to 0 (the payment ran out before it)', () => {
    const payload = buildAllocations([
      { billId: 'a', checked: true, amountMinor: 570000, outstandingMinor: 570000 },
      { billId: 'b', checked: true, amountMinor: 0, outstandingMinor: 285000 },
    ]);

    expect(payload).toEqual([{ supplierBillId: 'a', amount: 5700 }]);
  });

  it('returns an empty array for a pure advance', () => {
    expect(
      buildAllocations([
        { billId: 'a', checked: false, amountMinor: 285000, outstandingMinor: 285000 },
      ]),
    ).toEqual([]);
  });
});

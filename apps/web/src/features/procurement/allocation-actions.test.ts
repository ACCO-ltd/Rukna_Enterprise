import { describe, expect, it } from 'vitest';

import type { Account } from '@/features/accounting/types';

import {
  allocatableBills,
  allocationAmountProblem,
  allocationBlockReason,
  canAllocate,
  maxAllocatable,
  planAllocation,
} from './allocation-actions';
import type { SupplierBill, SupplierPayment } from './types';

function account(id: string, code: string, name: string, subtype: string): Account {
  return {
    id,
    code,
    status: 'ACTIVE',
    versions: [
      {
        id: `${id}-v1`,
        versionNumber: 1,
        name,
        nameAr: null,
        accountClass: 'ASSET',
        accountSubtype: subtype,
        normalBalance: 'DEBIT',
        isPostingAllowed: true,
        isControlAccount: false,
        controlledSubledgerType: null,
        controlPostingPolicy: 'UNRESTRICTED',
        parentAccountId: null,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ],
  } as unknown as Account;
}

const AP = account('a-ap', '20000', 'Accounts Payable', 'ACCOUNTS_PAYABLE');
const ADVANCE = account('a-adv', '20100', 'Supplier Advance', 'SUPPLIER_ADVANCE');
const ACCOUNTS = [AP, ADVANCE];

function payment(overrides: Partial<SupplierPayment> = {}): SupplierPayment {
  return {
    id: 'pmt-1',
    paymentNumber: 'PMT-000001',
    supplierId: 'sup-1',
    bankAccountId: 'bank-1',
    paymentDate: '2026-08-01',
    accountingDate: '2026-08-01',
    currencyCode: 'USD',
    totalAmount: '5000.00',
    allocatedAmount: '0.00',
    unallocatedAmount: '5000.00',
    paymentMethod: 'BANK_TRANSFER',
    bankReference: null,
    notes: null,
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    postedJournalEntryId: 'je-1',
    ...overrides,
  };
}

function bill(overrides: Partial<SupplierBill> = {}): SupplierBill {
  return {
    id: 'bill-1',
    billNumber: 'BILL-000001',
    supplierId: 'sup-1',
    supplier: { id: 'sup-1', code: 'SUP-001', name: 'Al-Rashid Trading' },
    supplierInvoiceNumber: 'INV-100',
    billDate: '2026-07-01',
    dueDate: '2026-07-31',
    currencyCode: 'USD',
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    matchStatus: 'NOT_RUN',
    purchaseOrderId: null,
    purchaseOrderRevisionId: null,
    projectId: null,
    subtotal: '3000.00',
    vatAmount: '0.00',
    totalAmount: '3000.00',
    outstandingAmount: '3000.00',
    ...overrides,
  };
}

describe('allocatableBills', () => {
  it('offers a posted, outstanding, same-supplier, same-currency bill', () => {
    expect(allocatableBills(payment(), [bill()]).map((b) => b.id)).toEqual(['bill-1']);
  });

  it('excludes an unposted bill, which has no AP balance to clear', () => {
    expect(allocatableBills(payment(), [bill({ postingStatus: 'NOT_POSTED' })])).toEqual([]);
  });

  it('excludes a fully settled bill', () => {
    expect(allocatableBills(payment(), [bill({ outstandingAmount: '0.00' })])).toEqual([]);
  });

  /**
   * A18 / #36. The server checks only that the bill exists and is POSTED, so an advance paid
   * to supplier A can settle supplier B's bill — the journal carries A's supplierId while B's
   * bill is decremented. Both subledgers end up wrong and the trial balance still ties.
   *
   * This filter is an affordance, not a control. The server guard is still required.
   */
  it('excludes another supplier’s bill, which the server would accept', () => {
    const otherSupplier = bill({ id: 'bill-2', supplierId: 'sup-2' });

    expect(allocatableBills(payment(), [otherSupplier])).toEqual([]);
  });

  /** A18 / #36, second half — no conversion happens, so 5,000 USD would clear 5,000 SAR. */
  it('excludes a bill in another currency, which the server would also accept', () => {
    const otherCurrency = bill({ id: 'bill-3', currencyCode: 'SAR' });

    expect(allocatableBills(payment(), [otherCurrency])).toEqual([]);
  });

  it('sorts oldest first, which is the order a clerk settles in', () => {
    const older = bill({ id: 'old', billDate: '2026-05-01' });
    const newer = bill({ id: 'new', billDate: '2026-09-01' });

    expect(allocatableBills(payment(), [newer, bill(), older]).map((b) => b.id)).toEqual([
      'old',
      'bill-1',
      'new',
    ]);
  });
});

describe('canAllocate and allocationBlockReason', () => {
  it('requires the payment to be posted', () => {
    expect(canAllocate(payment({ postingStatus: 'NOT_POSTED' }))).toBe(false);
    expect(allocationBlockReason(payment({ postingStatus: 'NOT_POSTED' }), 1)).toBe(
      'payment-not-posted',
    );
  });

  it('requires something to still be unallocated', () => {
    const spent = payment({ allocatedAmount: '5000.00', unallocatedAmount: '0.00' });

    expect(canAllocate(spent)).toBe(false);
    expect(allocationBlockReason(spent, 1)).toBe('nothing-unallocated');
  });

  it('reports when there is nothing eligible to settle', () => {
    expect(allocationBlockReason(payment(), 0)).toBe('no-eligible-bills');
  });

  it('is unblocked when the payment is posted, funded and has a target', () => {
    expect(canAllocate(payment())).toBe(true);
    expect(allocationBlockReason(payment(), 1)).toBeNull();
  });
});

describe('maxAllocatable', () => {
  it('stops at the bill when the bill is smaller', () => {
    expect(maxAllocatable(payment(), bill({ outstandingAmount: '3000.00' }))).toBe(300000);
  });

  it('stops at the advance when the advance is smaller', () => {
    const small = payment({ unallocatedAmount: '1000.00' });

    expect(maxAllocatable(small, bill({ outstandingAmount: '3000.00' }))).toBe(100000);
  });
});

describe('allocationAmountProblem', () => {
  it('accepts an amount within both ceilings', () => {
    expect(allocationAmountProblem(100000, payment(), bill())).toBeNull();
  });

  it('rejects an empty or non-positive amount rather than reading it as zero', () => {
    expect(allocationAmountProblem(null, payment(), bill())).toBe('empty');
    expect(allocationAmountProblem(0, payment(), bill())).toBe('not-positive');
    expect(allocationAmountProblem(-500, payment(), bill())).toBe('not-positive');
  });

  it('names which ceiling was crossed, because the fix differs', () => {
    const small = payment({ unallocatedAmount: '100.00' });
    expect(allocationAmountProblem(50000, small, bill())).toBe('exceeds-unallocated');

    const settled = bill({ outstandingAmount: '100.00' });
    expect(allocationAmountProblem(50000, payment(), settled)).toBe('exceeds-bill');
  });

  /**
   * The server decrements `outstandingAmount` straight through with no floor, so an
   * over-allocation drives a bill negative and it reports the supplier owing money back.
   * Nothing on the server refuses this.
   */
  it('refuses to over-allocate past the bill, which the server would not', () => {
    expect(allocationAmountProblem(300001, payment(), bill({ outstandingAmount: '3000.00' }))).toBe(
      'exceeds-bill',
    );
  });
});

describe('planAllocation', () => {
  it('writes Dr Accounts Payable / Cr Supplier Advance for the same figure', () => {
    const result = planAllocation(150000, 'bill-1', 'en', ACCOUNTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.lines).toEqual([
      { accountCode: '20000', accountName: 'Accounts Payable', debit: '1500.00', credit: null },
      { accountCode: '20100', accountName: 'Supplier Advance', debit: null, credit: '1500.00' },
    ]);
  });

  it('sends the amount as a JSON number, not a decimal string', () => {
    const result = planAllocation(150000, 'bill-1', 'en', ACCOUNTS);
    if (!result.ok) return;

    expect(result.plan.payload).toEqual({
      supplierBillId: 'bill-1',
      amount: 1500,
      apAccountCode: '20000',
      supplierAdvanceCode: '20100',
    });
    expect(typeof result.plan.payload.amount).toBe('number');
  });

  it('refuses when the chart cannot answer which account is Supplier Advance', () => {
    const result = planAllocation(150000, 'bill-1', 'en', [AP]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.role)).toEqual(['SUPPLIER_ADVANCE']);
  });
});

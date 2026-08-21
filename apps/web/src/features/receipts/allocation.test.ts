import { describe, expect, it } from 'vitest';

import type { ClientInvoice } from '@/features/accounting/types';

import {
  allocatedMinor,
  allocationProblem,
  fromMinorUnits,
  invoicesForClient,
  isFullyAllocated,
  isOverAllocated,
  toMinorUnits,
  unallocatedMinor,
} from './allocation';
import type { Receipt, ReceiptAllocation } from './types';

function allocation(
  amount: string,
  overrides: Partial<ReceiptAllocation> = {},
): ReceiptAllocation {
  return {
    id: `alloc-${amount}`,
    paymentReceiptId: 'r1',
    clientInvoiceId: 'inv1',
    allocatedAmount: amount,
    allocationDate: '2026-06-20',
    postingStatus: 'POSTED',
    reversalJournalEntryId: null,
    ...overrides,
  };
}

/** A receipt with a given unallocated balance — the only field the balance helpers read. */
function receipt(unallocatedAmount: string): Pick<Receipt, 'unallocatedAmount'> {
  return { unallocatedAmount };
}

describe('minor-unit conversion', () => {
  it.each([
    ['1234.50', 123450],
    ['1234.5', 123450],
    ['1234', 123400],
    ['0.01', 1],
    ['0', 0],
    ['  99.99  ', 9999],
  ])('reads %s as %i cents', (input, expected) => {
    expect(toMinorUnits(input)).toBe(expected);
  });

  it('truncates beyond two places rather than rounding up into a cent', () => {
    expect(toMinorUnits('1.999')).toBe(199);
  });

  it('treats missing values as zero', () => {
    expect(toMinorUnits(null)).toBe(0);
    expect(toMinorUnits(undefined)).toBe(0);
    expect(toMinorUnits('')).toBe(0);
  });

  it.each([
    [123450, '1234.50'],
    [1, '0.01'],
    [0, '0.00'],
    [100, '1.00'],
  ])('writes %i cents as %s', (input, expected) => {
    expect(fromMinorUnits(input)).toBe(expected);
  });

  it('sums cleanly where floating point would not', () => {
    const allocations = [allocation('0.10'), allocation('0.20')];
    expect(allocatedMinor(allocations)).toBe(30);
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('excludes reversed allocations from the applied total', () => {
    const allocations = [allocation('250.00'), allocation('100.00', { postingStatus: 'REVERSED' })];
    expect(allocatedMinor(allocations)).toBe(25000);
  });
});

describe('unallocated balance (read from the receipt)', () => {
  it('is the receipt unallocated amount', () => {
    expect(unallocatedMinor(receipt('1000.00'))).toBe(100000);
  });

  it('reaches exactly zero when fully applied', () => {
    expect(unallocatedMinor(receipt('0'))).toBe(0);
    expect(isFullyAllocated(receipt('0'))).toBe(true);
    expect(isOverAllocated(receipt('0'))).toBe(false);
  });

  it('does not report a partly-applied receipt as fully allocated', () => {
    expect(isFullyAllocated(receipt('0.01'))).toBe(false);
  });

  it('reports an over-applied receipt as over, never as fully allocated', () => {
    expect(isOverAllocated(receipt('-100.00'))).toBe(true);
    expect(isFullyAllocated(receipt('-100.00'))).toBe(false);
  });
});

describe('allocationProblem', () => {
  const remaining = 100000; // $1,000.00 unallocated on the receipt

  it('accepts an amount within the remaining balance', () => {
    expect(allocationProblem('500.00', remaining)).toBeNull();
  });

  it('accepts exactly the remaining balance', () => {
    expect(allocationProblem('1000.00', remaining)).toBeNull();
  });

  it('rejects one cent over the receipt balance', () => {
    expect(allocationProblem('1000.01', remaining)).toBe('exceeds-receipt');
  });

  it('rejects an amount over the invoice outstanding', () => {
    // Within the receipt balance, but the invoice only owes 500.00.
    expect(allocationProblem('600.00', remaining, 50000)).toBe('exceeds-invoice');
    expect(allocationProblem('500.00', remaining, 50000)).toBeNull();
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'not-a-number'],
    ['0', 'not-positive'],
    ['0.00', 'not-positive'],
    ['-100.00', 'not-positive'],
  ])('rejects %s as %s', (typed, problem) => {
    expect(allocationProblem(typed, remaining)).toBe(problem);
  });
});

describe('invoicesForClient', () => {
  const invoice = (overrides: Partial<ClientInvoice>): ClientInvoice =>
    ({
      id: 'inv-x',
      invoiceNumber: 'INV-001',
      clientId: 'client-a',
      totalAmount: '105000.00',
      outstandingAmount: '105000.00',
      documentStatus: 'APPROVED',
      postingStatus: 'POSTED',
      ...overrides,
    }) as ClientInvoice;

  it('offers a client-owned, posted, still-outstanding invoice', () => {
    const options = invoicesForClient([invoice({ id: 'inv-1' })], 'client-a');
    expect(options.map((o) => o.invoice.id)).toEqual(['inv-1']);
    expect(options[0]?.outstandingMinor).toBe(10500000);
  });

  it('excludes another client, unposted, and fully-settled invoices', () => {
    const invoices = [
      invoice({ id: 'other-client', clientId: 'client-b' }),
      invoice({ id: 'unposted', postingStatus: 'NOT_POSTED' }),
      invoice({ id: 'settled', outstandingAmount: '0.00' }),
      invoice({ id: 'payable' }),
    ];
    expect(invoicesForClient(invoices, 'client-a').map((o) => o.invoice.id)).toEqual(['payable']);
  });
});

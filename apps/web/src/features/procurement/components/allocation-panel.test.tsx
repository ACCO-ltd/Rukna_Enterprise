import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { SupplierBill, SupplierPayment } from '../types';

/**
 * Tier D — the allocation panel.
 *
 * Two things are asserted that a future reader would otherwise be tempted to change:
 *
 *  - **reverse only for advance applied later** (AP-6): an allocation made with the payment is
 *    part of its own journal and is undone by reversing the payment
 *  - **the picker filters by supplier and currency**, which the server does not (A18 / #36)
 */

const mocks = vi.hoisted(() => ({
  useAllocateAdvance: vi.fn(),
  useReverseAdvanceAllocation: vi.fn(),
  useSupplierBills: vi.fn(),
}));

const accountingMocks = vi.hoisted(() => ({
  useAccounts: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => mocks);
vi.mock('@/features/accounting/hooks/use-accounting', () => accountingMocks);

import { AllocationPanel } from './allocation-panel';
import { openSelect } from '@/test/choose-option';

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
    totalAmount: '3000.00',
    outstandingAmount: '3000.00',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAllocateAdvance.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  mocks.useReverseAdvanceAllocation.mockReturnValue({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null });
  mocks.useSupplierBills.mockReturnValue({ data: [bill()], isPending: false, isError: false });
  accountingMocks.useAccounts.mockReturnValue({ data: [], isPending: false, isError: false });
});

describe('AllocationPanel', () => {
  it('offers an eligible bill in the picker', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AllocationPanel payment={payment()} />, { permissions: ['manage:payable'] });

    await openSelect(user, screen.getByLabelText('Bill to settle'));
    expect(screen.getByRole('option', { name: /INV-100/ })).toBeInTheDocument();
  });

  /** AP-6 — what the payment settled, and Reverse only on advance applied later. */
  it('lists what the payment settled; only advance applied later can be reversed', () => {
    const withAllocations = payment({
      postedJournalEntryId: 'je-pay',
      allocations: [
        { id: 'a1', supplierBillId: 'b1', allocatedAmount: '400.00', allocationDate: '2026-07-02', postingStatus: 'POSTED', journalEntryId: 'je-pay', bill: { billNumber: 'BILL-000001', supplierInvoiceNumber: 'INV-1' } },
        { id: 'a2', supplierBillId: 'b2', allocatedAmount: '100.00', allocationDate: '2026-07-05', postingStatus: 'POSTED', journalEntryId: 'je-app', bill: { billNumber: 'BILL-000002', supplierInvoiceNumber: 'INV-2' } },
      ],
    } as never);
    renderWithProviders(<AllocationPanel payment={withAllocations} />, { permissions: ['manage:payable'] });

    expect(screen.getByRole('link', { name: 'BILL-000001' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'BILL-000002' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Reverse' })).toHaveLength(1);
  });

  /** A18 / #36 — the filter the server does not apply. */
  it('hides another supplier’s bill even though the server would accept it', () => {
    mocks.useSupplierBills.mockReturnValue({
      data: [bill({ id: 'other', supplierId: 'sup-2', supplierInvoiceNumber: 'INV-999' })],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<AllocationPanel payment={payment()} />, { permissions: ['manage:payable'] });

    // Filtering the only candidate out leaves nothing to allocate against, so the panel
    // replaces the picker with the blocked notice. Asserting the notice is what proves the
    // filter ran; the old `queryByRole('option')` passed whether it ran or not, because there
    // was no picker either way.
    expect(screen.getByText(/No posted bill for this supplier/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Bill to settle')).not.toBeInTheDocument();
  });

  it('hides a bill in another currency', () => {
    mocks.useSupplierBills.mockReturnValue({
      data: [bill({ id: 'sar', currencyCode: 'SAR', supplierInvoiceNumber: 'INV-SAR' })],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<AllocationPanel payment={payment()} />, { permissions: ['manage:payable'] });

    expect(screen.getByText(/No posted bill for this supplier/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Bill to settle')).not.toBeInTheDocument();
  });

  it('shows nothing for an unposted payment that paid no bill — no dead form (SP-4)', () => {
    const { container } = renderWithProviders(<AllocationPanel payment={payment({ postingStatus: 'NOT_POSTED' })} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('a fully applied payment lists its bills, with no apply form', () => {
    const spent = payment({
      allocatedAmount: '5000.00',
      unallocatedAmount: '0.00',
      allocations: [{ id: 'a1', supplierBillId: 'b1', allocatedAmount: '5000.00', allocationDate: '2026-07-02', postingStatus: 'POSTED', journalEntryId: null, bill: { billNumber: 'BILL-000001', supplierInvoiceNumber: 'INV-1' } }],
    } as never);
    renderWithProviders(<AllocationPanel payment={spent} />, { permissions: ['manage:payable'] });

    expect(screen.getByRole('link', { name: 'BILL-000001' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Bill to settle')).not.toBeInTheDocument();
  });

});

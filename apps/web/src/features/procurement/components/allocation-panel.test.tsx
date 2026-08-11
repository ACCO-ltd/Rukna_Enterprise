import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { SupplierBill, SupplierPayment } from '../types';

/**
 * Tier D — the allocation panel.
 *
 * Two things are asserted that a future reader would otherwise be tempted to change:
 *
 *  - **no reverse control**, because no endpoint returns an allocation id (A17 / #35)
 *  - **the picker filters by supplier and currency**, which the server does not (A18 / #36)
 */

const mocks = vi.hoisted(() => ({
  useAllocateAdvance: vi.fn(),
  useSupplierBills: vi.fn(),
}));

const accountingMocks = vi.hoisted(() => ({
  useAccounts: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => mocks);
vi.mock('@/features/accounting/hooks/use-accounting', () => accountingMocks);

import { AllocationPanel } from './allocation-panel';

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAllocateAdvance.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  mocks.useSupplierBills.mockReturnValue({ data: [bill()], isPending: false, isError: false });
  accountingMocks.useAccounts.mockReturnValue({ data: [], isPending: false, isError: false });
});

describe('AllocationPanel', () => {
  it('offers an eligible bill in the picker', () => {
    renderWithProviders(<AllocationPanel payment={payment()} />);

    expect(screen.getByRole('option', { name: /INV-100/ })).toBeInTheDocument();
  });

  /**
   * A17 / #35. The endpoint exists and cannot be called — allocating returns only the journal,
   * the payment payload embeds no allocations, and nothing lists them. A reverse button here
   * would have no argument to pass.
   */
  it('offers no reverse control, and says the history is unavailable', () => {
    renderWithProviders(<AllocationPanel payment={payment()} />);

    expect(screen.queryByRole('button', { name: /reverse/i })).not.toBeInTheDocument();
    expect(screen.getByText(/cannot be listed/i)).toBeInTheDocument();
  });

  /** A18 / #36 — the filter the server does not apply. */
  it('hides another supplier’s bill even though the server would accept it', () => {
    mocks.useSupplierBills.mockReturnValue({
      data: [bill({ id: 'other', supplierId: 'sup-2', supplierInvoiceNumber: 'INV-999' })],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<AllocationPanel payment={payment()} />);

    expect(screen.queryByRole('option', { name: /INV-999/ })).not.toBeInTheDocument();
    expect(screen.getByText(/No posted bill for this supplier/i)).toBeInTheDocument();
  });

  it('hides a bill in another currency', () => {
    mocks.useSupplierBills.mockReturnValue({
      data: [bill({ id: 'sar', currencyCode: 'SAR', supplierInvoiceNumber: 'INV-SAR' })],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<AllocationPanel payment={payment()} />);

    expect(screen.queryByRole('option', { name: /INV-SAR/ })).not.toBeInTheDocument();
  });

  it('explains why an unposted payment cannot allocate, instead of showing a dead form', () => {
    renderWithProviders(<AllocationPanel payment={payment({ postingStatus: 'NOT_POSTED' })} />);

    expect(screen.getByText(/has to be posted before its advance/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply to bill/i })).not.toBeInTheDocument();
  });

  it('explains a fully allocated payment', () => {
    const spent = payment({ allocatedAmount: '5000.00', unallocatedAmount: '0.00' });
    renderWithProviders(<AllocationPanel payment={spent} />);

    expect(screen.getByText(/fully allocated/i)).toBeInTheDocument();
  });

  it('renders in Arabic without a missing translation key', () => {
    renderWithProviders(<AllocationPanel payment={payment()} />, { locale: 'ar' });

    expect(screen.getByRole('heading', { name: 'تخصيص هذه الدفعة المقدّمة' })).toBeInTheDocument();
  });
});

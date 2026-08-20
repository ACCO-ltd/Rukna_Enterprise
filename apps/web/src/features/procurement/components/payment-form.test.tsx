import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/**
 * Tier C — the payment form and list.
 *
 * The assertion that matters most is the absence of an allocations control. `POST /payments`
 * accepts `allocations[]` and never persists it (A16 / #34), so offering the field would let a
 * user debit Accounts Payable against a bill that stays fully outstanding. If a future change
 * adds allocation lines here, this test is the thing that should stop it.
 */

const mocks = vi.hoisted(() => ({
  useCreateSupplierPayment: vi.fn(),
  useSupplierPayments: vi.fn(),
  useSuppliers: vi.fn(),
}));

const accountingMocks = vi.hoisted(() => ({
  useBankAccounts: vi.fn(),
  useAccounts: vi.fn(),
  usePostingProfiles: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => mocks);
vi.mock('@/features/accounting/hooks/use-accounting', () => accountingMocks);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));

import { PAYMENT_METHODS, SupplierPaymentForm } from './payment-form';
import { SupplierPaymentsList } from './payment-screens';

const BANK = {
  id: 'bank-1',
  glAccountId: 'a-bank1',
  bankName: 'Salaam Bank',
  accountName: 'Main Operating',
  accountNumber: '000123454821',
  iban: null,
  swiftCode: null,
  currencyCode: 'USD',
  branch: null,
  allowsReceipts: true,
  allowsPayments: true,
  isReconcilable: true,
  status: 'ACTIVE' as const,
};

const SUPPLIER = {
  id: 'sup-1',
  code: 'SUP-001',
  name: 'Al-Rashid Trading',
  taxNumber: null,
  defaultCurrency: null,
  paymentTermsDays: null,
  status: 'ACTIVE' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useCreateSupplierPayment.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  mocks.useSuppliers.mockReturnValue({ data: [SUPPLIER], isPending: false, isError: false });
  mocks.useSupplierPayments.mockReturnValue({ data: [], isPending: false, isError: false });
  accountingMocks.useBankAccounts.mockReturnValue({
    data: [BANK],
    isPending: false,
    isError: false,
  });
  accountingMocks.useAccounts.mockReturnValue({ data: [], isPending: false, isError: false });
  accountingMocks.usePostingProfiles.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
  });
});

describe('SupplierPaymentForm', () => {
  /** A16 / #34. The one control this form must never grow. */
  it('offers no allocation lines, and says why', () => {
    renderWithProviders(<SupplierPaymentForm />);

    expect(screen.queryByText(/add line/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/bill/i)).not.toBeInTheDocument();
    expect(screen.getByText(/unallocated advance/i)).toBeInTheDocument();
  });

  it('offers the supplier, bank account, date, amount and method', () => {
    renderWithProviders(<SupplierPaymentForm />);

    expect(screen.getByLabelText('Supplier')).toBeInTheDocument();
    expect(screen.getByLabelText('Bank account')).toBeInTheDocument();
    expect(screen.getByLabelText('Payment date')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
    expect(screen.getByLabelText('Method')).toBeInTheDocument();
  });

  it('lists the bank account with its number masked', () => {
    renderWithProviders(<SupplierPaymentForm />);

    expect(
      screen.getByRole('option', { name: 'Salaam Bank · Main Operating — ****4821' }),
    ).toBeInTheDocument();
  });

  /**
   * Exact labels, and one per method: `paymentMethod` is a free string on the DTO with no enum
   * behind it, so this list is the UI's own vocabulary and nothing on the server would reject
   * a code that lost its translation.
   */
  it('offers every payment method with a translated label, not a raw code', () => {
    renderWithProviders(<SupplierPaymentForm />);

    const method = screen.getByLabelText('Method') as HTMLSelectElement;
    const labels = [...method.options].map((option) => option.textContent);

    expect(labels).toEqual(['Bank transfer', 'Cheque', 'Cash', 'Card', 'Mobile money']);
    expect(labels).toHaveLength(PAYMENT_METHODS.length);
    for (const label of labels) expect(label).not.toMatch(/_/);
  });

  /**
   * A payment must name a bank account, and the server validates nothing. With none payable
   * the only choice would be empty and every submit would 400, so the form says so and
   * disables creation.
   */
  it('blocks the form when no bank account allows payments', () => {
    accountingMocks.useBankAccounts.mockReturnValue({
      data: [{ ...BANK, allowsPayments: false }],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<SupplierPaymentForm />);

    expect(screen.getByText(/No bank account is available for payments/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
  });

});

describe('SupplierPaymentsList', () => {
  it('renders empty without error', () => {
    renderWithProviders(<SupplierPaymentsList />);

    expect(screen.getByText(/No payments yet/i)).toBeInTheDocument();
  });

  /**
   * `paymentNumber` is null until the payment posts — the PMT- sequence is claimed inside the
   * posting transaction. A blank link cell would be unclickable and unexplained.
   */
  it('labels an unposted payment rather than rendering a blank link', () => {
    mocks.useSupplierPayments.mockReturnValue({
      data: [
        {
          id: 'pmt-1',
          paymentNumber: null,
          supplierId: 'sup-1',
          bankAccountId: 'bank-1',
          paymentDate: '2026-08-11',
          accountingDate: '2026-08-11',
          currencyCode: 'USD',
          totalAmount: '5000.00',
          allocatedAmount: '0.00',
          unallocatedAmount: '5000.00',
          paymentMethod: 'BANK_TRANSFER',
          bankReference: null,
          notes: null,
          documentStatus: 'DRAFT',
          postingStatus: 'NOT_POSTED',
          postedJournalEntryId: null,
        },
      ],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<SupplierPaymentsList />);

    expect(screen.getByRole('link', { name: /not yet numbered/i })).toBeInTheDocument();
    expect(screen.getByText('Al-Rashid Trading')).toBeInTheDocument();
  });
});

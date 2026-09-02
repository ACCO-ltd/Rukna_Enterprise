import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/**
 * Tier B — the non-PO supplier bill form.
 *
 * Rendering against the real catalogues proves every key exists in English and Arabic. The
 * behavioural assertions each pin a decision:
 *
 *  - no purchase-order field, because a PO-linked bill can never be matched (A14)
 *  - VAT is required, because the DTO has no default and §6.20 omits it entirely (A4)
 *  - the form refuses to render usably when no expense profile resolves, rather than
 *    offering an empty required select that guarantees a 400
 */

const mocks = vi.hoisted(() => ({
  useCreateSupplierBill: vi.fn(),
  useSuppliers: vi.fn(),
  // SupplierPicker offers "New supplier" from the picker itself.
  useCreateSupplier: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null, reset: vi.fn() }),
}));

const accountingMocks = vi.hoisted(() => ({
  useAccounts: vi.fn(),
  usePostingProfiles: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => mocks);
vi.mock('@/features/accounting/hooks/use-accounting', () => accountingMocks);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));

import { SupplierBillForm, billLineError, billTotalMinor, emptyBillLine } from './bill-form';
import { openSelect } from '@/test/choose-option';

const OFFICE = {
  id: 'a-office',
  code: '60100',
  status: 'ACTIVE',
  versions: [
    {
      id: 'v1',
      versionNumber: 1,
      name: 'Office & Admin',
      accountClass: 'EXPENSE',
      accountSubtype: 'ADMIN_EXPENSE',
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
};

const PROFILE = {
  id: 'p-1',
  code: 'OFFICE_EXPENSE',
  status: 'ACTIVE' as const,
  versions: [
    {
      id: 'pv-1',
      versionNumber: 1,
      name: 'Office & Admin Expense',
      description: null,
      accountId: 'a-office',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useCreateSupplierBill.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  mocks.useSuppliers.mockReturnValue({
    data: [
      {
        id: 'sup-1',
        code: 'SUP-001',
        name: 'Al-Rashid Trading',
        taxNumber: null,
        defaultCurrency: null,
        paymentTermsDays: null,
        status: 'ACTIVE',
      },
    ],
    isPending: false,
    isError: false,
  });
  accountingMocks.useAccounts.mockReturnValue({
    data: [OFFICE],
    isPending: false,
    isError: false,
  });
  accountingMocks.usePostingProfiles.mockReturnValue({
    data: [PROFILE],
    isPending: false,
    isError: false,
  });
});

describe('billLineError', () => {
  const valid = {
    description: 'Rent',
    netAmount: '400.00',
    vatAmount: '0',
    expenseProfileCode: 'OFFICE_EXPENSE',
  };

  it('accepts a complete line, including zero VAT', () => {
    expect(billLineError(valid)).toBeNull();
  });

  it('requires a description', () => {
    expect(billLineError({ ...valid, description: '   ' })).toBe('description');
  });

  /**
   * A4. `vatAmount` is `@IsNumber() @Min(0)` with no default, and §6.20's example omits it —
   * so a body copied from the reference 400s. An empty field must not be silently sent as 0:
   * "no VAT" and "VAT not entered yet" are different facts on a document that posts to the
   * ledger, and only one of them is a decision the user made.
   */
  it('requires VAT to be typed, and accepts an explicit zero', () => {
    expect(billLineError({ ...valid, vatAmount: '' })).toBe('vat');
    expect(billLineError({ ...valid, vatAmount: '0' })).toBeNull();
  });

  it('rejects a negative or unparseable amount rather than reading it as zero', () => {
    expect(billLineError({ ...valid, netAmount: '-5' })).toBe('net');
    expect(billLineError({ ...valid, netAmount: 'abc' })).toBe('net');
  });

  it('requires an expense profile', () => {
    expect(billLineError({ ...valid, expenseProfileCode: '' })).toBe('profile');
  });
});

describe('billTotalMinor', () => {
  it('sums net plus VAT across lines, in minor units', () => {
    expect(
      billTotalMinor([
        { description: 'a', netAmount: '600.00', vatAmount: '30.00', expenseProfileCode: 'X' },
        { description: 'b', netAmount: '400.00', vatAmount: '20.00', expenseProfileCode: 'X' },
      ]),
    ).toBe(105000);
  });

  it('treats an empty line as zero rather than NaN', () => {
    expect(billTotalMinor([emptyBillLine()])).toBe(0);
  });
});

describe('SupplierBillForm', () => {
  /**
   * A14. There is no purchase-order field and there must not be one: a bill never records the
   * PO revision behind it, so an attached order would look linked and behave unlinked —
   * unmatched, ungated, and leaving its commitment stranded at ACCRUED forever.
   */
  it('offers no purchase-order field', () => {
    renderWithProviders(<SupplierBillForm />);

    expect(screen.queryByLabelText(/purchase order/i)).not.toBeInTheDocument();
    expect(screen.getByText(/cannot be attached to a purchase order/i)).toBeInTheDocument();
  });

  // Exact labels, not substrings: `bills.invoiceNumber` reads "Supplier Invoice", so
  // /supplier/i matches two controls and the query is ambiguous.
  it('offers the supplier, invoice number and both dates', () => {
    renderWithProviders(<SupplierBillForm />);

    expect(screen.getByLabelText('Supplier')).toBeInTheDocument();
    expect(screen.getByLabelText('Supplier Invoice')).toBeInTheDocument();
    expect(screen.getByLabelText('Bill Date')).toBeInTheDocument();
    expect(screen.getByLabelText('Due Date')).toBeInTheDocument();
  });

  it('offers only expense profiles in the line picker', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SupplierBillForm />);

    await openSelect(user, screen.getByLabelText('Expense posting profile'));
    expect(
      screen.getByRole('option', { name: /Office & Admin Expense/ }),
    ).toBeInTheDocument();
  });

  /**
   * Every line requires a profile. With none resolvable the only required select would be
   * empty and the create would 400 on every attempt, so the form says what is wrong and
   * disables submission instead.
   */
  it('blocks the form when no expense profile resolves', () => {
    accountingMocks.usePostingProfiles.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<SupplierBillForm />);

    expect(screen.getByText(/No expense posting profile is configured/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
  });

});

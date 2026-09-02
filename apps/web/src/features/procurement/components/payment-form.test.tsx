import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { chooseOption, openSelect } from '@/test/choose-option';
import { pickDate } from '@/test/pick-date';

/**
 * Tier C + D9 — the payment form and list.
 *
 * The form now settles bills inline: after the amount, an "Apply to bills" section lists the
 * supplier's outstanding POSTED bills, ticking one prefills full settlement, the amount is
 * editable, and the remainder is a supplier advance. `SupplierPaymentService.create` writes the
 * allocation rows and reduces each bill (A16, commit eb826bb) — so, unlike the mitigation era, offering
 * the field is correct. The maths itself is unit-tested in `payment-allocations.test.ts`; these
 * tests cover the wiring and the state ladder.
 */

const mocks = vi.hoisted(() => ({
  useCreateSupplierPayment: vi.fn(),
  useSupplierPayments: vi.fn(),
  useSuppliers: vi.fn(),
  // SupplierPicker offers "New supplier" from the picker itself.
  useCreateSupplier: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null, reset: vi.fn() }),
  useSupplierBills: vi.fn(),
}));

const accountingMocks = vi.hoisted(() => ({
  useBankAccounts: vi.fn(),
  useAccounts: vi.fn(),
  usePostingProfiles: vi.fn(),
  // The accounting-date picker refuses days in a closed period, which it learns from here.
  useFiscalYears: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => mocks);
vi.mock('@/features/accounting/hooks/use-accounting', () => accountingMocks);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));

import { PAYMENT_METHODS, SupplierPaymentForm } from './payment-form';
import { SupplierPaymentsList } from './payment-screens';

const MANAGE = ['manage:payable'];

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

function bill(overrides = {}) {
  return {
    id: 'bill-1',
    billNumber: null,
    supplierId: 'sup-1',
    supplier: { id: 'sup-1', code: 'SUP-001', name: 'Al-Rashid Trading' },
    supplierInvoiceNumber: 'INV-9044',
    billDate: '2026-08-31',
    dueDate: '2026-09-30',
    currencyCode: 'USD',
    documentStatus: 'APPROVED' as const,
    postingStatus: 'POSTED' as const,
    matchStatus: 'NOT_RUN' as const,
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

let mutate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mutate = vi.fn();
  mocks.useCreateSupplierPayment.mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    error: null,
  });
  mocks.useSuppliers.mockReturnValue({ data: [SUPPLIER], isPending: false, isError: false });
  mocks.useSupplierPayments.mockReturnValue({ data: [], isPending: false, isError: false });
  mocks.useSupplierBills.mockReturnValue({ data: [], isPending: false, isError: false });
  accountingMocks.useBankAccounts.mockReturnValue({
    data: [BANK],
    isPending: false,
    isError: false,
  });
  accountingMocks.useAccounts.mockReturnValue({ data: [], isPending: false, isError: false });
  // No periods loaded means the calendar constrains nothing, which is what these tests want.
  accountingMocks.useFiscalYears.mockReturnValue({ data: [], isPending: false, isError: false });
  accountingMocks.usePostingProfiles.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
  });
});

/** Fills supplier, bank, date and amount — the fields every submit needs. */
async function fillHeader(user: ReturnType<typeof userEvent.setup>, amount = '5700') {
  await chooseOption(user, screen.getByLabelText('Supplier'), 'sup-1');
  await chooseOption(user, screen.getByLabelText('Bank account'), 'bank-1');
  const date = screen.getByLabelText('Payment date') as HTMLInputElement;
  await pickDate(user, date, '2026-08-31');
  await user.type(screen.getByLabelText('Amount'), amount);
}

describe('SupplierPaymentForm — apply to bills', () => {
  it('offers the supplier, bank account, date, amount and method', () => {
    renderWithProviders(<SupplierPaymentForm />, { permissions: MANAGE });

    expect(screen.getByLabelText('Supplier')).toBeInTheDocument();
    expect(screen.getByLabelText('Bank account')).toBeInTheDocument();
    expect(screen.getByLabelText('Payment date')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
    expect(screen.getByLabelText('Method')).toBeInTheDocument();
  });

  it('shows the Apply to bills section with a live Applied/Unapplied footer', () => {
    renderWithProviders(<SupplierPaymentForm />, { permissions: MANAGE });

    expect(screen.getByRole('heading', { name: 'Apply to bills' })).toBeInTheDocument();
    expect(screen.getByText(/Applied/)).toBeInTheDocument();
    expect(screen.getByText(/Unapplied/)).toBeInTheDocument();
  });

  it('prompts for the amount before listing bills', () => {
    mocks.useSupplierBills.mockReturnValue({ data: [bill()], isPending: false, isError: false });
    renderWithProviders(<SupplierPaymentForm />, { permissions: MANAGE });

    expect(screen.getByText(/Enter the payment amount above/i)).toBeInTheDocument();
  });

  it('lists the supplier outstanding bill and prefills full settlement when ticked', async () => {
    const user = userEvent.setup();
    mocks.useSupplierBills.mockReturnValue({ data: [bill()], isPending: false, isError: false });
    renderWithProviders(<SupplierPaymentForm />, { permissions: MANAGE });

    await fillHeader(user);

    expect(screen.getByText('INV-9044')).toBeInTheDocument();
    // Whole amount unapplied until a bill is ticked.
    expect(screen.getByText('Unapplied $5,700.00')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox'));

    // Prefilled full settlement of 2,850.00, leaving 2,850.00 as an advance.
    const applyInput = screen.getByLabelText('Apply to INV-9044') as HTMLInputElement;
    expect(applyInput.value).toBe('2,850.00');
    expect(screen.getByText('Applied $2,850.00')).toBeInTheDocument();
    expect(screen.getByText('Unapplied $2,850.00')).toBeInTheDocument();
  });

  it('sends allocations for the ticked bills on submit', async () => {
    const user = userEvent.setup();
    mocks.useSupplierBills.mockReturnValue({
      data: [
        bill({ id: 'b1', supplierInvoiceNumber: 'INV-9044', billDate: '2026-08-10' }),
        bill({ id: 'b2', supplierInvoiceNumber: 'INV-9051', billDate: '2026-08-20' }),
      ],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<SupplierPaymentForm />, { permissions: MANAGE });

    await fillHeader(user);
    const [first, second] = screen.getAllByRole('checkbox');
    await user.click(first);
    await user.click(second);

    await user.click(screen.getByRole('button', { name: /record payment/i }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const [payload] = mutate.mock.calls[0];
    expect(payload.totalAmount).toBe(5700);
    expect(payload.allocations).toEqual([
      { supplierBillId: 'b1', amount: 2850 },
      { supplierBillId: 'b2', amount: 2850 },
    ]);
  });

  it('blocks submit when the applied amounts exceed the payment amount', async () => {
    const user = userEvent.setup();
    mocks.useSupplierBills.mockReturnValue({
      data: [bill({ outstandingAmount: '2850.00' })],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<SupplierPaymentForm />, { permissions: MANAGE });

    // Amount 1,000; ticking prefills the remaining 1,000 (fits). The user then edits it up to
    // 2,850 — within the bill's outstanding, but over the payment amount → Σ over-application.
    await fillHeader(user, '1000');
    await user.click(screen.getByRole('checkbox'));
    const applyInput = screen.getByLabelText('Apply to INV-9044');
    await user.clear(applyInput);
    await user.type(applyInput, '2850');

    await user.click(screen.getByRole('button', { name: /record payment/i }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/add up to more than the payment amount/i)).toBeInTheDocument();
  });

  it('offers a pure advance when the supplier has no outstanding bills', async () => {
    const user = userEvent.setup();
    mocks.useSupplierBills.mockReturnValue({ data: [], isPending: false, isError: false });
    renderWithProviders(<SupplierPaymentForm />, { permissions: MANAGE });

    await fillHeader(user);

    expect(screen.getByText(/recorded as a supplier advance/i)).toBeInTheDocument();
    expect(screen.getByText('Unapplied $5,700.00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /record payment/i }));
    const [payload] = mutate.mock.calls[0];
    expect(payload.allocations).toBeUndefined();
  });

  it('degrades gracefully when the supplier bills cannot be loaded', async () => {
    const user = userEvent.setup();
    mocks.useSupplierBills.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderWithProviders(<SupplierPaymentForm />, { permissions: MANAGE });

    await fillHeader(user);

    expect(screen.getByText(/bills could not be loaded/i)).toBeInTheDocument();
    // A pure advance is still recordable.
    await user.click(screen.getByRole('button', { name: /record payment/i }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('lists the bank account with its number masked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SupplierPaymentForm />, { permissions: MANAGE });

    await openSelect(user, screen.getByLabelText('Bank account'));
    expect(
      screen.getByRole('option', { name: 'Salaam Bank · Main Operating — ****4821' }),
    ).toBeInTheDocument();
  });

  it('offers every payment method with a translated label, not a raw code', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SupplierPaymentForm />, { permissions: MANAGE });

    await openSelect(user, screen.getByLabelText('Method'));
    const labels = screen.getAllByRole('option').map((option) => option.textContent);

    expect(labels).toEqual(['Bank transfer', 'Cheque', 'Cash', 'Card', 'Mobile money']);
    expect(labels).toHaveLength(PAYMENT_METHODS.length);
    for (const label of labels) expect(label).not.toMatch(/_/);
  });

  it('blocks the form when no bank account allows payments', () => {
    accountingMocks.useBankAccounts.mockReturnValue({
      data: [{ ...BANK, allowsPayments: false }],
      isPending: false,
      isError: false,
    });
    renderWithProviders(<SupplierPaymentForm />, { permissions: MANAGE });

    expect(screen.getByText(/No bank account is available for payments/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record payment/i })).toBeDisabled();
  });

  it('disables Record payment without the manage:payable permission', () => {
    renderWithProviders(<SupplierPaymentForm />);

    expect(screen.getByRole('button', { name: /record payment/i })).toBeDisabled();
  });
});

describe('SupplierPaymentsList', () => {
  it('renders empty without error', () => {
    renderWithProviders(<SupplierPaymentsList />);

    expect(screen.getByText(/No payments yet/i)).toBeInTheDocument();
  });

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

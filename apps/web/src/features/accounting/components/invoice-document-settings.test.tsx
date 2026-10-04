import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chooseOption, openSelect } from '@/test/choose-option';
import { renderWithProviders } from '@/test/render';

import type { BankAccount, InvoiceDocumentSettings } from '../types';
import {
  InvoiceDocumentSettingsPanel,
  invoiceBankCandidates,
  maskedAccount,
} from './invoice-document-settings';

/** Accounting → Invoice settings: the bank account, notes and signatory on invoice PDFs. */

const mocks = vi.hoisted(() => ({
  useInvoiceDocumentSettings: vi.fn(),
  useUpdateInvoiceDocumentSettings: vi.fn(),
  useBankAccounts: vi.fn(),
  useUsers: vi.fn(),
}));

vi.mock('../hooks/use-accounting', () => ({
  useInvoiceDocumentSettings: mocks.useInvoiceDocumentSettings,
  useUpdateInvoiceDocumentSettings: mocks.useUpdateInvoiceDocumentSettings,
  useBankAccounts: mocks.useBankAccounts,
}));
vi.mock('@/features/users/hooks/use-users', () => ({ useUsers: mocks.useUsers }));

const bank = (id: string, extra: Partial<BankAccount> = {}): BankAccount => ({
  id,
  glAccountId: `gl-${id}`,
  bankName: 'Premier Bank',
  accountName: `Operating ${id}`,
  accountNumber: '0102 0033 4410',
  iban: null,
  swiftCode: 'PBSMSOSM',
  currencyCode: 'USD',
  branch: null,
  allowsReceipts: true,
  allowsPayments: true,
  isReconcilable: true,
  status: 'ACTIVE',
  ...extra,
});

const SETTINGS: InvoiceDocumentSettings = {
  bankAccountId: null,
  notes: null,
  defaultNotes: ['Please quote the invoice number in your payment.', 'This invoice is issued in accordance with the project contract.'],
  signatoryUserId: null,
  signatoryTitle: null,
  updatedAt: null,
};

const mutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useInvoiceDocumentSettings.mockReturnValue({ data: SETTINGS, isError: false, isPending: false });
  mocks.useUpdateInvoiceDocumentSettings.mockReturnValue({ mutate, isPending: false, isError: false });
  mocks.useBankAccounts.mockReturnValue({
    data: [bank('b1'), bank('b2', { allowsReceipts: false }), bank('b3', { status: 'CLOSED' })],
    isPending: false,
    isError: false,
  });
  mocks.useUsers.mockReturnValue({
    data: [{ id: 'u1', firstName: 'Ahmed', lastName: 'Ali', email: 'ahmed@example.com', status: 'ACTIVE' }],
    isPending: false,
    isError: false,
  });
});

const MANAGE = ['view:accounting', 'manage:accounting'];
const VIEW = ['view:accounting'];

describe('helpers', () => {
  it('masks to the last four with the currency, and offers only active receipt accounts', () => {
    expect(maskedAccount(bank('b1'))).toBe('USD …4410');
    expect(invoiceBankCandidates([bank('b1'), bank('b2', { allowsReceipts: false }), bank('b3', { status: 'CLOSED' })]).map((b) => b.id)).toEqual(['b1']);
  });
});

describe('InvoiceDocumentSettingsPanel', () => {
  it('shows the standard notes and no payment card while nothing is configured', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });
    expect(screen.getByRole('heading', { name: 'Invoice settings' })).toBeInTheDocument();
    expect(screen.getByText('Left blank, invoices print the standard notes:')).toBeInTheDocument();
    expect(screen.getByText('Please quote the invoice number in your payment.')).toBeInTheDocument();
    expect(screen.getByText('With no account chosen, invoices print no Payment Information card.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    // Only the receipts-enabled active account is offered.
    await openSelect(user, screen.getByLabelText('Bank account'));
    const offered = screen.getAllByRole('option').map((option) => option.textContent);
    expect(offered.some((text) => text?.includes('Operating b1'))).toBe(true);
    expect(offered.some((text) => text?.includes('Operating b2') || text?.includes('Operating b3'))).toBe(false);
  });

  it('previews the chosen account in full with its currency and saves the edited settings', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });

    await chooseOption(user, screen.getByLabelText('Bank account'), 'b1');
    // The preview shows the full number the invoice prints, its currency and the currency rule.
    expect(screen.getByText('0102 0033 4410')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Only USD invoices print these bank details. Invoices in other currencies print without a Payment Information card.',
      ),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Invoice notes'), 'Pay within 30 days.');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(mutate).toHaveBeenCalledWith({
      bankAccountId: 'b1',
      notes: 'Pay within 30 days.',
      signatoryUserId: null,
      signatoryTitle: null,
    });
  });

  it('shows the saved signatory and lets Finance remove it', async () => {
    const user = userEvent.setup();
    mocks.useInvoiceDocumentSettings.mockReturnValue({
      data: { ...SETTINGS, signatoryUserId: 'u1', signatoryTitle: 'Finance Manager' },
      isError: false,
      isPending: false,
    });
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });

    expect(screen.getByLabelText('Title')).toHaveValue('Finance Manager');
    await user.click(screen.getByRole('button', { name: 'Remove signatory' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ signatoryUserId: null, signatoryTitle: null }));
  });

  it('is read-only without manage:accounting', () => {
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: VIEW });
    expect(screen.getByText('Only Finance (manage accounting) can change these settings.')).toBeInTheDocument();
    expect(screen.getByLabelText('Bank account')).toBeDisabled();
    expect(screen.getByLabelText('Invoice notes')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
  });

  it('reports a load failure', () => {
    mocks.useInvoiceDocumentSettings.mockReturnValue({ data: undefined, isError: true, isPending: false });
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });
    expect(screen.getByText('Could not load the invoice settings.')).toBeInTheDocument();
  });
});

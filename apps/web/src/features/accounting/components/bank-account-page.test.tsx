import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { BankAccount } from '../types';

/**
 * BK — one account's page: what the books say it holds, each movement opening the document behind
 * it, its transfers, and who signs for it (the signatories dialog, ADR-039 FormDialog).
 */
const mocks = vi.hoisted(() => ({
  useBankAccounts: vi.fn(),
  useAccountLedger: vi.fn(),
  useSignatories: vi.fn(),
  useAddSignatory: vi.fn(),
  useRemoveSignatory: vi.fn(),
  useSetBankAccountStatus: vi.fn(),
  useUpdateBankAccount: vi.fn(),
  useAccounts: vi.fn(),
  useConfigureBankAccount: vi.fn(),
}));
vi.mock('../hooks/use-accounting', () => mocks);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/finance/accounting/bank-accounts/bank-1', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/features/users/hooks/use-users', () => ({
  useUsers: () => ({ data: [{ id: 'u1', firstName: 'Amina', lastName: 'Ali', email: 'amina@acco.com' }], isPending: false, isError: false }),
}));
vi.mock('@/features/bank-transfers/transfers-api', () => ({
  useBankTransfers: () => ({
    isPending: false,
    isError: false,
    data: [{ id: 't1', transferNumber: 'TR-000003', fromBankAccountId: 'bank-1', fromAccountName: 'Main Operating', toBankAccountId: 'box', toAccountName: 'Site cash box', amount: '800.00', transferDate: '2026-10-16', memo: 'Site petty cash', status: 'POSTED' }],
  }),
}));
vi.mock('@/features/bank-reconciliation/api', () => ({ bankStatementsApi: { list: () => Promise.resolve([]) } }));

import { BankAccountPage } from './bank-account-page';

const BANK: BankAccount = {
  id: 'bank-1', glAccountId: 'gl-9', glAccount: { id: 'gl-9', code: '10100' }, bankName: 'Salaam Bank', accountName: 'Main Operating',
  accountNumber: '000123454821', iban: null, swiftCode: null, currencyCode: 'USD', branch: null, kind: 'BANK',
  allowsReceipts: true, allowsPayments: true, isReconcilable: true, status: 'ACTIVE', bookBalance: '11860.00', lastReconciledTo: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useBankAccounts.mockReturnValue({ data: [BANK], isPending: false, isError: false });
  mocks.useAccountLedger.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      accountId: 'gl-9', accountCode: '10100', accountName: 'Main Operating', openingBalance: '0.00', periodDebit: '12500.00', periodCredit: '640.00', closingBalance: '11860.00',
      lines: [
        { journalEntryId: 'j1', journalNumber: 'JE-000009', accountingDate: '2026-10-06', documentDate: '2026-10-06', description: 'Customer receipt RCP-000001', reference: null, debitAmount: '12500.00', creditAmount: '0.00', runningBalance: '12500.00', sourceDocumentType: 'PAYMENT_RECEIPT', sourceDocumentId: 'r1', projectId: null, departmentId: null, costCenterId: null },
        { journalEntryId: 'j2', journalNumber: 'JE-000011', accountingDate: '2026-10-09', documentDate: '2026-10-09', description: 'Supplier payment PMT-000001', reference: null, debitAmount: '0.00', creditAmount: '640.00', runningBalance: '11860.00', sourceDocumentType: 'SUPPLIER_PAYMENT', sourceDocumentId: 'p1', projectId: null, departmentId: null, costCenterId: null },
      ],
    },
  });
  mocks.useSignatories.mockReturnValue({ data: [{ id: 's1', userId: 'u1', isActive: true, addedAt: '2026-09-01T00:00:00.000Z' }], isPending: false, isError: false });
  mocks.useAddSignatory.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
  mocks.useRemoveSignatory.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
  mocks.useSetBankAccountStatus.mockReturnValue({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null });
  mocks.useUpdateBankAccount.mockReturnValue({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null });
});

describe('BankAccountPage (BK)', () => {
  it('leads with what the books hold and offers a transfer and a reconciliation', () => {
    renderWithProviders(<BankAccountPage id="bank-1" />, { permissions: ['manage:accounting'] });
    expect(screen.getByRole('heading', { name: /Main Operating/ })).toBeInTheDocument();
    expect(screen.getAllByText('$11,860.00').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Transfer money/ })).toHaveAttribute('href', '/finance/accounting/transfers?new=1&from=bank-1');
    expect(screen.getByRole('link', { name: 'Reconcile' })).toHaveAttribute('href', '/finance/accounting/bank-reconciliation?account=bank-1');
  });

  it('opens the receipt or payment behind each movement', () => {
    renderWithProviders(<BankAccountPage id="bank-1" />, { permissions: ['manage:accounting'] });
    const table = screen.getByRole('table', { name: 'Transactions' });
    expect(within(table).getByRole('link', { name: 'Customer receipt RCP-000001' })).toHaveAttribute('href', '/receipts/r1');
    expect(within(table).getByRole('link', { name: 'Supplier payment PMT-000001' })).toHaveAttribute('href', '/finance/accounting/payments/p1');
    expect(screen.getByRole('link', { name: 'To Site cash box' })).toHaveAttribute('href', '/finance/accounting/transfers?highlight=t1');
  });

  it('names the signatories and manages them in a dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BankAccountPage id="bank-1" />, { permissions: ['manage:accounting'] });
    expect(screen.getByText('Two of them must sign to release a payment.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Manage' }));
    const dialog = await screen.findByRole('dialog', { name: 'Signatories' });
    expect(within(dialog).getByText('Amina Ali')).toBeInTheDocument();
  });

  it('says so when the account does not exist', () => {
    renderWithProviders(<BankAccountPage id="nope" />);
    expect(screen.getByText('Account not found')).toBeInTheDocument();
  });
});

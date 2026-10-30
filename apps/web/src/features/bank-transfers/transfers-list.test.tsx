import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/** TR — the transfer list: one account's transfers, views, journals, and the form filled from an account. */
const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => search.params, useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => '/finance/accounting/transfers' }));
const banks = [
  { id: 'bank', accountName: 'Salaam operating', bankName: 'Salaam Bank', status: 'ACTIVE', allowsPayments: true, allowsReceipts: true, currencyCode: 'USD', bookBalance: '500.00', kind: 'BANK' },
  { id: 'box', accountName: 'Site cash box', bankName: 'Head office', status: 'ACTIVE', allowsPayments: true, allowsReceipts: true, currencyCode: 'USD', bookBalance: '0.00', kind: 'CASH' },
  { id: 'pb', accountName: 'Premier', bankName: 'Premier Bank', status: 'ACTIVE', allowsPayments: true, allowsReceipts: true, currencyCode: 'USD', bookBalance: '0.00', kind: 'BANK' },
];
vi.mock('@/features/accounting/hooks/use-accounting', () => ({
  accountingKeys: { bankAccounts: () => ['b'] },
  useBankAccounts: () => ({ data: banks, isPending: false, isError: false }),
  useApprovalSettings: () => ({ data: { paymentAutoApproveUpTo: '1000.00' } }),
}));
vi.mock('@/features/auth/session/use-session', () => ({ useSession: () => ({ user: { id: 'me' } }) }));
const transfers = [
  { id: 't1', transferNumber: 'TR-000003', fromBankAccountId: 'bank', fromAccountName: 'Salaam operating', toBankAccountId: 'box', toAccountName: 'Site cash box', amount: '800.00', currencyCode: 'USD', transferDate: '2026-10-16', reference: null, memo: 'Site petty cash', status: 'POSTED', requestedBy: 'me', requestedByName: 'System Admin', approvedByName: null, rejectionReason: null, reversalReason: null, journalEntryId: 'j13', reversalJournalEntryId: null, requestedAt: '', postedAt: '', reversedAt: null, reversedByName: null },
  { id: 't2', transferNumber: null, fromBankAccountId: 'bank', fromAccountName: 'Salaam operating', toBankAccountId: 'pb', toAccountName: 'Premier', amount: '5000.00', currencyCode: 'USD', transferDate: '2026-10-28', reference: null, memo: null, status: 'PENDING_APPROVAL', requestedBy: 'other', requestedByName: 'Amina', approvedByName: null, rejectionReason: null, reversalReason: null, journalEntryId: null, reversalJournalEntryId: null, requestedAt: '', postedAt: null, reversedAt: null, reversedByName: null },
];
vi.mock('./transfers-api', () => ({
  useBankTransfers: () => ({ data: transfers, isPending: false, isError: false }),
  useDecideTransfer: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false }),
  useRequestTransfer: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false }),
}));

import { TransfersList } from './transfers-list';

beforeEach(() => {
  search.params = new URLSearchParams();
});

describe('TransfersList (TR)', () => {
  it('opens each posted transfer’s journal and lets someone else approve a waiting one', () => {
    renderWithProviders(<TransfersList />, { permissions: ['manage:accounting'] });
    const table = screen.getByRole('table', { name: 'Transfers' });
    expect(within(table).getByRole('link', { name: 'TR-000003' })).toHaveAttribute('href', '/finance/accounting/journals/j13');
    expect(within(table).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('shows the waiting ones in their own view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TransfersList />, { permissions: ['manage:accounting'] });
    await user.click(screen.getByRole('tab', { name: /Waiting for approval/ }));
    const table = screen.getByRole('table', { name: 'Transfers' });
    expect(within(table).queryByText('TR-000003')).not.toBeInTheDocument();
    expect(within(table).getByText('Premier')).toBeInTheDocument();
  });

  it('shows one account’s transfers from ?account=', () => {
    search.params = new URLSearchParams('account=pb');
    renderWithProviders(<TransfersList />, { permissions: ['manage:accounting'] });
    expect(screen.getByText('Transfers of Premier')).toBeInTheDocument();
    expect(screen.queryByText('TR-000003')).not.toBeInTheDocument();
  });

  it('opens the form filled from an account and warns when it would go below zero', async () => {
    search.params = new URLSearchParams('new=1&from=bank');
    const user = userEvent.setup();
    renderWithProviders(<TransfersList />, { permissions: ['manage:accounting'] });
    const dialog = await screen.findByRole('dialog', { name: 'New transfer' });
    expect(within(dialog).getByText('Holds $500.00 in the books.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Amount/), '800');
    expect(await within(dialog).findByText('Not enough in the account')).toBeInTheDocument();
  });
});

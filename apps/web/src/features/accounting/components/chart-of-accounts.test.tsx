import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { listAccounts } from '@/features/accounting/api/accounting-api';
import type { Account, AccountVersion } from '@/features/accounting/types';

import { ChartOfAccounts } from './chart-of-accounts';

vi.mock('@/features/accounting/api/accounting-api', () => ({ listAccounts: vi.fn() }));

function version(overrides: Partial<AccountVersion> = {}): AccountVersion {
  return {
    id: 'ver-1',
    accountId: 'acc-1',
    versionNumber: 1,
    name: 'Salaam Bank',
    nameAr: 'بنك سلام',
    parentAccountId: null,
    accountClass: 'ASSET',
    accountSubtype: 'CASH_AND_BANK',
    isPostingAllowed: true,
    isControlAccount: false,
    controlledSubledgerType: null,
    controlPostingPolicy: 'SYSTEM_OR_APPROVED_ADJUSTMENT',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...overrides,
  };
}

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    organizationId: 'org-1',
    code: '10100',
    normalBalance: 'DEBIT',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'user-1',
    versions: [version()],
    ...overrides,
  };
}

/** The seeded AP control account: posting blocked, written only by the posting engine. */
function apControl(): Account {
  return account({
    id: 'acc-ap',
    code: '20000',
    normalBalance: 'CREDIT',
    versions: [
      version({
        accountId: 'acc-ap',
        name: 'Accounts Payable',
        nameAr: 'الدائنون',
        accountClass: 'LIABILITY',
        accountSubtype: 'ACCOUNTS_PAYABLE',
        isPostingAllowed: false,
        isControlAccount: true,
        controlledSubledgerType: 'ACCOUNTS_PAYABLE',
        controlPostingPolicy: 'SYSTEM_ONLY',
      }),
    ],
  });
}

beforeEach(() => {
  vi.mocked(listAccounts).mockReset();
  vi.mocked(listAccounts).mockResolvedValue([account(), apControl()]);
});

describe('ChartOfAccounts', () => {
  it('lists accounts by code with their name', async () => {
    renderWithProviders(<ChartOfAccounts />);

    expect(await screen.findByText('10100')).toBeInTheDocument();
    expect(screen.getByText('Salaam Bank')).toBeInTheDocument();
    expect(screen.getByText('20000')).toBeInTheDocument();
  });

  it('counts what is shown', async () => {
    renderWithProviders(<ChartOfAccounts />);
    expect(await screen.findByText('2 accounts')).toBeInTheDocument();
  });

  /**
   * The distinction that matters on this screen. A control account is not switched off — it
   * is reserved for the posting engine, and someone wondering why their journal will not
   * accept it needs that difference stated rather than a bare "blocked".
   */
  it('marks a control account distinctly from an ordinary one', async () => {
    renderWithProviders(<ChartOfAccounts />);

    await screen.findByText('10100');
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('System or approved adjustment')).toBeInTheDocument();
  });

  it('filters by code', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChartOfAccounts />);

    await user.type(await screen.findByLabelText('Search accounts'), '200');

    expect(screen.queryByText('Salaam Bank')).not.toBeInTheDocument();
    expect(await screen.findByText('1 account')).toBeInTheDocument();
  });

  it('filters by name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChartOfAccounts />);

    await user.type(await screen.findByLabelText('Search accounts'), 'payable');

    expect(screen.getByText('Accounts Payable')).toBeInTheDocument();
    expect(screen.queryByText('Salaam Bank')).not.toBeInTheDocument();
  });

  it('filters by account class', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChartOfAccounts />);

    await screen.findByText('10100');
    await user.selectOptions(screen.getByLabelText('Account class'), 'LIABILITY');

    expect(screen.getByText('Accounts Payable')).toBeInTheDocument();
    expect(screen.queryByText('Salaam Bank')).not.toBeInTheDocument();
  });

  it('says so when a search matches nothing, and offers a way back', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChartOfAccounts />);

    await user.type(await screen.findByLabelText('Search accounts'), 'zzzz');

    expect(screen.getByText('No account matches this search.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Salaam Bank')).toBeInTheDocument();
  });

  it('distinguishes an unseeded chart from a failed load', async () => {
    vi.mocked(listAccounts).mockResolvedValue([]);
    renderWithProviders(<ChartOfAccounts />);

    expect(await screen.findByText('No accounts yet.')).toBeInTheDocument();
    expect(screen.getByText(/accounting has not been set up/)).toBeInTheDocument();
  });

  it('renders in Arabic', async () => {
    renderWithProviders(<ChartOfAccounts />, { locale: 'ar' });

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('دليل الحسابات');
    // The account's own Arabic name, not the English one.
    expect(screen.getByText('بنك سلام')).toBeInTheDocument();
  });

  it('falls back to the English name when an account has no Arabic one', async () => {
    vi.mocked(listAccounts).mockResolvedValue([
      account({ versions: [version({ nameAr: null })] }),
    ]);

    renderWithProviders(<ChartOfAccounts />, { locale: 'ar' });

    expect(await screen.findByText('Salaam Bank')).toBeInTheDocument();
  });

  /**
   * `GET /accounts` returns `versions` with `take: 1` — an account with none is a broken
   * record rather than one with an empty name, and a blank cell would read as the latter.
   */
  it('says when an account has no version rather than rendering a blank name', async () => {
    vi.mocked(listAccounts).mockResolvedValue([account({ versions: [] })]);

    renderWithProviders(<ChartOfAccounts />);

    expect(await screen.findByText('No version on record')).toBeInTheDocument();
  });
});

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { chooseOption } from '@/test/choose-option';
import { getAccountingSetupStatus, listAccounts } from '@/features/accounting/api/accounting-api';
import type { Account, AccountVersion } from '@/features/accounting/types';

import { ChartOfAccounts } from './chart-of-accounts';

vi.mock('@/features/accounting/api/accounting-api', () => ({
  listAccounts: vi.fn(),
  getAccountingSetupStatus: vi.fn(),
}));

const nav = vi.hoisted(() => ({ searchParams: new URLSearchParams(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => nav.searchParams,
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => '/finance/accounting/chart-of-accounts',
}));

function version(overrides: Partial<AccountVersion> = {}): AccountVersion {
  return {
    id: 'ver-1',
    accountId: 'acc-1',
    versionNumber: 1,
    name: 'Salaam Bank',
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
  nav.searchParams = new URLSearchParams();
  nav.replace.mockReset();
  vi.mocked(getAccountingSetupStatus).mockReset();
  vi.mocked(getAccountingSetupStatus).mockResolvedValue({
    canInstall: true,
    reason: 'READY',
    accountCount: 0,
    hasFiscalYear: false,
    hasPolicies: false,
    existingRecords: [],
  });
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
    await chooseOption(user, screen.getByLabelText('Account class'), 'LIABILITY');

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

  /** ADR-040: the old copy claimed the chart "is seeded when the organisation is provisioned". */
  it('does not claim the chart is seeded at provisioning', async () => {
    vi.mocked(listAccounts).mockResolvedValue([]);
    renderWithProviders(<ChartOfAccounts />);

    await screen.findByText('No accounts yet.');
    expect(screen.queryByText(/seeded when the organisation is provisioned/)).not.toBeInTheDocument();
  });

  it('offers an administrator the one-step setup on an empty chart', async () => {
    vi.mocked(listAccounts).mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithProviders(<ChartOfAccounts />, {
      permissions: ['view:accounting', 'manage:accounting'],
    });

    await screen.findByText('No accounts yet.');
    expect(screen.queryByText('An administrator has to set up accounting.')).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Set up accounting' }));
    expect(await screen.findByRole('dialog', { name: 'Set up accounting' })).toBeInTheDocument();
  });

  it('opens the setup dialog from the guide link, and drops the parameter on close', async () => {
    vi.mocked(listAccounts).mockResolvedValue([]);
    nav.searchParams = new URLSearchParams('setup=template');
    const user = userEvent.setup();
    renderWithProviders(<ChartOfAccounts />, {
      permissions: ['view:accounting', 'manage:accounting'],
    });

    const dialog = await screen.findByRole('dialog', { name: 'Set up accounting' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(nav.replace).toHaveBeenCalledWith('/finance/accounting/chart-of-accounts');
    expect(screen.queryByRole('dialog', { name: 'Set up accounting' })).not.toBeInTheDocument();
  });

  it('ignores the guide link once the chart has accounts', async () => {
    nav.searchParams = new URLSearchParams('setup=template');
    vi.mocked(getAccountingSetupStatus).mockResolvedValue({
      canInstall: false,
      reason: 'CHART_NOT_EMPTY',
      accountCount: 2,
      hasFiscalYear: true,
      hasPolicies: true,
      existingRecords: [],
    });
    renderWithProviders(<ChartOfAccounts />, {
      permissions: ['view:accounting', 'manage:accounting'],
    });

    await screen.findByText('10100');
    await waitFor(() => expect(getAccountingSetupStatus).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: 'Set up accounting' })).not.toBeInTheDocument();
  });

  it('explains, instead of offering setup, when other setup records already exist', async () => {
    vi.mocked(listAccounts).mockResolvedValue([]);
    vi.mocked(getAccountingSetupStatus).mockResolvedValue({
      canInstall: false,
      reason: 'PARTIAL_SETUP',
      accountCount: 0,
      hasFiscalYear: false,
      hasPolicies: true,
      existingRecords: ['TAX_CODES', 'BANK_ACCOUNTS'],
    });
    renderWithProviders(<ChartOfAccounts />, {
      permissions: ['view:accounting', 'manage:accounting'],
    });

    expect(
      await screen.findByText(
        'Accounting can’t be set up automatically: this organisation already has tax codes and bank accounts but no chart of accounts. Remove them or add the chart manually.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up accounting' })).not.toBeInTheDocument();
  });

  it('tells anyone else an administrator has to set it up', async () => {
    vi.mocked(listAccounts).mockResolvedValue([]);
    renderWithProviders(<ChartOfAccounts />, { permissions: ['view:accounting'] });

    expect(await screen.findByText('An administrator has to set up accounting.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set up accounting' })).not.toBeInTheDocument();
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

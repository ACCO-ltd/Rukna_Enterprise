import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { getAccountingSetupStatus, getTrialBalance, listAccounts, setAccountStatus } from '@/features/accounting/api/accounting-api';
import type { Account, AccountVersion } from '@/features/accounting/types';

import { ChartOfAccounts } from './chart-of-accounts';

vi.mock('@/features/accounting/api/accounting-api', () => ({
  listAccounts: vi.fn(),
  getAccountingSetupStatus: vi.fn(),
  getTrialBalance: vi.fn(),
  setAccountStatus: vi.fn(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

/** The desktop table for one class (the phone list repeats each row). */
const table = (name: string) => screen.findByRole('table', { name });

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
  vi.mocked(getTrialBalance).mockReset();
  vi.mocked(getTrialBalance).mockResolvedValue({ lines: [] } as never);
});

describe('ChartOfAccounts', () => {
  it('lists accounts by code with their name', async () => {
    renderWithProviders(<ChartOfAccounts />);

    const assets = await table('Assets');
    expect(within(assets).getByText('10100')).toBeInTheDocument();
    expect(within(assets).getByText('Salaam Bank')).toBeInTheDocument();
    expect(within(await table('Liabilities')).getByText('20000')).toBeInTheDocument();
  });

  it('counts the accounts', async () => {
    renderWithProviders(<ChartOfAccounts />);
    expect(await screen.findByText('2 accounts')).toBeInTheDocument();
  });

  /**
   * The distinction that matters on this screen. A control account is not switched off — it
   * is reserved for the posting engine, and someone wondering why their journal will not
   * accept it needs that difference stated rather than a bare "blocked".
   */
  it('marks an account the system keeps distinctly from an ordinary one', async () => {
    renderWithProviders(<ChartOfAccounts />);

    expect(within(await table('Liabilities')).getByText('System')).toBeInTheDocument();
    expect(within(await table('Assets')).queryByText('System')).not.toBeInTheDocument();
  });

  it('nests accounts under their heading, which adds them up, with a total for the class', async () => {
    vi.mocked(listAccounts).mockResolvedValue([
      account({ id: 'h', code: '10000', versions: [version({ accountId: 'h', name: 'Current assets', isPostingAllowed: false, controlPostingPolicy: 'UNRESTRICTED' })] }),
      account({ id: 'b', code: '10100', versions: [version({ accountId: 'b', parentAccountId: 'h' })] }),
      account({ id: 'c', code: '10900', versions: [version({ accountId: 'c', name: 'Petty cash', parentAccountId: 'h' })] }),
    ]);
    vi.mocked(getTrialBalance).mockResolvedValue({
      lines: [
        { accountId: 'b', closingDebit: '2521.00', closingCredit: '0.00' },
        { accountId: 'c', closingDebit: '550.00', closingCredit: '0.00' },
      ],
    } as never);
    renderWithProviders(<ChartOfAccounts />);
    const assets = await table('Assets');
    expect(await within(assets).findByRole('link', { name: '$2,521.00' })).toHaveAttribute('href', '/finance/accounting/ledger?accountId=b');
    // The heading and the class total both read the sum.
    expect(within(assets).getAllByText('$3,071.00')).toHaveLength(2);
    expect(within(assets).getByText('Total assets')).toBeInTheDocument();
  });

  it('hides an inactive account until asked, and makes an account inactive', async () => {
    const user = userEvent.setup();
    vi.mocked(listAccounts).mockResolvedValue([account(), account({ id: 'old', code: '10200', status: 'INACTIVE', versions: [version({ accountId: 'old', name: 'Old bank' })] })]);
    vi.mocked(setAccountStatus).mockResolvedValue(account({ status: 'INACTIVE' }));
    renderWithProviders(<ChartOfAccounts />, { permissions: ['view:accounting', 'manage:accounting'] });
    const assets = await table('Assets');
    expect(within(assets).queryByText('Old bank')).not.toBeInTheDocument();
    expect(screen.getByText('1 account · 1 inactive')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Show inactive'));
    expect(within(await table('Assets')).getByText('Old bank')).toBeInTheDocument();

    await user.click(within(await table('Assets')).getByRole('button', { name: 'Actions for account 10100' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Make inactive' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Make inactive' }));
    expect(vi.mocked(setAccountStatus)).toHaveBeenCalledWith('acc-1', 'INACTIVE');
  });

  it('filters by code', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChartOfAccounts />);

    await user.type(await screen.findByLabelText('Search accounts'), '200');

    expect(screen.queryByText('Salaam Bank')).not.toBeInTheDocument();
    expect(within(await table('Liabilities')).getByText('20000')).toBeInTheDocument();
  });

  it('filters by name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChartOfAccounts />);

    await user.type(await screen.findByLabelText('Search accounts'), 'payable');

    expect(within(await table('Liabilities')).getByText('Accounts Payable')).toBeInTheDocument();
    expect(screen.queryByText('Salaam Bank')).not.toBeInTheDocument();
  });

  it('filters by account class', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChartOfAccounts />);

    await table('Assets');
    await user.click(screen.getByRole('tab', { name: 'Liabilities' }));

    expect(within(await table('Liabilities')).getByText('Accounts Payable')).toBeInTheDocument();
    expect(screen.queryByText('Salaam Bank')).not.toBeInTheDocument();
  });

  it('says so when a search matches nothing, and offers a way back', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChartOfAccounts />);

    await user.type(await screen.findByLabelText('Search accounts'), 'zzzz');

    expect(screen.getByText('No account matches this search.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search accounts'));
    expect(within(await table('Assets')).getByText('Salaam Bank')).toBeInTheDocument();
  });

  it('distinguishes an unseeded chart from a failed load', async () => {
    vi.mocked(listAccounts).mockResolvedValue([]);
    renderWithProviders(<ChartOfAccounts />);

    expect(await screen.findByText('No accounts yet.')).toBeInTheDocument();
    expect(screen.getByText(/Setting up accounting installs/)).toBeInTheDocument();
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

    await table('Assets');
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

    expect(within(await table('Assets')).getByText('No version on record')).toBeInTheDocument();
  });
});

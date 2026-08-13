import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { Account, MigrationReport } from '../types';

/**
 * The opening balance wizard (tenant bootstrap, tier 4).
 *
 * The migration runs once per organisation and cannot be repeated without a reversal, so the
 * assertions here are all about what the screen refuses to submit. Each corresponds to a server
 * failure that would otherwise consume the single attempt.
 */

const mocks = vi.hoisted(() => ({
  useAccounts: vi.fn(),
  useRunOpeningBalance: vi.fn(),
}));

vi.mock('../hooks/use-accounting', () => mocks);

import { OpeningBalanceWizard } from './opening-balance-wizard';

function account(id: string, code: string, subtype: string): Account {
  return {
    id,
    code,
    status: 'ACTIVE',
    versions: [
      {
        id: `${id}-v1`,
        versionNumber: 1,
        name: code,
        nameAr: null,
        accountClass: 'ASSET',
        accountSubtype: subtype,
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
  } as unknown as Account;
}

const CHART = [
  account('a-1', '10100', 'CASH_AND_BANK'),
  account('a-2', '11000', 'ACCOUNTS_RECEIVABLE'),
  account('a-3', '20000', 'ACCOUNTS_PAYABLE'),
];

const mutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAccounts.mockReturnValue({ data: CHART, isPending: false, isError: false });
  mocks.useRunOpeningBalance.mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    error: null,
  });
});

async function fillHeader(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Cutover date'), '2026-01-01');
  await user.type(screen.getByLabelText('Batch reference'), 'OB-2026-01');
  await user.selectOptions(
    screen.getByLabelText('Accounts receivable control account'),
    '11000',
  );
  await user.selectOptions(screen.getByLabelText('Accounts payable control account'), '20000');
}

describe('OpeningBalanceWizard', () => {
  it('states up front that the migration runs only once', () => {
    renderWithProviders(<OpeningBalanceWizard />);

    expect(screen.getByText('This runs once')).toBeInTheDocument();
    expect(screen.getByText(/cannot be run again/i)).toBeInTheDocument();
  });

  /**
   * The AR/AP import shares the same one-shot guard, so deferring it has a consequence the
   * user has to know before they run: those documents cannot be added afterwards.
   */
  it('says the AR and AP import is not on this screen, and why that is consequential', () => {
    renderWithProviders(<OpeningBalanceWizard />);

    expect(screen.getByText('Trial balance only')).toBeInTheDocument();
    expect(screen.getByText(/cannot be added later without reversing it/i)).toBeInTheDocument();
  });

  it('offers only AR-subtype accounts for the AR control account', () => {
    renderWithProviders(<OpeningBalanceWizard />);

    const ar = screen.getByLabelText('Accounts receivable control account') as HTMLSelectElement;
    const codes = [...ar.options].map((o) => o.value).filter(Boolean);

    expect(codes).toEqual(['11000']);
  });

  it('runs the migration when everything checks out', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpeningBalanceWizard />, { permissions: ['manage:account'] });

    await fillHeader(user);
    await user.type(screen.getByLabelText('Trial balance rows'), '10100\t5000\t0');
    await user.type(screen.getByLabelText('Trial balance rows'), '{enter}20000\t0\t5000');

    expect(screen.getByText('The trial balance balances.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Run migration' }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        cutoverDate: '2026-01-01',
        batchReference: 'OB-2026-01',
        arAccountCode: '11000',
        apAccountCode: '20000',
        trialBalance: [
          { accountCode: '10100', debitBalance: 5000 },
          { accountCode: '20000', creditBalance: 5000 },
        ],
      }),
      expect.anything(),
    );
  });

  it('refuses an out-of-balance trial balance and names the difference', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpeningBalanceWizard />);

    await fillHeader(user);
    await user.type(screen.getByLabelText('Trial balance rows'), '10100\t5000\t0');
    await user.type(screen.getByLabelText('Trial balance rows'), '{enter}20000\t0\t4000');

    expect(screen.getByText(/Out of balance by/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run migration' })).toBeDisabled();
  });

  /** The server 404s on the first unknown code and rolls back; all of them are listed here. */
  it('lists every unknown account code at once', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpeningBalanceWizard />);

    await fillHeader(user);
    await user.type(screen.getByLabelText('Trial balance rows'), '99999\t100\t0');
    await user.type(screen.getByLabelText('Trial balance rows'), '{enter}88888\t0\t100');

    expect(screen.getByText(/88888, 99999/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run migration' })).toBeDisabled();
  });

  it('reports an unreadable row rather than dropping it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpeningBalanceWizard />);

    await user.type(screen.getByLabelText('Trial balance rows'), '10100\tabc\t0');

    expect(screen.getByText('Some rows could not be read')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run migration' })).toBeDisabled();
  });

  /** Warned, not blocked — a zero row is not wrong, it just does nothing. */
  it('warns about rows the server will silently skip, without blocking', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpeningBalanceWizard />, { permissions: ['manage:account'] });

    await fillHeader(user);
    await user.type(screen.getByLabelText('Trial balance rows'), '10100\t5000\t0');
    await user.type(screen.getByLabelText('Trial balance rows'), '{enter}20000\t0\t5000');
    await user.type(screen.getByLabelText('Trial balance rows'), '{enter}11000\t0\t0');

    expect(screen.getByText(/will be ignored/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run migration' })).toBeEnabled();
  });

  it('will not run before the cutover details are complete', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OpeningBalanceWizard />);

    await user.type(screen.getByLabelText('Trial balance rows'), '10100\t5000\t0');
    await user.type(screen.getByLabelText('Trial balance rows'), '{enter}20000\t0\t5000');

    expect(screen.getByText('Complete the cutover details above.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run migration' })).toBeDisabled();
  });

  it('renders in Arabic without a missing translation key', () => {
    renderWithProviders(<OpeningBalanceWizard />, { locale: 'ar' });

    expect(screen.getByRole('heading', { name: 'ترحيل الأرصدة الافتتاحية' })).toBeInTheDocument();
  });
});

describe('migration report', () => {
  const report: MigrationReport = {
    batchReference: 'OB-2026-01',
    cutoverDate: '2026-01-01',
    openingBalanceJournalId: 'je-1',
    openingBalanceJournalNumber: 'JE-000001',
    arInvoicesImported: 0,
    apBillsImported: 0,
    reconciliation: [
      {
        label: 'Accounts Receivable',
        glBalance: '10000.00',
        subledgerBalance: '10000.00',
        variance: '0.00',
        reconciled: true,
      },
    ],
    zeroVariance: true,
    readyForCfoApproval: true,
  };

  async function runToReport() {
    mutate.mockImplementation((_body, opts) => opts.onSuccess(report));
    const user = userEvent.setup();
    renderWithProviders(<OpeningBalanceWizard />, { permissions: ['manage:account'] });

    await fillHeader(user);
    await user.type(screen.getByLabelText('Trial balance rows'), '10100\t5000\t0');
    await user.type(screen.getByLabelText('Trial balance rows'), '{enter}20000\t0\t5000');
    await user.click(screen.getByRole('button', { name: 'Run migration' }));
  }

  it('replaces the form with the report, so the one-shot action cannot be repeated', async () => {
    await runToReport();

    expect(screen.getByRole('heading', { name: 'Migration complete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run migration' })).not.toBeInTheDocument();
  });

  it('shows the journal number and the reconciliation result', async () => {
    await runToReport();

    expect(screen.getAllByText('JE-000001').length).toBeGreaterThan(0);
    expect(screen.getByText('Control accounts reconcile')).toBeInTheDocument();
  });

  /** There is no approval endpoint behind `readyForCfoApproval` — it is advice to a person. */
  it('does not present CFO approval as something the system will do', async () => {
    await runToReport();

    expect(screen.getByText(/sign-off happens outside it/i)).toBeInTheDocument();
  });
});

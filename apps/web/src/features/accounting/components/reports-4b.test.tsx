import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { chooseOption } from '@/test/choose-option';
import { pickDate } from '@/test/pick-date';
import {
  getAccountLedger,
  getBalanceSheet,
  getMonthlyPL,
  listAccounts,
  listFiscalYears,
} from '@/features/accounting/api/accounting-api';
import type {
  Account,
  AccountLedger,
  BalanceSheet,
  FiscalYear,
  MonthlyPL,
} from '@/features/accounting/types';

import { AccountLedgerReport, ledgerAccounts, onNormalSide } from './account-ledger';
import { BalanceSheetReport } from './balance-sheet';
import { MonthlyComparisonReport } from './monthly-comparison';

vi.mock('@/features/accounting/api/accounting-api', () => ({
  getBalanceSheet: vi.fn(),
  getAccountLedger: vi.fn(),
  getMonthlyPL: vi.fn(),
  listAccounts: vi.fn(),
  listFiscalYears: vi.fn(),
}));

// The balance sheet and ledger drill into the ledger / journals, so they call `useRouter`, and
// the ledger reads `useSearchParams` to prefill from a drill-down link. The test harness does
// not mount the app router; mock it, as the journal and invoice tests do.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/finance/accounting/ledger',
}));

function account(): Account {
  return {
    id: 'acc-bank',
    organizationId: 'org-1',
    code: '10100',
    normalBalance: 'DEBIT',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'user-1',
    versions: [
      {
        id: 'ver-1',
        accountId: 'acc-bank',
        versionNumber: 1,
        name: 'Salaam Bank',
        parentAccountId: null,
        accountClass: 'ASSET',
        accountSubtype: 'CASH_AND_BANK',
        isPostingAllowed: true,
        isControlAccount: false,
        controlledSubledgerType: null,
        controlPostingPolicy: 'UNRESTRICTED',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ],
  };
}

function balanceSheet(overrides: Partial<BalanceSheet> = {}): BalanceSheet {
  return {
    asOfDate: '2026-01-31',
    generatedAt: '2026-02-01T09:00:00.000Z',
    organizationId: 'org-1',
    assets: {
      label: 'Assets',
      total: '150000.00',
      lines: [
        {
          accountId: 'acc-bank',
          accountCode: '10100',
          accountName: 'Salaam Bank',
          accountSubtype: 'CASH_AND_BANK',
          balance: '150000.00',
        },
      ],
    },
    liabilities: {
      label: 'Liabilities',
      total: '50000.00',
      lines: [
        {
          accountId: 'acc-ap',
          accountCode: '20000',
          accountName: 'Accounts Payable',
          accountSubtype: 'ACCOUNTS_PAYABLE',
          balance: '50000.00',
        },
      ],
    },
    equity: {
      label: 'Equity',
      total: '100000.00',
      lines: [
        {
          accountId: 'acc-re',
          accountCode: '31000',
          accountName: 'Retained Earnings',
          accountSubtype: 'RETAINED_EARNINGS',
          balance: '100000.00',
        },
      ],
    },
    totalLiabilitiesAndEquity: '150000.00',
    balanced: true,
    ...overrides,
  };
}

function ledger(overrides: Partial<AccountLedger> = {}): AccountLedger {
  return {
    accountId: 'acc-bank',
    accountCode: '10100',
    accountName: 'Salaam Bank',
    openingBalance: '10000.00',
    periodDebit: '5000.00',
    periodCredit: '2000.00',
    closingBalance: '13000.00',
    lines: [
      {
        journalEntryId: 'jrn-1',
        journalNumber: 'JE-000001',
        accountingDate: '2026-01-15',
        documentDate: '2026-01-15',
        description: 'Client receipt',
        reference: null,
        debitAmount: '5000.00',
        creditAmount: '0.00',
        runningBalance: '15000.00',
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId: 'jrn-1',
        projectId: null,
        departmentId: null,
        costCenterId: null,
      },
    ],
    ...overrides,
  };
}

function fiscalYear(): FiscalYear {
  return {
    id: 'fy-1',
    organizationId: 'org-1',
    name: 'FY2026',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    retainedEarningsAccountId: 'acc-re',
    status: 'OPEN',
    closedAt: null,
    closedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'user-1',
    periods: [],
  };
}

function monthlyPL(overrides: Partial<MonthlyPL> = {}): MonthlyPL {
  return {
    fiscalYearId: 'fy-1',
    fiscalYearName: 'FY2026',
    columns: [
      {
        periodNumber: 1,
        periodName: 'January 2026',
        revenue: '100000.00',
        costOfSales: '60000.00',
        grossProfit: '40000.00',
        expenses: '15000.00',
        netIncome: '25000.00',
        lines: [
          { accountId: 'acc-rev', accountCode: '42600', accountName: 'Project Revenue', accountClass: 'INCOME', accountSubtype: 'PROJECT_REVENUE', amount: '100000.00' },
          { accountId: 'acc-cos', accountCode: '51000', accountName: 'Materials', accountClass: 'COST_OF_SALES', accountSubtype: 'MATERIAL_COST', amount: '60000.00' },
          { accountId: 'acc-exp', accountCode: '61000', accountName: 'Office', accountClass: 'EXPENSE', accountSubtype: 'ADMINISTRATIVE_EXPENSE', amount: '15000.00' },
        ],
      },
      {
        periodNumber: 2,
        periodName: 'February 2026',
        revenue: '80000.00',
        costOfSales: '50000.00',
        grossProfit: '30000.00',
        expenses: '35000.00',
        netIncome: '-5000.00',
        lines: [
          { accountId: 'acc-rev', accountCode: '42600', accountName: 'Project Revenue', accountClass: 'INCOME', accountSubtype: 'PROJECT_REVENUE', amount: '80000.00' },
          { accountId: 'acc-cos', accountCode: '51000', accountName: 'Materials', accountClass: 'COST_OF_SALES', accountSubtype: 'MATERIAL_COST', amount: '50000.00' },
          { accountId: 'acc-exp', accountCode: '61000', accountName: 'Office', accountClass: 'EXPENSE', accountSubtype: 'ADMINISTRATIVE_EXPENSE', amount: '35000.00' },
        ],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getBalanceSheet).mockReset();
  vi.mocked(getAccountLedger).mockReset();
  vi.mocked(getMonthlyPL).mockReset();
  vi.mocked(listAccounts).mockReset();
  vi.mocked(listFiscalYears).mockReset();

  vi.mocked(getBalanceSheet).mockResolvedValue(balanceSheet());
  vi.mocked(getAccountLedger).mockResolvedValue(ledger());
  vi.mocked(getMonthlyPL).mockResolvedValue(monthlyPL());
  vi.mocked(listAccounts).mockResolvedValue([account()]);
  vi.mocked(listFiscalYears).mockResolvedValue([fiscalYear()]);
});

describe('BalanceSheetReport', () => {
  it('shows the three sections, their accounts and the equation total', async () => {
    renderWithProviders(<BalanceSheetReport />);

    expect(await screen.findByText('Salaam Bank')).toBeInTheDocument();
    expect(screen.getByText('Accounts Payable')).toBeInTheDocument();
    expect(screen.getByText('Retained Earnings')).toBeInTheDocument();
    expect(screen.getByText('Total assets')).toBeInTheDocument();
    expect(screen.getByText('Total liabilities and equity')).toBeInTheDocument();
  });

  /**
   * Assets = Liabilities + Equity is an identity. If it fails, an entry exists that should
   * not, and every figure on the sheet is suspect until that is explained.
   */
  it('leads with an explanation when the equation fails', async () => {
    vi.mocked(getBalanceSheet).mockResolvedValue(
      balanceSheet({ balanced: false, totalLiabilitiesAndEquity: '149000.00' }),
    );

    renderWithProviders(<BalanceSheetReport />);

    expect(await screen.findByText(/cannot fail on its own/)).toBeInTheDocument();
  });

  it('names earnings not yet closed as their own equity lines', async () => {
    vi.mocked(getBalanceSheet).mockResolvedValue(
      balanceSheet({
        equity: {
          label: 'Equity',
          total: '100000.00',
          lines: [
            { accountId: 'PRIOR_YEAR_EARNINGS', accountCode: 'RE', accountName: 'x', accountSubtype: 'RETAINED_EARNINGS', balance: '60000.00' },
            { accountId: 'CURRENT_YEAR_EARNINGS', accountCode: 'CYE', accountName: 'x', accountSubtype: 'CURRENT_YEAR_EARNINGS', balance: '40000.00' },
          ],
        },
      }),
    );

    renderWithProviders(<BalanceSheetReport />);

    expect(await screen.findByText('Earlier years not yet closed')).toBeInTheDocument();
    expect(screen.getByText('Net income this year')).toBeInTheDocument();
  });

  it('asks for a comparison column at the previous year end', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BalanceSheetReport />);

    await screen.findByText('Salaam Bank');
    await user.click(screen.getByRole('button', { name: 'Previous year end' }));

    expect(vi.mocked(getBalanceSheet)).toHaveBeenLastCalledWith(
      expect.objectContaining({ comparativeDate: expect.stringMatching(/-12-31$/) }),
    );
  });
});

describe('AccountLedgerReport', () => {
  it('asks for an account before fetching anything', async () => {
    renderWithProviders(<AccountLedgerReport />);

    expect(await screen.findByText('Choose an account')).toBeInTheDocument();
    expect(vi.mocked(getAccountLedger)).not.toHaveBeenCalled();
  });

  it('loads the ledger once an account is chosen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountLedgerReport />);

    await chooseOption(user, screen.getByLabelText('Account'), 'acc-bank');

    expect((await screen.findAllByText('Client receipt')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Opening balance').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Closing balance').length).toBeGreaterThan(0);
  });

  it('shows the running balance the server computed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountLedgerReport />);

    await chooseOption(user, screen.getByLabelText('Account'), 'acc-bank');

    // The ledger is in the ledger currency (ADR-024).
    const table = await screen.findByRole('table', { name: 'Account ledger' });
    expect(within(table).getByText('$15,000.00')).toBeInTheDocument();
  });

  /** GL-L — a payables or income account reads in credit, not as a negative. */
  it('reads a credit-side account on its own side', async () => {
    const user = userEvent.setup();
    vi.mocked(getAccountLedger).mockResolvedValue(
      ledger({ normalBalance: 'CREDIT', openingBalance: '-1000.00', closingBalance: '-1130.00', lines: [{ ...ledger().lines[0], debitAmount: '0.00', creditAmount: '130.00', runningBalance: '-1130.00' }] }),
    );
    renderWithProviders(<AccountLedgerReport />);
    await chooseOption(user, screen.getByLabelText('Account'), 'acc-bank');
    const table = await screen.findByRole('table', { name: 'Account ledger' });
    expect(within(table).getAllByText('$1,130.00').length).toBeGreaterThan(0);
    expect(within(table).queryByText(/-\$1,130/)).not.toBeInTheDocument();
  });

  /** GL-L — receivables and payables are kept by the system but have ledgers worth reading. */
  it('offers control accounts, not headings', () => {
    const base = account();
    const v = base.versions[0];
    const chart = [
      { ...base, id: 'ar', code: '11000', versions: [{ ...v, isPostingAllowed: false, isControlAccount: true, controlPostingPolicy: 'SYSTEM_ONLY' as const }] },
      { ...base, id: 'h', code: '10000', versions: [{ ...v, isPostingAllowed: false }] },
      base,
    ];
    expect(ledgerAccounts(chart).map((a) => a.code)).toEqual(['10100', '11000']);
    expect(onNormalSide('-1130.00', 'CREDIT')).toBe('1130.00');
    expect(onNormalSide('0.00', 'CREDIT')).toBe('0.00');
  });

  it('distinguishes an empty range from a failure', async () => {
    const user = userEvent.setup();
    vi.mocked(getAccountLedger).mockResolvedValue(ledger({ lines: [] }));

    renderWithProviders(<AccountLedgerReport />);
    await chooseOption(user, screen.getByLabelText('Account'), 'acc-bank');

    expect(
      await screen.findByText('Nothing posted to this account in the period.'),
    ).toBeInTheDocument();
  });

  it('reports a failure to load', async () => {
    const user = userEvent.setup();
    vi.mocked(getAccountLedger).mockRejectedValue(new Error('network'));

    renderWithProviders(<AccountLedgerReport />);
    await chooseOption(user, screen.getByLabelText('Account'), 'acc-bank');

    expect(await screen.findByText('Could not load the ledger.')).toBeInTheDocument();
  });

});

describe('MonthlyComparisonReport', () => {
  it('lists each account by month with a total for the year', async () => {
    renderWithProviders(<MonthlyComparisonReport />);

    expect(await screen.findByText('January 2026')).toBeInTheDocument();
    expect(screen.getByText('February 2026')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Project Revenue')).toBeInTheDocument();
  });

  /** The year column is not on the response — it is summed here, in minor units. */
  it('totals each account across the year', async () => {
    renderWithProviders(<MonthlyComparisonReport />);

    await screen.findByText('January 2026');
    // Revenue 100,000 + 80,000; net income 25,000 − 5,000.
    expect(screen.getAllByText('$180,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText('$20,000.00')).toBeInTheDocument();
  });

  it('selects the only fiscal year rather than opening on an empty picker', async () => {
    renderWithProviders(<MonthlyComparisonReport />);

    expect(await screen.findByText('January 2026')).toBeInTheDocument();
    expect(vi.mocked(getMonthlyPL)).toHaveBeenCalledWith('fy-1');
  });

  it('says when no fiscal year exists at all', async () => {
    vi.mocked(listFiscalYears).mockResolvedValue([]);

    renderWithProviders(<MonthlyComparisonReport />);

    expect(await screen.findByText('No fiscal year has been created.')).toBeInTheDocument();
  });

  it('distinguishes a year with no postings from a failure', async () => {
    vi.mocked(getMonthlyPL).mockResolvedValue(
      monthlyPL({
        columns: [
          { periodNumber: 1, periodName: 'January 2026', revenue: '0.00', costOfSales: '0.00', grossProfit: '0.00', expenses: '0.00', netIncome: '0.00', lines: [] },
        ],
      }),
    );

    renderWithProviders(<MonthlyComparisonReport />);

    expect(await screen.findByText('Nothing was posted in any period of this year.')).toBeInTheDocument();
  });
});

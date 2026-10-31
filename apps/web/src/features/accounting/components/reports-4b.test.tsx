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
      },
      {
        periodNumber: 2,
        periodName: 'February 2026',
        revenue: '80000.00',
        costOfSales: '50000.00',
        grossProfit: '30000.00',
        expenses: '35000.00',
        netIncome: '-5000.00',
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
  it('shows the three sections and the equation total', async () => {
    renderWithProviders(<BalanceSheetReport />);

    expect(await screen.findByText('Assets')).toBeInTheDocument();
    expect(screen.getByText('Liabilities')).toBeInTheDocument();
    expect(screen.getByText('Equity')).toBeInTheDocument();
    expect(screen.getByText('Liabilities and Equity')).toBeInTheDocument();
  });

  it('confirms the sheet balances', async () => {
    renderWithProviders(<BalanceSheetReport />);
    expect(
      await screen.findByText('Assets equal liabilities plus equity'),
    ).toBeInTheDocument();
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
    expect(screen.getByText('The sheet does not balance')).toBeInTheDocument();
  });

  /** Equity carries a figure that is on no account; a reader reconciling it needs to know. */
  it('explains why equity includes current year earnings', async () => {
    renderWithProviders(<BalanceSheetReport />);

    expect(await screen.findByText(/current year’s earnings/)).toBeInTheDocument();
  });

  it('requests a comparative column when a second date is given', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BalanceSheetReport />);

    await screen.findByText('Assets');
    await pickDate(user, screen.getByLabelText('Compare with'), '2025-12-31');

    expect(vi.mocked(getBalanceSheet)).toHaveBeenLastCalledWith(
      expect.objectContaining({ comparativeDate: '2025-12-31' }),
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
  it('shows one row per period with a year-to-date total', async () => {
    renderWithProviders(<MonthlyComparisonReport />);

    expect(await screen.findByText('January 2026')).toBeInTheDocument();
    expect(screen.getByText('February 2026')).toBeInTheDocument();
    expect(screen.getByText('Year to date')).toBeInTheDocument();
  });

  /** Year-to-date is not on the response — it is summed here, in minor units. */
  it('totals the columns across the year', async () => {
    renderWithProviders(<MonthlyComparisonReport />);

    await screen.findByText('January 2026');
    // Revenue 100,000 + 80,000; net income 25,000 − 5,000.
    expect(screen.getByText('180,000.00')).toBeInTheDocument();
    expect(screen.getByText('20,000.00')).toBeInTheDocument();
  });

  it('selects the only fiscal year rather than opening on an empty picker', async () => {
    renderWithProviders(<MonthlyComparisonReport />);

    expect(await screen.findByText('January 2026')).toBeInTheDocument();
    expect(vi.mocked(getMonthlyPL)).toHaveBeenCalledWith('fy-1');
  });

  /**
   * The endpoint answers 200 with a null body for an unknown fiscal year rather than 404
   * (`pl-report.service.ts:180`), so a null has to be read as "not found" here.
   */
  it('treats a null body as a missing fiscal year, not an empty report', async () => {
    vi.mocked(getMonthlyPL).mockResolvedValue(null);

    renderWithProviders(<MonthlyComparisonReport />);

    expect(await screen.findByText('That fiscal year no longer exists.')).toBeInTheDocument();
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
          {
            periodNumber: 1,
            periodName: 'January 2026',
            revenue: '0.00',
            costOfSales: '0.00',
            grossProfit: '0.00',
            expenses: '0.00',
            netIncome: '0.00',
          },
        ],
      }),
    );

    renderWithProviders(<MonthlyComparisonReport />);

    expect(
      await screen.findByText('Nothing was posted in any period of this year.'),
    ).toBeInTheDocument();
  });

});

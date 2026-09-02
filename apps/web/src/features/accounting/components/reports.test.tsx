import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { pickDate } from '@/test/pick-date';
import { getProfitLoss, getTrialBalance } from '@/features/accounting/api/accounting-api';
import type {
  ProfitLoss,
  ProfitLossLine,
  TrialBalance,
  TrialBalanceLine,
} from '@/features/accounting/types';

import { ProfitLossReport } from './profit-loss';
import { TrialBalanceReport } from './trial-balance';

vi.mock('@/features/accounting/api/accounting-api', () => ({
  getTrialBalance: vi.fn(),
  getProfitLoss: vi.fn(),
}));

function tbLine(overrides: Partial<TrialBalanceLine> = {}): TrialBalanceLine {
  return {
    accountId: 'acc-1',
    accountCode: '10100',
    accountName: 'Salaam Bank',
    accountClass: 'ASSET',
    accountSubtype: 'CASH_AND_BANK',
    openingDebit: '0.00',
    openingCredit: '0.00',
    periodDebit: '5000.00',
    periodCredit: '0.00',
    closingDebit: '5000.00',
    closingCredit: '0.00',
    ...overrides,
  };
}

function trialBalance(overrides: Partial<TrialBalance> = {}): TrialBalance {
  return {
    asOfDate: '2026-01-31',
    generatedAt: '2026-02-01T09:00:00.000Z',
    organizationId: 'org-1',
    totalOpeningDebit: '0.00',
    totalOpeningCredit: '0.00',
    totalPeriodDebit: '5000.00',
    totalPeriodCredit: '5000.00',
    totalClosingDebit: '5000.00',
    totalClosingCredit: '5000.00',
    balanced: true,
    lines: [
      tbLine(),
      tbLine({
        accountId: 'acc-2',
        accountCode: '42600',
        accountName: 'Project Revenue',
        accountClass: 'INCOME',
        periodDebit: '0.00',
        periodCredit: '5000.00',
        closingDebit: '0.00',
        closingCredit: '5000.00',
      }),
    ],
    ...overrides,
  };
}

function plLine(overrides: Partial<ProfitLossLine> = {}): ProfitLossLine {
  return {
    accountId: 'acc-rev',
    accountCode: '42600',
    accountName: 'Project Revenue',
    accountClass: 'INCOME',
    accountSubtype: 'PROJECT_REVENUE',
    amount: '100000.00',
    ...overrides,
  };
}

function profitLoss(overrides: Partial<ProfitLoss> = {}): ProfitLoss {
  return {
    fromDate: '2026-01-01',
    toDate: '2026-01-31',
    organizationId: 'org-1',
    generatedAt: '2026-02-01T09:00:00.000Z',
    revenue: { label: 'Revenue', total: '100000.00', lines: [plLine()] },
    costOfSales: {
      label: 'Cost of Sales',
      total: '60000.00',
      lines: [
        plLine({
          accountId: 'acc-cos',
          accountCode: '50303',
          accountName: 'Material Purchase',
          accountClass: 'COST_OF_SALES',
          amount: '60000.00',
        }),
      ],
    },
    grossProfit: '40000.00',
    expenses: {
      label: 'Expenses',
      total: '15000.00',
      lines: [
        plLine({
          accountId: 'acc-exp',
          accountCode: '60100',
          accountName: 'Office Expense',
          accountClass: 'EXPENSE',
          amount: '15000.00',
        }),
      ],
    },
    netIncome: '25000.00',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getTrialBalance).mockReset();
  vi.mocked(getProfitLoss).mockReset();
  vi.mocked(getTrialBalance).mockResolvedValue(trialBalance());
  vi.mocked(getProfitLoss).mockResolvedValue(profitLoss());
});

describe('TrialBalanceReport', () => {
  it('lists each account with its opening, movement and closing columns', async () => {
    renderWithProviders(<TrialBalanceReport />);

    expect(await screen.findByText('Salaam Bank')).toBeInTheDocument();
    expect(screen.getByText('Project Revenue')).toBeInTheDocument();
    expect(screen.getByText('Totals')).toBeInTheDocument();
  });

  it('confirms the ledger is in balance', async () => {
    renderWithProviders(<TrialBalanceReport />);
    expect(await screen.findByText('In balance')).toBeInTheDocument();
  });

  /**
   * A trial balance that does not balance means the ledger holds an entry that should not
   * exist. Everything below it is unreliable until that is explained, so it leads.
   */
  it('leads with an explanation when the ledger does not balance', async () => {
    vi.mocked(getTrialBalance).mockResolvedValue(
      trialBalance({ balanced: false, totalClosingCredit: '4999.00' }),
    );

    renderWithProviders(<TrialBalanceReport />);

    expect(await screen.findByText(/do not equal closing credits/)).toBeInTheDocument();
    expect(screen.getByText(/not a rounding matter/)).toBeInTheDocument();
    expect(screen.getByText('Out of balance')).toBeInTheDocument();
  });

  it('asks the server again when the date changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TrialBalanceReport />);

    await screen.findByText('Salaam Bank');
    await pickDate(user, screen.getByLabelText('As of'), '2026-03-31');

    expect(vi.mocked(getTrialBalance)).toHaveBeenLastCalledWith(
      expect.objectContaining({ asOfDate: '2026-03-31' }),
    );
  });

  it('passes the zero-balance option through', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TrialBalanceReport />);

    await screen.findByText('Salaam Bank');
    await user.click(screen.getByLabelText(/Include accounts with a zero closing balance/));

    expect(vi.mocked(getTrialBalance)).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeZeroBalance: true }),
    );
  });

  it('distinguishes an empty ledger from a failure', async () => {
    vi.mocked(getTrialBalance).mockResolvedValue(trialBalance({ lines: [] }));
    renderWithProviders(<TrialBalanceReport />);

    expect(await screen.findByText('No account carries a balance at this date.')).toBeInTheDocument();
  });

  it('reports a failure to generate', async () => {
    vi.mocked(getTrialBalance).mockRejectedValue(new Error('network'));
    renderWithProviders(<TrialBalanceReport />);

    expect(await screen.findByText('Could not generate the trial balance.')).toBeInTheDocument();
  });

});

describe('ProfitLossReport', () => {
  it('shows revenue, cost of sales, gross profit, expenses and net income', async () => {
    renderWithProviders(<ProfitLossReport />);

    expect(await screen.findByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('Cost of Sales')).toBeInTheDocument();
    expect(screen.getByText('Gross Profit')).toBeInTheDocument();
    expect(screen.getByText('Expenses')).toBeInTheDocument();
    expect(screen.getByText('Net Income')).toBeInTheDocument();
  });

  it('lists the accounts making up each section', async () => {
    renderWithProviders(<ProfitLossReport />);

    expect(await screen.findByText('Project Revenue')).toBeInTheDocument();
    expect(screen.getByText('Material Purchase')).toBeInTheDocument();
    expect(screen.getByText('Office Expense')).toBeInTheDocument();
  });

  /** The number a CEO reads first, and it is not on the response. */
  it('derives the gross margin', async () => {
    renderWithProviders(<ProfitLossReport />);

    // 40,000 gross on 100,000 revenue.
    expect(await screen.findByText('Gross margin 40.0%')).toBeInTheDocument();
  });

  it('does not divide by zero revenue', async () => {
    vi.mocked(getProfitLoss).mockResolvedValue(
      profitLoss({
        revenue: { label: 'Revenue', total: '0.00', lines: [plLine({ amount: '0.00' })] },
        grossProfit: '0.00',
      }),
    );

    renderWithProviders(<ProfitLossReport />);

    await screen.findByText('Gross Profit');
    expect(screen.queryByText(/Gross margin/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  /**
   * "Net Income −25,000" makes the reader do the sign in their head, on the one line they
   * came to read. A loss is named a loss.
   */
  it('names a loss a loss', async () => {
    vi.mocked(getProfitLoss).mockResolvedValue(profitLoss({ netIncome: '-25000.00' }));

    renderWithProviders(<ProfitLossReport />);

    expect(await screen.findByText('Net Loss')).toBeInTheDocument();
    expect(screen.queryByText('Net Income')).not.toBeInTheDocument();
  });

  it('says that closing entries are excluded', async () => {
    renderWithProviders(<ProfitLossReport />);

    expect(await screen.findByText(/closing entries are excluded/)).toBeInTheDocument();
  });

  it('asks the server again when the range changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfitLossReport />);

    await screen.findByText('Revenue');
    await pickDate(user, screen.getByLabelText('From'), '2026-03-01');

    expect(vi.mocked(getProfitLoss)).toHaveBeenLastCalledWith(
      expect.objectContaining({ fromDate: '2026-03-01' }),
    );
  });

  it('distinguishes a period with no postings from a failure', async () => {
    vi.mocked(getProfitLoss).mockResolvedValue(
      profitLoss({
        revenue: { label: 'Revenue', total: '0.00', lines: [] },
        costOfSales: { label: 'Cost of Sales', total: '0.00', lines: [] },
        expenses: { label: 'Expenses', total: '0.00', lines: [] },
        grossProfit: '0.00',
        netIncome: '0.00',
      }),
    );

    renderWithProviders(<ProfitLossReport />);

    expect(await screen.findByText('Nothing was posted in this range.')).toBeInTheDocument();
  });

  it('reports a failure to generate', async () => {
    vi.mocked(getProfitLoss).mockRejectedValue(new Error('network'));
    renderWithProviders(<ProfitLossReport />);

    expect(
      await screen.findByText('Could not generate the profit and loss report.'),
    ).toBeInTheDocument();
  });

});

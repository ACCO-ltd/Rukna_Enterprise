import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { ProfitLoss } from '@/features/accounting/types';

/**
 * The project income statement.
 *
 * Two things are load-bearing. It reports posted general-ledger entries and says so, and its
 * default range is the project's life — the previous screen defaulted to 1 January of the
 * current calendar year, which silently truncated every multi-year job.
 */
const hookMocks = vi.hoisted(() => ({
  useProjectPl: vi.fn(),
  useFinanceOverview: vi.fn(),
}));
const projectMocks = vi.hoisted(() => ({ useProject: vi.fn() }));

vi.mock('../hooks/use-finance', () => hookMocks);
vi.mock('@/features/projects/hooks/use-project', () => projectMocks);

import { ProfitLossView } from './profit-loss-view';

function report(over: Partial<ProfitLoss> = {}): ProfitLoss {
  return {
    fromDate: '2024-01-01',
    toDate: '2026-09-06',
    organizationId: 'o1',
    projectId: 'p1',
    generatedAt: '2026-09-06T00:00:00.000Z',
    revenue: {
      label: 'Revenue',
      total: '720000.00',
      lines: [
        {
          accountId: 'a1',
          accountCode: '42600',
          accountName: 'Project Income',
          accountClass: 'INCOME',
          accountSubtype: 'PROJECT_REVENUE',
          amount: '720000.00',
        },
      ],
    },
    costOfSales: {
      label: 'Cost of Sales',
      total: '465000.00',
      lines: [
        {
          accountId: 'a2',
          accountCode: '50303',
          accountName: 'Material Cost',
          accountClass: 'COST_OF_SALES',
          accountSubtype: 'MATERIAL_COST',
          amount: '465000.00',
        },
      ],
    },
    grossProfit: '255000.00',
    expenses: { label: 'Operating Expenses', total: '0.00', lines: [] },
    netIncome: '255000.00',
    ...over,
  } as ProfitLoss;
}

const overview = (available: boolean, blockers: Array<{ code: string; label: string; detail: string }> = []) => ({
  data: {
    accountingPosition: { available, revenue: null, projectCost: null, grossProfit: null, marginPercent: null, blockers },
    period: { id: 'p9', name: 'September 2026', status: 'OPEN', endDate: '2026-09-30', daysToPeriodEnd: 24 },
  },
  isPending: false,
  isError: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  projectMocks.useProject.mockReturnValue({
    data: { id: 'p1', startDate: '2025-03-01' },
    isPending: false,
    isError: false,
  });
  hookMocks.useFinanceOverview.mockReturnValue(overview(true));
});

describe('ProfitLossView', () => {
  it('renders as a statement, states its basis, and computes gross margin', () => {
    hookMocks.useProjectPl.mockReturnValue({
      data: report(),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<ProfitLossView projectId="p1" />);

    expect(
      screen.getByText('Project profitability based on posted general ledger entries only.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Gross profit')).toBeInTheDocument();
    expect(screen.getByText('Gross margin 35.4%')).toBeInTheDocument();
    expect(screen.getAllByText('Net project income').length).toBeGreaterThan(0);
  });

  /**
   * The regression guard for the default range. Calendar year-to-date truncated multi-year
   * projects and was not even the accounting year, since the fiscal calendar is configurable.
   */
  it('defaults to project to date, anchored on the project start', () => {
    hookMocks.useProjectPl.mockReturnValue({
      data: report(),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<ProfitLossView projectId="p1" />);

    const call = hookMocks.useProjectPl.mock.calls.at(-1);
    expect(call?.[1].fromDate).toBe('2025-03-01');
    expect(screen.getByRole('tab', { name: 'Project to date' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('names a net loss rather than relying on colour', () => {
    hookMocks.useProjectPl.mockReturnValue({
      data: report({ netIncome: '-40000.00' }),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<ProfitLossView projectId="p1" />);

    expect(screen.getAllByText('Net project loss').length).toBeGreaterThan(0);
  });

  /** Two different facts, and they must not look alike. */
  it('distinguishes "accounting not configured" from "nothing posted in range"', () => {
    hookMocks.useProjectPl.mockReturnValue({
      data: report({
        revenue: { label: 'Revenue', total: '0.00', lines: [] },
        costOfSales: { label: 'Cost of Sales', total: '0.00', lines: [] },
        expenses: { label: 'Operating Expenses', total: '0.00', lines: [] },
        grossProfit: '0.00',
        netIncome: '0.00',
      }),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<ProfitLossView projectId="p1" />);
    expect(
      screen.getByText('Nothing has been posted to this project in this range.'),
    ).toBeInTheDocument();
  });

  it('reports the statement as unavailable, with blockers, when accounting is not configured', () => {
    hookMocks.useFinanceOverview.mockReturnValue(
      overview(false, [
        {
          code: 'NO_POSTING_PROFILES',
          label: 'Expense posting profiles',
          detail: 'None is configured.',
        },
      ]),
    );
    hookMocks.useProjectPl.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<ProfitLossView projectId="p1" />);

    expect(screen.getByText('Profit & Loss unavailable')).toBeInTheDocument();
    expect(screen.getByText('Expense posting profiles')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });
});

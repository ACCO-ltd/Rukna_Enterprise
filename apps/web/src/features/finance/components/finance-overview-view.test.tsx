import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFinanceOverviewResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

/**
 * The Finance Overview's job is to say whether its own numbers can be trusted, so these tests
 * are mostly about absence: a missing budget must not become $0, a project with no accounting
 * setup must not report $0 revenue, and the metrics the audit removed must never come back.
 */
const hookMocks = vi.hoisted(() => ({ useFinanceOverview: vi.fn() }));
vi.mock('../hooks/use-finance', () => hookMocks);

import { FinanceOverviewView } from './finance-overview-view';

function overview(
  over: Partial<ProjectFinanceOverviewResponse> = {},
): ProjectFinanceOverviewResponse {
  return {
    projectId: 'p1',
    currency: 'USD',
    financialsVisible: true,
    costPosition: {
      currency: 'USD',
      committed: '350000.00',
      accrued: '337000.00',
      actual: '42000.00',
      committedToDate: '729000.00',
      budgetTotal: '990000.00',
      uncommittedBudget: '261000.00',
      budgetLessActual: '948000.00',
      committedOfBudgetPercent: 35.4,
      accruedOfBudgetPercent: 34,
      actualOfBudgetPercent: 4.2,
    },
    accountingPosition: {
      available: true,
      revenue: '720000.00',
      projectCost: '465000.00',
      grossProfit: '255000.00',
      marginPercent: 35.4,
      blockers: [],
    },
    controls: {
      reconciliation: { state: 'OK', label: 'Reconciled', detail: null },
      accountingSetup: { state: 'OK', label: 'Ready', detail: null },
      costBudget: { state: 'OK', label: 'Baselined', detail: null },
      period: { state: 'OK', label: 'Open', detail: null },
    },
    reconciliation: {
      projectId: 'p1',
      ledgerActual: '42000.00',
      glProcurementCost: '42000.00',
      glNonProcurementCost: '0.00',
      glTotalProjectCost: '42000.00',
      variance: '0.00',
      reconciled: true,
      unattributedBillLines: 0,
      asOf: '2026-09-06T00:00:00.000Z',
    },
    period: {
      id: 'per-9',
      name: 'September 2026',
      status: 'OPEN',
      endDate: '2026-09-30',
      daysToPeriodEnd: 24,
    },
    budget: {
      versionNumber: 2,
      status: 'BASELINED',
      baselinedAt: '2026-09-01T00:00:00.000Z',
      baselinedBy: 'u1',
      hasWorkingDraft: false,
    },
    costByArea: [],
    attention: [],
    activity: [],
    asOf: '2026-09-06T00:00:00.000Z',
    ...over,
  };
}

const ready = (data: ProjectFinanceOverviewResponse) => ({
  data,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
});

beforeEach(() => vi.clearAllMocks());

describe('FinanceOverviewView', () => {
  it('shows the cost stages and the posted accounting position', () => {
    hookMocks.useFinanceOverview.mockReturnValue(ready(overview()));
    renderWithProviders(<FinanceOverviewView projectId="p1" />);

    expect(screen.getByText('Open commitment')).toBeInTheDocument();
    expect(screen.getByText('Accrued')).toBeInTheDocument();
    expect(screen.getByText('Uncommitted budget')).toBeInTheDocument();
    expect(screen.getByText(/720,000/)).toBeInTheDocument();
    // 35.4% is both the margin and the committed-of-budget ratio.
    expect(screen.getAllByText('35.4%').length).toBeGreaterThan(0);

    // Each ratio is drawn as well as written, and names its own numerator.
    expect(
      screen.getByRole('progressbar', { name: 'Open commitment / Budget' }),
    ).toHaveAttribute('aria-valuenow', '35.4');
    expect(screen.getByRole('progressbar', { name: 'Actual / Budget' })).toHaveAttribute(
      'aria-valuenow',
      '4.2',
    );
  });

  /** The bar must be absent, not drawn empty at 0%, when there is no denominator. */
  it('draws no ratio bar when no budget is baselined', () => {
    hookMocks.useFinanceOverview.mockReturnValue(
      ready(
        overview({
          costPosition: {
            ...overview().costPosition,
            budgetTotal: null,
            uncommittedBudget: null,
            committedOfBudgetPercent: null,
            accruedOfBudgetPercent: null,
            actualOfBudgetPercent: null,
          },
        }),
      ),
    );
    renderWithProviders(<FinanceOverviewView projectId="p1" />);

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getAllByText('No basis').length).toBeGreaterThan(0);
  });

  /** The three metrics the audit removed. They must not reappear under any label. */
  it('shows no forecast of any kind', () => {
    hookMocks.useFinanceOverview.mockReturnValue(ready(overview()));
    renderWithProviders(<FinanceOverviewView projectId="p1" />);

    expect(screen.queryByText(/forecast/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Remaining committed')).not.toBeInTheDocument();
    expect(screen.queryByText(/cost consumed/i)).not.toBeInTheDocument();
  });

  /** Finance must not restate Commercial's numbers on a different tax basis. */
  it('does not duplicate the Commercial certified / invoiced / collected block', () => {
    hookMocks.useFinanceOverview.mockReturnValue(ready(overview()));
    renderWithProviders(<FinanceOverviewView projectId="p1" />);

    expect(screen.queryByText('Certified')).not.toBeInTheDocument();
    expect(screen.queryByText('Invoiced')).not.toBeInTheDocument();
    expect(screen.queryByText('Outstanding')).not.toBeInTheDocument();
  });

  it('reports the budget as not baselined rather than as zero', () => {
    hookMocks.useFinanceOverview.mockReturnValue(
      ready(
        overview({
          costPosition: {
            ...overview().costPosition,
            budgetTotal: null,
            uncommittedBudget: null,
            committedOfBudgetPercent: null,
            accruedOfBudgetPercent: null,
            actualOfBudgetPercent: null,
          },
          budget: {
            versionNumber: null,
            status: null,
            baselinedAt: null,
            baselinedBy: null,
            hasWorkingDraft: false,
          },
        }),
      ),
    );
    renderWithProviders(<FinanceOverviewView projectId="p1" />);

    expect(screen.getAllByText('Not baselined').length).toBeGreaterThan(0);
    // A project that has set no budget has not budgeted $0.
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('reports the accounting position as unavailable, with the blockers, when setup is incomplete', () => {
    hookMocks.useFinanceOverview.mockReturnValue(
      ready(
        overview({
          accountingPosition: {
            available: false,
            revenue: null,
            projectCost: null,
            grossProfit: null,
            marginPercent: null,
            blockers: [
              {
                code: 'NO_OPEN_PERIOD',
                label: "Today's accounting period",
                detail: 'No period covering today is OPEN or REOPENED.',
              },
            ],
          },
        }),
      ),
    );
    renderWithProviders(<FinanceOverviewView projectId="p1" />);

    expect(screen.getByText('Accounting position unavailable')).toBeInTheDocument();
    expect(screen.getByText("Today's accounting period")).toBeInTheDocument();
    // Cost is unaffected and still shown.
    expect(screen.getByText('Open commitment')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  /**
   * The case the reconciliation read model exists to get right: non-procurement project cost
   * raises total cost without being a variance.
   */
  it('explains non-procurement cost rather than reporting it as a variance', () => {
    hookMocks.useFinanceOverview.mockReturnValue(
      ready(
        overview({
          reconciliation: {
            ...overview().reconciliation,
            glNonProcurementCost: '5000.00',
            glTotalProjectCost: '47000.00',
            variance: '0.00',
            reconciled: true,
          },
        }),
      ),
    );
    renderWithProviders(<FinanceOverviewView projectId="p1" />);

    expect(screen.getByText('Reconciled')).toBeInTheDocument();
    expect(screen.getByText(/not a reconciliation variance/i)).toBeInTheDocument();
  });

  it('surfaces a reconciliation mismatch as a critical item', () => {
    hookMocks.useFinanceOverview.mockReturnValue(
      ready(
        overview({
          controls: {
            ...overview().controls,
            reconciliation: { state: 'ATTENTION', label: 'Needs review', detail: null },
          },
          reconciliation: {
            ...overview().reconciliation,
            variance: '3250.00',
            reconciled: false,
          },
          attention: [
            {
              code: 'RECONCILIATION_VARIANCE',
              severity: 'CRITICAL',
              title: 'Procurement and the general ledger disagree',
              detail: 'Supplier-bill variance 3250.00.',
              href: '/projects/p1/finance/ledger',
            },
          ],
        }),
      ),
    );
    renderWithProviders(<FinanceOverviewView projectId="p1" />);

    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByText('Procurement and the general ledger disagree')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });

  it('masks money for a caller without financial visibility, rather than showing zero', () => {
    hookMocks.useFinanceOverview.mockReturnValue(
      ready(
        overview({
          financialsVisible: false,
          costPosition: {
            ...overview().costPosition,
            committed: null,
            accrued: null,
            actual: null,
            budgetTotal: null,
            uncommittedBudget: null,
          },
        }),
      ),
    );
    renderWithProviders(<FinanceOverviewView projectId="p1" />);

    expect(screen.getAllByText('Restricted').length).toBeGreaterThan(0);
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('surfaces a load failure with a retry rather than an empty page', () => {
    hookMocks.useFinanceOverview.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    });
    renderWithProviders(<FinanceOverviewView projectId="p1" />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

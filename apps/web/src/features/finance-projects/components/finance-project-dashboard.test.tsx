import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CashflowForecastResponse,
  CommercialPaymentScheduleInstallment,
  FinancePortfolioRow,
  ProjectFinanceOverviewResponse,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';
import { READY, workspaceFixture } from '@/features/commercial/test-fixtures';

import { FinanceProjectDashboard, cashflowGroups, share, stageSegments } from './finance-project-dashboard';
import { switchProjectHref } from './finance-project-picker';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/finance/projects/p1' }));

const state = vi.hoisted(() => ({
  row: undefined as unknown,
  overview: undefined as unknown,
  cashflow: undefined as unknown,
  schedule: undefined as unknown,
  workspace: undefined as unknown,
}));

vi.mock('../hooks', () => ({
  useFinanceProject: () => ({
    isPending: false,
    data: { item: state.row, moneyVisible: true, marginVisible: true, asOf: '2026-10-10T00:00:00.000Z' },
  }),
  useCashflowForecast: () => ({ isPending: false, isError: false, data: state.cashflow }),
  useCanViewProjectPayables: () => true,
}));
vi.mock('@/features/finance/hooks/use-finance', () => ({
  useFinanceOverview: () => ({ isPending: false, isError: false, data: state.overview }),
}));
vi.mock('@/features/commercial/hooks/use-commercial-workspace', () => ({
  useCommercialWorkspace: () => ({ isPending: false, isError: false, data: state.workspace }),
}));
vi.mock('@/features/commercial/hooks/use-commercial', () => ({
  useCommercialCurrentCycle: () => ({ isPending: false, isError: false, data: { paymentSchedule: state.schedule } }),
  useCommercialBilling: () => ({ isPending: false, isError: false, data: { invoices: [], receipts: [], asOf: '2026-10-10T00:00:00.000Z' } }),
}));
vi.mock('@/features/finance/hooks/use-accounting-readiness', () => ({ useAccountingReadiness: () => ({ data: { ready: true, blockers: [] } }) }));
vi.mock('@/features/commercial/components/prepare-invoice-dialog', () => ({
  PrepareInvoiceDialog: ({ installmentId }: { installmentId: string }) => <div role="dialog">prepare {installmentId}</div>,
}));

function row(over: Partial<FinancePortfolioRow> = {}): FinancePortfolioRow {
  return {
    projectId: 'p1',
    code: 'ACCO-CDS-26-0011',
    name: 'House building',
    clientName: 'Abdulsalam Hassan',
    status: 'ACTIVE',
    currency: 'USD',
    contractValue: '500000.00',
    billed: '210000.00',
    billedExclTax: '200000.00',
    collected: '105000.00',
    outstanding: '105000.00',
    overdue: '0.00',
    costToDate: '60000.00',
    committedCost: '90000.00',
    margin: 70,
    readyToBill: { count: 1, draftCount: 0, amount: '150000.00' },
    overdueInvoices: { count: 0, oldestDaysPastDue: null },
    billsToPay: { count: 0, amount: '0.00' },
    ...over,
  };
}

function overview(over: Partial<ProjectFinanceOverviewResponse> = {}): ProjectFinanceOverviewResponse {
  const ok = (label: string) => ({ state: 'OK' as const, label, detail: null });
  return {
    projectId: 'p1',
    currency: 'USD',
    financialsVisible: true,
    costPosition: {
      currency: 'USD',
      committed: '30000.00',
      accrued: '0.00',
      actual: '60000.00',
      committedToDate: '90000.00',
      budgetTotal: '300000.00',
      uncommittedBudget: '210000.00',
      budgetLessActual: '240000.00',
      committedOfBudgetPercent: 30,
      accruedOfBudgetPercent: 0,
      actualOfBudgetPercent: 20,
    },
    accountingPosition: {
      available: true,
      revenue: '200000.00',
      projectCost: '60000.00',
      grossProfit: '140000.00',
      marginPercent: 70,
      blockers: [],
    },
    controls: {
      reconciliation: ok('Reconciled'),
      billing: ok('Reconciled'),
      accountingSetup: ok('Ready'),
      costBudget: ok('Baselined'),
      period: ok('Open'),
    },
    billingReconciliation: { invoicedNet: '200000.00', glRevenue: '200000.00', variance: '0.00', reconciled: true },
    reconciliation: {
      projectId: 'p1',
      ledgerActual: '60000.00',
      glProcurementCost: '60000.00',
      glNonProcurementCost: '0.00',
      glTotalProjectCost: '60000.00',
      variance: '0.00',
      reconciled: true,
      unattributedBillLines: 0,
      asOf: '2026-10-10T00:00:00.000Z',
    },
    period: { id: 'per-10', name: 'October 2026', status: 'OPEN', endDate: '2026-10-31', daysToPeriodEnd: 21 },
    budget: { versionNumber: 1, status: 'BASELINED', baselinedAt: '2026-10-01T00:00:00.000Z', baselinedBy: 'u1', hasWorkingDraft: false },
    costByArea: [],
    attention: [],
    activity: [],
    asOf: '2026-10-10T00:00:00.000Z',
    ...over,
  } as ProjectFinanceOverviewResponse;
}

function stage(over: Partial<CommercialPaymentScheduleInstallment>): CommercialPaymentScheduleInstallment {
  return {
    id: 's1',
    sortOrder: 1,
    name: 'Advance',
    percentage: '0.4000',
    amount: '200000.00',
    amountPaid: '0.00',
    collectionStatus: 'NOT_READY',
    ...over,
  } as CommercialPaymentScheduleInstallment;
}

function cashflow(inflow: string, outflow: string): CashflowForecastResponse {
  const bucket = (kind: 'NOW' | 'PERIOD' | 'LATER', start: string | null) => ({
    key: start ?? kind,
    kind,
    start,
    end: null,
    inflows: { fromInvoices: inflow, fromUnbilledStages: '0.00', fromOpeningReceivables: '0.00', total: inflow },
    outflows: { fromSupplierBills: outflow, fromOpenCommitments: '0.00', fromOpeningPayables: '0.00', total: outflow },
    net: null,
    cumulativeNet: null,
  });
  return {
    currencies: [
      {
        currency: 'USD',
        buckets: [bucket('NOW', null), bucket('PERIOD', '2026-11-01'), bucket('LATER', '2027-05-01')],
        totals: {
          inflows: { fromInvoices: null, fromUnbilledStages: null, fromOpeningReceivables: null, total: '300000.00' },
          outflows: { fromSupplierBills: null, fromOpenCommitments: null, fromOpeningPayables: null, total: '40000.00' },
          net: '260000.00',
        },
        counts: { fromInvoices: 1, fromUnbilledStages: 0, fromOpeningReceivables: 0, fromSupplierBills: 1, fromOpenCommitments: 0, fromOpeningPayables: 0 },
      },
    ],
    bucket: 'MONTH',
    from: '2026-10-10',
    to: '2027-04-30',
    projectId: 'p1',
    basis: {} as CashflowForecastResponse['basis'],
    exclusions: [],
    moneyVisible: true,
    asOf: '2026-10-10T00:00:00.000Z',
  };
}

beforeEach(() => {
  state.row = row();
  state.overview = overview();
  state.cashflow = cashflow('150000.00', '20000.00');
  state.schedule = {
    currency: 'USD',
    contractValue: '500000.00',
    totalCollected: '105000.00',
    installments: [
      stage({ id: 's1', name: 'Advance', collectionStatus: 'PART_PAID', amountPaid: '105000.00' }),
      stage({ id: 's2', sortOrder: 2, name: 'Substructure complete', percentage: '0.3000', amount: '150000.00', collectionStatus: 'READY_TO_BILL' }),
    ],
    variationLines: [],
  };
  state.workspace = workspaceFixture({ todo: [READY] });
});

const render = () => renderWithProviders(<FinanceProjectDashboard projectId="p1" />, { permissions: ['view:financial-position', 'manage:payable'] });

describe('FinanceProjectDashboard — key figures', () => {
  it('shows billed before tax against the contract, and collected against billed', () => {
    render();
    const strip = screen.getByLabelText('Project money at a glance');
    expect(within(strip).getByText('Billed (excl. tax)')).toBeInTheDocument();
    expect(within(strip).getByText('$200,000.00')).toBeInTheDocument();
    expect(within(strip).getByText('40% of contract')).toBeInTheDocument();
    // 105,000 of 210,000 billed incl. tax.
    expect(within(strip).getByText('50% of billed (incl. tax)')).toBeInTheDocument();
    expect(within(strip).getByText('Nothing overdue')).toBeInTheDocument();
    expect(within(strip).getByText('70%')).toBeInTheDocument();
  });

  it('names the overdue amount and age under Outstanding', () => {
    state.row = row({ overdue: '105000.00', overdueInvoices: { count: 1, oldestDaysPastDue: 12 } });
    render();
    expect(screen.getByText('$105,000.00 overdue · oldest 12d')).toBeInTheDocument();
  });

  it('says "No cost yet" instead of a 100% margin, and no share without a contract', () => {
    state.row = row({ costToDate: '0.00', margin: 100, contractValue: null });
    render();
    expect(screen.getByText('No cost yet — nothing coded to this project')).toBeInTheDocument();
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.getByText('No contract yet')).toBeInTheDocument();
    expect(screen.getByText('Nothing billed yet')).toBeInTheDocument();
  });
});

describe('FinanceProjectDashboard — needs action', () => {
  it('lists the billing To do with its command, then bills to pay and controls that ask for work', () => {
    state.row = row({ billsToPay: { count: 2, amount: '35000.00' } });
    state.overview = overview({
      attention: [
        { code: 'BILLS_AWAITING_POSTING', severity: 'WARNING', title: '2 approved bills are not posted', detail: 'Post them so cost is complete.', href: '/finance/accounting/bills' },
        { code: 'NO_BASELINED_BUDGET', severity: 'INFO', title: 'No cost budget', detail: 'Nothing to measure against.', href: null },
      ] as ProjectFinanceOverviewResponse['attention'],
    });
    render();

    expect(screen.getByRole('heading', { name: 'Needs action (3)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prepare invoice' })).toBeInTheDocument();
    expect(screen.getByText('2 supplier bills to pay')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review bills' })).toHaveAttribute('href', '/finance/projects/p1/payables');
    expect(screen.getByText('2 approved bills are not posted')).toBeInTheDocument();
    // "For info" rows sit behind the controls badge, not in the work list.
    expect(screen.queryByText('No cost budget')).toBeNull();
  });

  it('opens the same Prepare invoice dialog the Billing tab uses', async () => {
    render();
    await userEvent.click(screen.getByRole('button', { name: 'Prepare invoice' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('prepare s2');
  });
});

describe('FinanceProjectDashboard — charts and controls', () => {
  it('draws billing progress per stage with its status in words', () => {
    render();
    expect(screen.getByRole('heading', { name: 'Billing progress' })).toBeInTheDocument();
    expect(screen.getByText('Advance')).toBeInTheDocument();
    expect(screen.getByText('Part paid')).toBeInTheDocument();
    expect(screen.getByText('Substructure complete')).toBeInTheDocument();
  });

  it('prints the cash-flow totals beside the chart, and says so when nothing is expected', () => {
    const { unmount } = render();
    expect(screen.getByRole('img', { name: /Cash expected in and out across 2 periods/ })).toBeInTheDocument();
    expect(screen.getByText('$260,000.00')).toBeInTheDocument();
    unmount();

    state.cashflow = cashflow('0.00', '0.00');
    render();
    expect(screen.getByText('Nothing expected in or out yet.')).toBeInTheDocument();
  });

  it('shows budget as "Not baselined", never $0, and explains it', () => {
    state.overview = overview({ costPosition: { ...overview().costPosition, budgetTotal: null, actualOfBudgetPercent: null } });
    render();
    const cost = screen.getByRole('heading', { name: 'Cost against budget' }).closest('section')!;
    expect(within(cost).getByText('Not baselined')).toBeInTheDocument();
    expect(within(cost).getByText(/No cost budget is baselined/)).toBeInTheDocument();
  });

  it('collapses the five controls into one badge that opens the detail', async () => {
    render();
    await userEvent.click(screen.getByRole('button', { name: 'Figures reconciled' }));
    expect(screen.getByText('Can these figures be trusted?')).toBeInTheDocument();
    expect(screen.getByText('Procurement and general ledger')).toBeInTheDocument();
  });

  it('counts the controls that need review', () => {
    state.overview = overview({
      controls: { ...overview().controls, billing: { state: 'ATTENTION', label: 'Needs review', detail: null } },
    });
    render();
    expect(screen.getByRole('button', { name: '1 check to review' })).toBeInTheDocument();
  });

  it('shows activity unsigned with Dr / Cr', () => {
    state.overview = overview({
      activity: [
        {
          id: 'j1',
          date: '2026-10-03',
          description: 'Client invoice INV-000002',
          source: 'Client invoice',
          reference: 'JE-000002',
          amount: '-200000.00',
          sourceDocumentType: 'CLIENT_INVOICE',
          sourceDocumentId: 'inv1',
        },
      ],
    });
    render();
    const item = screen.getByText('Client invoice INV-000002').closest('li')!;
    expect(within(item).getByText('Cr')).toBeInTheDocument();
    expect(within(item).getByText('$200,000.00')).toBeInTheDocument();
  });
});

describe('dashboard helpers', () => {
  it('gives no share without a denominator', () => {
    expect(share('200000.00', '500000.00')).toBe(40);
    expect(share('1.00', null)).toBeNull();
    expect(share('1.00', '0.00')).toBeNull();
  });

  it('splits a stage into collected and billed-unpaid', () => {
    expect(stageSegments({ amount: '100.00', amountPaid: '25.00', collectionStatus: 'PART_PAID' })).toEqual({ collected: 25, billedUnpaid: 75 });
    expect(stageSegments({ amount: '100.00', amountPaid: '0.00', collectionStatus: 'READY_TO_BILL' })).toEqual({ collected: 0, billedUnpaid: 0 });
    expect(stageSegments({ amount: '100.00', amountPaid: null, collectionStatus: 'PAID' })).toEqual({ collected: 100, billedUnpaid: 0 });
  });

  it('keeps only the current and dated periods of the forecast', () => {
    const result = cashflowGroups(cashflow('10.00', '5.00'), 'USD', { now: 'Now', month: (iso) => iso.slice(0, 7) });
    expect(result!.groups.map((g) => g.label)).toEqual(['Now', '2026-11']);
  });

  it('switches project on the same view, never onto the old project’s record', () => {
    expect(switchProjectHref('/finance/projects/a', 'a', 'b')).toBe('/finance/projects/b');
    expect(switchProjectHref('/finance/projects/a/billing', 'a', 'b')).toBe('/finance/projects/b/billing');
    expect(switchProjectHref('/finance/projects/a/billing/invoices/inv-1', 'a', 'b')).toBe('/finance/projects/b/billing');
  });
});

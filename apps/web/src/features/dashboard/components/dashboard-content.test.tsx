import type { DashboardResponse, DashboardTodoItem } from '@erp/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { getDashboard } from '../api';
import { DashboardContent } from './dashboard-content';

vi.mock('../api', () => ({ getDashboard: vi.fn() }));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const OVERDUE: DashboardTodoItem = {
  kind: 'INVOICE_OVERDUE',
  key: 'inv-1',
  tone: 'danger',
  href: '/finance/accounting/invoices/inv-1',
  amount: '12600.00',
  currency: 'USD',
  invoiceNumber: 'INV-2026-0130',
  clientName: 'Hayat Market',
  projectName: 'Hayat Market Renovation',
  dueDate: '2026-09-19',
  daysLate: 9,
};

const READY_TO_BILL: DashboardTodoItem = {
  kind: 'STAGE_READY_TO_BILL',
  key: 'inst-2',
  tone: 'neutral',
  href: '/projects/p1/commercial/billing',
  amount: '123750.00',
  currency: 'USD',
  projectName: 'Hayat Market Renovation',
  stageNumber: 2,
  stageLabel: null,
  milestoneLabel: 'MS-01 Substructure complete',
  verifiedAt: '2026-09-26T10:00:00.000Z',
  draftPrepared: false,
};

function running(overrides: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    organizationName: 'ACCO Ltd',
    stage: 'RUNNING',
    moneyVisible: true,
    projectScope: 'ALL',
    todo: [OVERDUE, READY_TO_BILL],
    figures: [
      {
        currency: 'USD',
        contractValueInProgress: '2289500.00',
        activeProjectCount: 3,
        receivables: {
          outstanding: '70331.00',
          unpaidInvoiceCount: 2,
          overdue: '12600.00',
          overdueInvoiceCount: 1,
          oldestDaysLate: 9,
          aging: { notDue: '57731.00', days1To30: '12600.00', days31To60: '0.00', over60: '0.00' },
        },
        payables: { outstanding: '30020.00', unpaidBillCount: 4, dueThisWeek: '5660.00' },
      },
    ],
    projects: {
      inProgress: [
        {
          id: 'p1',
          code: 'ACC-HDN-26-0005',
          name: 'Hayat Market Renovation',
          clientName: 'Hayat Market',
          status: 'ACTIVE',
          physicalPercent: 49,
          plannedPercent: 55,
          currency: 'USD',
          contractValue: '437500.00',
          outstanding: '12600.00',
          overdue: '12600.00',
        },
        {
          id: 'p2',
          code: 'ACC-WAB-26-0006',
          name: 'Waberi Health Clinic',
          clientName: 'Ministry of Health',
          status: 'ACTIVE',
          physicalPercent: 72,
          plannedPercent: 74,
          currency: 'USD',
          contractValue: '612000.00',
          outstanding: '57731.00',
          overdue: '0.00',
        },
      ],
      inPreparation: [],
      statusCounts: { ACTIVE: 2, DRAFT: 2, CLOSED: 2 },
    },
    activity: [],
    setup: null,
    asOf: '2026-09-28T08:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getDashboard).mockReset();
});

describe('Dashboard — projects running', () => {
  it('leads with the header, the money strip, To do and the portfolio — no primary button', async () => {
    vi.mocked(getDashboard).mockResolvedValue(running());
    renderWithProviders(<DashboardContent />);

    expect(await screen.findByText(/^ACCO Ltd · /)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();

    const strip = screen.getByLabelText('Where the money stands');
    expect(within(strip).getByText('Contract value in progress')).toBeInTheDocument();
    expect(within(strip).getByText('$2,289,500.00')).toBeInTheDocument();
    expect(within(strip).getByText('3 active projects')).toBeInTheDocument();
    expect(within(strip).getByText('1 invoice · 9 days late')).toBeInTheDocument();
    expect(within(strip).getByText('$5,660.00 due this week')).toBeInTheDocument();

    const todo = screen.getByRole('region', { name: 'To do · 2' });
    expect(within(todo).getByText('INV-2026-0130 is 9 days overdue')).toBeInTheDocument();
    expect(within(todo).getByRole('link', { name: 'Open invoice' })).toHaveAttribute(
      'href',
      '/finance/accounting/invoices/inv-1',
    );
    expect(
      within(todo).getByText('Stage 2 of Hayat Market Renovation is ready to bill'),
    ).toBeInTheDocument();
    expect(
      within(todo).getByText('MS-01 Substructure complete was verified on Sep 26, 2026.'),
    ).toBeInTheDocument();
    expect(within(todo).getByRole('link', { name: 'Open billing' })).toHaveAttribute(
      'href',
      '/projects/p1/commercial/billing',
    );

    const aging = screen.getByRole('region', { name: 'Receivables by age' });
    expect(within(aging).getByText('1–30 days late')).toBeInTheDocument();
    expect(within(aging).getByRole('link', { name: 'Invoices' })).toHaveAttribute(
      'href',
      '/finance/accounting/invoices',
    );

    expect(screen.getByText('Projects in progress · 2')).toBeInTheDocument();
    expect(screen.getByText('2 more in preparation · 2 closed')).toBeInTheDocument();
    // 6 points behind is said in words; 2 behind is "On plan".
    expect(screen.getAllByText('6 pts behind plan').length).toBeGreaterThan(0);
    expect(screen.getAllByText('On plan').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$12,600.00 overdue').length).toBeGreaterThan(0);

    // The retired portfolio tiles and sections are gone.
    expect(screen.queryByText('Recently created')).not.toBeInTheDocument();
    expect(screen.queryByText('On site')).not.toBeInTheDocument();
    expect(screen.queryByText('View all projects')).not.toBeInTheDocument();
  });

  it('shows a project manager "My projects" with no money anywhere', async () => {
    const base = running();
    vi.mocked(getDashboard).mockResolvedValue({
      ...base,
      moneyVisible: false,
      projectScope: 'MINE',
      figures: null,
      todo: [{ ...READY_TO_BILL, amount: null, currency: null }],
      projects: {
        ...base.projects,
        inProgress: base.projects.inProgress.map((p) => ({
          ...p,
          contractValue: null,
          outstanding: null,
          overdue: null,
        })),
      },
    });
    renderWithProviders(<DashboardContent />);

    expect(await screen.findByText('My projects · 2')).toBeInTheDocument();
    expect(screen.queryByLabelText('Where the money stands')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Receivables by age' })).not.toBeInTheDocument();
    expect(screen.queryByText('Contract value')).not.toBeInTheDocument();
    expect(screen.queryByText('Client owes')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('hides the money strip rather than showing zeros', async () => {
    vi.mocked(getDashboard).mockResolvedValue(running({ figures: [] }));
    renderWithProviders(<DashboardContent />);
    expect(await screen.findByRole('region', { name: 'To do · 2' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Where the money stands')).not.toBeInTheDocument();
  });

  it('says so when nothing needs the reader', async () => {
    vi.mocked(getDashboard).mockResolvedValue(running({ todo: [] }));
    renderWithProviders(<DashboardContent />);
    expect(await screen.findByText('Nothing needs you right now')).toBeInTheDocument();
    expect(screen.getByText('To do · 0')).toBeInTheDocument();
  });
});

describe('Dashboard — every project in preparation', () => {
  it('lists what each project needs next, with no money strip', async () => {
    vi.mocked(getDashboard).mockResolvedValue(
      running({
        stage: 'PREPARATION',
        todo: [
          {
            kind: 'ACCOUNTING_SETUP_INCOMPLETE',
            key: 'setup',
            tone: 'attention',
            href: '/finance/accounting/guide',
            amount: null,
            currency: null,
            stepsLeft: 6,
          },
          {
            kind: 'PROJECTS_WITHOUT_CONTRACT',
            key: 'no-contract',
            tone: 'neutral',
            href: '/projects',
            amount: null,
            currency: null,
            count: 3,
          },
        ],
        projects: {
          inProgress: [],
          statusCounts: { DRAFT: 2 },
          inPreparation: [
            {
              id: 'p9',
              code: 'ACC-HDN-26-0009',
              name: 'Hayat Market Car Park',
              clientName: 'Hayat Market',
              readiness: { done: 6, total: 6 },
              nextStep: null,
              value: { amount: '185000.00', currency: 'USD', source: 'CONTRACT' },
            },
            {
              id: 'p10',
              code: 'ACC-HDN-26-0010',
              name: 'ACCO Head Office Extension',
              clientName: 'ACCO Ltd',
              readiness: { done: 2, total: 6 },
              nextStep: { code: 'ACTIVE_MAIN_CONTRACT', owner: 'commercialTeam' },
              value: { amount: '90000.00', currency: 'USD', source: 'ESTIMATE' },
            },
          ],
        },
      }),
    );
    renderWithProviders(<DashboardContent />);

    expect(await screen.findByText('In preparation · 2')).toBeInTheDocument();
    expect(screen.queryByLabelText('Where the money stands')).not.toBeInTheDocument();
    expect(screen.getByText("Accounting setup isn't finished")).toBeInTheDocument();
    expect(screen.getByText('3 projects have no contract yet')).toBeInTheDocument();
    expect(screen.getAllByText('Ready to start').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Create and execute the main contract').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Commercial team').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2 of 6').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Estimated value').length).toBeGreaterThan(0);
  });
});

describe('Dashboard — a company with no projects', () => {
  it('shows "Get {company} ready" with actions only for steps the reader may do', async () => {
    vi.mocked(getDashboard).mockResolvedValue(
      running({
        stage: 'NEW',
        todo: [],
        figures: [],
        projects: { inProgress: [], inPreparation: [], statusCounts: {} },
        setup: [
          { code: 'CLIENT', done: true, optional: false, canAct: true },
          { code: 'PROJECT', done: false, optional: false, canAct: true },
          { code: 'ACCOUNTING', done: false, optional: false, canAct: false },
          { code: 'SUPPLIERS', done: false, optional: true, canAct: true },
          { code: 'TEAM', done: false, optional: false, canAct: false },
        ],
      }),
    );
    renderWithProviders(<DashboardContent />);

    expect(await screen.findByRole('heading', { name: 'Get ACCO Ltd ready' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New project' })).toHaveAttribute(
      'href',
      '/projects/new',
    );
    expect(screen.getByRole('link', { name: 'Open procurement' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open accounting setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Invite people' })).not.toBeInTheDocument();
    expect(screen.queryByText(/To do/)).not.toBeInTheDocument();
  });
});

describe('Dashboard — failure', () => {
  it('offers a retry', async () => {
    vi.mocked(getDashboard).mockRejectedValueOnce(new Error('boom')).mockResolvedValue(running());
    renderWithProviders(<DashboardContent />);

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Projects in progress · 2')).toBeInTheDocument();
  });
});

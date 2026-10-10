import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinancePortfolioResponse, FinancePortfolioRow } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  pathname: '/finance/projects',
  search: '',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const api = vi.hoisted(() => ({ getFinancePortfolio: vi.fn(), getFinanceProject: vi.fn() }));
vi.mock('../api', () => api);

import { FinanceProjectsList, orderForFinance, parseQueue } from './finance-projects-list';
import { chartCurrency, topRows } from './finance-portfolio-summary';
import { FinanceProjectWorkspace } from './finance-project-workspace';

const PERMISSION = 'view:financial-position';

function row(over: Partial<FinancePortfolioRow> = {}): FinancePortfolioRow {
  return {
    projectId: 'p1',
    code: 'ACC-01',
    name: 'Mogadishu clinic',
    clientName: 'Hodan Trading',
    status: 'ACTIVE',
    currency: 'USD',
    contractValue: '500000.00',
    billed: '160000.00',
    billedExclTax: '160000.00',
    collected: '50000.00',
    outstanding: '110000.00',
    overdue: '90000.00',
    costToDate: '60000.00',
    committedCost: '170000.00',
    margin: 62.5,
    readyToBill: { count: 2, draftCount: 1, amount: '150000.00' },
    overdueInvoices: { count: 1, oldestDaysPastDue: 40 },
    billsToPay: { count: 2, amount: '35000.00' },
    ...over,
  };
}

function totalsFor(currency: string, projectCount: number, contractValue: string) {
  return {
    currency,
    projectCount,
    contractValue,
    billed: '160000.00',
    billedExclTax: '160000.00',
    collected: '50000.00',
    outstanding: '110000.00',
    overdue: '90000.00',
    costToDate: '60000.00',
    committedCost: '170000.00',
    readyToBill: { count: 2, draftCount: 1, amount: '150000.00' },
    overdueInvoices: { count: 1 },
    billsToPay: { count: 2, amount: '35000.00' },
  };
}

function response(items: FinancePortfolioRow[], over: Partial<FinancePortfolioResponse> = {}): FinancePortfolioResponse {
  return {
    items,
    totals: [
      totalsFor('SOS', 1, '1000.00'),
      totalsFor('USD', 2, '700000.00'),
    ],
    queueCounts: { ALL: items.length, TO_BILL: 1, OVERDUE: 1, TO_PAY: 1 },
    moneyVisible: true,
    marginVisible: true,
    asOf: '2026-10-03T00:00:00.000Z',
    ...over,
  };
}

const quiet = row({
  projectId: 'p2',
  code: 'ACC-02',
  name: 'School',
  margin: null,
  readyToBill: { count: 0, draftCount: 0, amount: '0.00' },
  overdueInvoices: { count: 0, oldestDaysPastDue: null },
  billsToPay: { count: 0, amount: '0.00' },
});

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = '/finance/projects';
  nav.search = '';
});

describe('parseQueue', () => {
  it('accepts the three morning queues and falls back to All', () => {
    expect(parseQueue('TO_BILL')).toBe('TO_BILL');
    expect(parseQueue('OVERDUE')).toBe('OVERDUE');
    expect(parseQueue('TO_PAY')).toBe('TO_PAY');
    expect(parseQueue('CERTIFIED')).toBe('ALL');
    expect(parseQueue(null)).toBe('ALL');
  });
});

describe('FinanceProjectsList', () => {
  const table = () => screen.getByRole('table');

  it('shows the slim table — six columns, sentence case — with needs-action pills', async () => {
    api.getFinancePortfolio.mockResolvedValue(response([row(), quiet]));
    renderWithProviders(<FinanceProjectsList />, { permissions: [PERMISSION] });

    expect(await screen.findAllByText('Mogadishu clinic')).not.toHaveLength(0);
    const headers = within(table()).getAllByRole('columnheader').map((h) => h.textContent?.trim().replace(/[▲▼↑↓]/g, '').trim());
    for (const header of ['Project', 'Client', 'Contract', 'Billed', 'Outstanding', 'Needs action']) {
      expect(headers.some((h) => h?.startsWith(header))).toBe(true);
    }
    for (const gone of ['Collected', 'Cost', 'Margin']) {
      expect(within(table()).queryByRole('columnheader', { name: new RegExp(`^${gone}`) })).toBeNull();
    }
    // Billed share of the contract, before tax: 160,000 of 500,000.
    expect(within(table()).getAllByText('32%').length).toBeGreaterThan(0);
    expect(within(table()).getAllByText('1 stage not prepared').length).toBeGreaterThan(0);
    expect(within(table()).getAllByText('1 draft prepared').length).toBeGreaterThan(0);
    expect(within(table()).getAllByText('1 overdue · 40d').length).toBeGreaterThan(0);
    expect(within(table()).getAllByText('Nothing today').length).toBeGreaterThan(0);
    // No retention or certification anywhere (ACCO bills by milestone).
    expect(screen.queryByText(/retention|certif/i)).toBeNull();
  });

  it('shows one totals strip per currency, never one mixed sum, and folds no-contract projects into a line', async () => {
    api.getFinancePortfolio.mockResolvedValue(
      response([row(), quiet], {
        totals: [totalsFor('SOS', 1, '1000.00'), totalsFor('USD', 2, '700000.00'), { ...totalsFor('USD', 5, '0.00'), currency: null }],
      }),
    );
    renderWithProviders(<FinanceProjectsList />, { permissions: [PERMISSION] });

    const group = await screen.findByRole('group', { name: 'Portfolio totals by currency' });
    expect(within(group).getByLabelText('Portfolio totals in SOS')).toBeInTheDocument();
    expect(within(group).getByLabelText('Portfolio totals in USD')).toBeInTheDocument();
    expect(within(group).getAllByText('Billed (excl. tax)')).toHaveLength(2);
    expect(within(group).getByText('5 projects have no contract yet.')).toBeInTheDocument();
    expect(within(group).queryByText(/No currency/)).toBeNull();
  });

  it('shows the three morning queues as cards with their largest projects and the next step', async () => {
    api.getFinancePortfolio.mockResolvedValue(response([row(), quiet]));
    renderWithProviders(<FinanceProjectsList />, { permissions: [PERMISSION] });

    const queues = await screen.findByRole('group', { name: 'What needs finance today' });
    const toBill = within(queues).getByRole('heading', { name: 'To bill' }).closest('section')!;
    expect(within(toBill).getByRole('link', { name: 'Mogadishu clinic' })).toHaveAttribute('href', '/finance/projects/p1/billing');
    expect(within(toBill).getByText('2 stages ready')).toBeInTheDocument();
    const toPay = within(queues).getByRole('heading', { name: 'To pay' }).closest('section')!;
    expect(within(toPay).getByRole('link', { name: 'Mogadishu clinic' })).toHaveAttribute(
      'href',
      '/finance/projects/p1/transactions?view=bills',
    );
    const overdue = within(queues).getByRole('heading', { name: 'Overdue' }).closest('section')!;
    expect(within(overdue).getByText('1 invoice · oldest 40d')).toBeInTheDocument();
  });

  it('says a queue is clear instead of showing an empty card of zeros', async () => {
    api.getFinancePortfolio.mockResolvedValue(response([quiet], { queueCounts: { ALL: 1, TO_BILL: 0, OVERDUE: 0, TO_PAY: 0 } }));
    renderWithProviders(<FinanceProjectsList />, { permissions: [PERMISSION] });

    expect(await screen.findByText('Nothing is ready to bill.')).toBeInTheDocument();
    expect(screen.getByText('No invoice is overdue.')).toBeInTheDocument();
    expect(screen.getByText('No supplier bill is waiting to be paid.')).toBeInTheDocument();
  });

  it('filters the table from a card’s "Show all"', async () => {
    api.getFinancePortfolio.mockResolvedValue(response([row(), quiet]));
    renderWithProviders(<FinanceProjectsList />, { permissions: [PERMISSION] });

    const queues = await screen.findByRole('group', { name: 'What needs finance today' });
    const overdue = within(queues).getByRole('heading', { name: 'Overdue' }).closest('section')!;
    await userEvent.click(within(overdue).getByRole('button', { name: 'Show all 1 in the table' }));
    expect(nav.replace).toHaveBeenCalledWith('/finance/projects?queue=OVERDUE', { scroll: false });
  });

  it('charts billing progress and who owes the most, with the figures written beside each bar', async () => {
    api.getFinancePortfolio.mockResolvedValue(response([row(), quiet]));
    renderWithProviders(<FinanceProjectsList />, { permissions: [PERMISSION] });

    const billing = await screen.findByRole('list', { name: 'Billing progress by project' });
    expect(within(billing).getAllByText('$160,000.00 of $500,000.00 · 32%').length).toBeGreaterThan(0);
    const owed = screen.getByRole('list', { name: 'Who owes the most' });
    expect(within(owed).getAllByText(/\$90,000\.00 overdue/).length).toBeGreaterThan(0);
  });

  it('opens a project in the Finance workspace from the table', async () => {
    api.getFinancePortfolio.mockResolvedValue(response([row()]));
    renderWithProviders(<FinanceProjectsList />, { permissions: [PERMISSION] });

    await screen.findAllByText('Mogadishu clinic');
    const links = within(table()).getAllByRole('link', { name: /Mogadishu clinic/ });
    expect(links[0]).toHaveAttribute('href', '/finance/projects/p1');
  });

  it('keeps the queue in the URL and asks the API for it', async () => {
    api.getFinancePortfolio.mockResolvedValue(response([row()]));
    const { unmount } = renderWithProviders(<FinanceProjectsList />, { permissions: [PERMISSION] });

    await userEvent.click(await screen.findByRole('tab', { name: 'To bill (1)' }));
    expect(nav.replace).toHaveBeenCalledWith('/finance/projects?queue=TO_BILL', { scroll: false });
    unmount();

    nav.search = 'queue=OVERDUE';
    renderWithProviders(<FinanceProjectsList />, { permissions: [PERMISSION] });
    await waitFor(() => expect(api.getFinancePortfolio).toHaveBeenCalledWith({ queue: 'OVERDUE' }));
    expect(await screen.findByRole('tab', { name: 'Overdue (1)' })).toHaveAttribute('aria-selected', 'true');
  });

  it('refuses a viewer without view:financial-position and never calls the API', () => {
    renderWithProviders(<FinanceProjectsList />, { permissions: ['view:accounting'] });
    expect(screen.getByText("You don't have access to finance projects")).toBeInTheDocument();
    expect(api.getFinancePortfolio).not.toHaveBeenCalled();
  });
});

describe('portfolio landing helpers', () => {
  it('orders the projects that need finance first: overdue, then to bill, then to pay, then by name', () => {
    const overdue = row({ projectId: 'o', name: 'Zeta' });
    const toBill = row({ projectId: 'b', name: 'Beta', overdueInvoices: { count: 0, oldestDaysPastDue: null } });
    const toPay = row({
      projectId: 'p',
      name: 'Alpha',
      overdueInvoices: { count: 0, oldestDaysPastDue: null },
      readyToBill: { count: 0, draftCount: 0, amount: '0.00' },
    });
    const calm = { ...quiet, name: 'Aaa' };
    expect(orderForFinance([calm, toPay, toBill, overdue]).map((r) => r.projectId)).toEqual(['o', 'b', 'p', 'p2']);
  });

  it('lists a queue’s largest projects first, and only those in the queue', () => {
    const small = row({ projectId: 's', billsToPay: { count: 1, amount: '100.00' } });
    const big = row({ projectId: 'b', billsToPay: { count: 1, amount: '900.00' } });
    expect(topRows([small, quiet, big], 'TO_PAY').map((r) => r.projectId)).toEqual(['b', 's']);
  });

  it('charts the currency with the most projects', () => {
    expect(chartCurrency(response([], { totals: [totalsFor('SOS', 1, '1.00'), totalsFor('USD', 4, '1.00')] }))).toBe('USD');
    expect(chartCurrency(response([], { totals: [] }))).toBeNull();
  });
});

describe('FinanceProjectWorkspace', () => {
  it('names the project and links back to the construction workspace, with the three tabs', async () => {
    nav.pathname = '/finance/projects/p1/billing';
    api.getFinanceProject.mockResolvedValue({ item: row(), moneyVisible: true, marginVisible: true, asOf: '2026-10-03T00:00:00.000Z' });
    renderWithProviders(
      <FinanceProjectWorkspace projectId="p1">
        <div>tab body</div>
      </FinanceProjectWorkspace>,
      { permissions: [PERMISSION] },
    );

    expect(await screen.findByText('Mogadishu clinic · ACC-01')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open project/ })).toHaveAttribute('href', '/projects/p1');
    const tabs = screen.getByRole('navigation', { name: 'Project finance' });
    expect(within(tabs).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/finance/projects/p1');
    expect(within(tabs).getByRole('link', { name: 'Billing' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: 'Transactions' })).toHaveAttribute('href', '/finance/projects/p1/transactions');
    // Cost and P&L are no longer tabs: a drill-in and a Transactions view.
    expect(within(tabs).queryByRole('link', { name: 'Cost & commitments' })).toBeNull();
    expect(within(tabs).queryByRole('link', { name: 'P&L' })).toBeNull();
    expect(screen.getByText('tab body')).toBeInTheDocument();
    // The header reads one project, never the whole portfolio.
    expect(api.getFinanceProject).toHaveBeenCalledWith('p1');
    expect(api.getFinancePortfolio).not.toHaveBeenCalled();
  });

  it('switches project from the header picker, loading the list only once it is opened', async () => {
    nav.pathname = '/finance/projects/p1/billing';
    api.getFinanceProject.mockResolvedValue({ item: row(), moneyVisible: true, marginVisible: true, asOf: '2026-10-03T00:00:00.000Z' });
    api.getFinancePortfolio.mockResolvedValue(response([row(), quiet]));
    renderWithProviders(
      <FinanceProjectWorkspace projectId="p1">
        <div>tab body</div>
      </FinanceProjectWorkspace>,
      { permissions: [PERMISSION] },
    );

    const picker = await screen.findByRole('combobox', { name: 'Project' });
    expect(picker).toHaveTextContent('Mogadishu clinic');
    expect(api.getFinancePortfolio).not.toHaveBeenCalled();

    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole('option', { name: /School · ACC-02/ }));
    // Same view, the other project.
    expect(nav.push).toHaveBeenCalledWith('/finance/projects/p2/billing');
  });

  it('reads a project outside the caller’s portfolio as not found', async () => {
    api.getFinanceProject.mockRejectedValue(new ApiError(403, 'Forbidden'));
    renderWithProviders(
      <FinanceProjectWorkspace projectId="someone-elses">
        <div>tab body</div>
      </FinanceProjectWorkspace>,
      { permissions: [PERMISSION] },
    );

    expect(await screen.findByText('Project not found')).toBeInTheDocument();
    expect(screen.queryByText('tab body')).toBeNull();
  });
});

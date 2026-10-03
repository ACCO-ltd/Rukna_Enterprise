import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinancePortfolioResponse, FinancePortfolioRow } from '@erp/types';

import { renderWithProviders } from '@/test/render';

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: '/finance/projects',
  search: '',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const api = vi.hoisted(() => ({ getFinancePortfolio: vi.fn() }));
vi.mock('../api', () => api);

import { FinanceProjectsList, parseQueue } from './finance-projects-list';
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
    collected: '50000.00',
    outstanding: '110000.00',
    overdue: '90000.00',
    costToDate: '60000.00',
    committedCost: '170000.00',
    margin: 62.5,
    readyToBill: { count: 2, amount: '150000.00' },
    overdueInvoices: { count: 1, oldestDaysPastDue: 40 },
    billsToPay: { count: 2, amount: '35000.00' },
    ...over,
  };
}

function response(items: FinancePortfolioRow[], over: Partial<FinancePortfolioResponse> = {}): FinancePortfolioResponse {
  return {
    items,
    totals: {
      currency: 'USD',
      mixedCurrencies: false,
      contractValue: '700000.00',
      billed: '160000.00',
      collected: '50000.00',
      outstanding: '110000.00',
      overdue: '90000.00',
      costToDate: '60000.00',
      committedCost: '170000.00',
      readyToBill: { count: 2, amount: '150000.00' },
      overdueInvoices: { count: 1 },
      billsToPay: { count: 2, amount: '35000.00' },
    },
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
  readyToBill: { count: 0, amount: '0.00' },
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
  it('shows the portfolio with sentence-case headers, totals and needs-action pills', async () => {
    api.getFinancePortfolio.mockResolvedValue(response([row(), quiet]));
    renderWithProviders(<FinanceProjectsList />, { permissions: [PERMISSION] });

    expect(await screen.findAllByText('Mogadishu clinic')).not.toHaveLength(0);
    for (const header of ['Project', 'Client', 'Contract', 'Billed', 'Collected', 'Outstanding', 'Overdue', 'Cost', 'Margin', 'Needs action']) {
      expect(screen.getAllByRole('columnheader', { name: new RegExp(`^${header}`) }).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('2 stages to bill').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 overdue · 40d').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2 bills to pay').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Nothing today').length).toBeGreaterThan(0);
    expect(screen.getAllByText('62.5%').length).toBeGreaterThan(0);
    // No retention or certification anywhere (ACCO bills by milestone).
    expect(screen.queryByText(/retention|certif/i)).toBeNull();
  });

  it('opens a project in the Finance workspace', async () => {
    api.getFinancePortfolio.mockResolvedValue(response([row()]));
    renderWithProviders(<FinanceProjectsList />, { permissions: [PERMISSION] });

    const links = await screen.findAllByRole('link', { name: /Mogadishu clinic/ });
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

describe('FinanceProjectWorkspace', () => {
  it('names the project and links back to the construction workspace, with the four tabs', async () => {
    nav.pathname = '/finance/projects/p1/billing';
    api.getFinancePortfolio.mockResolvedValue(response([row()]));
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
    expect(within(tabs).getByRole('link', { name: 'Cost & commitments' })).toHaveAttribute('href', '/finance/projects/p1/cost');
    expect(within(tabs).getByRole('link', { name: 'P&L' })).toHaveAttribute('href', '/finance/projects/p1/pl');
    expect(screen.getByText('tab body')).toBeInTheDocument();
  });

  it('reads a project outside the caller’s portfolio as not found', async () => {
    api.getFinancePortfolio.mockResolvedValue(response([row()]));
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

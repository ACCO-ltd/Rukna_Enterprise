import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CashflowBucket, CashflowCurrencyForecast, CashflowForecastResponse, FinancePortfolioRow } from '@erp/types';

import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/finance/projects',
  useSearchParams: () => new URLSearchParams(''),
}));

const api = vi.hoisted(() => ({
  getCashflowForecast: vi.fn(),
  getFinancePortfolio: vi.fn(),
  getFinanceProject: vi.fn(),
}));
vi.mock('../api', () => api);

const csv = vi.hoisted(() => ({ exportCsv: vi.fn() }));
vi.mock('@/features/accounting/lib/export-csv', async (orig) => ({
  ...(await orig<typeof import('@/features/accounting/lib/export-csv')>()),
  exportCsv: csv.exportCsv,
}));
const xlsx = vi.hoisted(() => ({ downloadXlsx: vi.fn() }));
vi.mock('@/lib/xlsx-export', () => xlsx);

import { CashflowView } from './cashflow-view';
import { FinanceProjectsList } from './finance-projects-list';

const PERMISSION = 'view:financial-position';

const money = (inv: string, stages: string, bills: string, po: string) => ({
  inflows: {
    fromInvoices: inv,
    fromUnbilledStages: stages,
    fromOpeningReceivables: '0.00',
    total: (Number(inv) + Number(stages)).toFixed(2),
  },
  outflows: {
    fromSupplierBills: bills,
    fromOpenCommitments: po,
    fromOpeningPayables: '0.00',
    total: (Number(bills) + Number(po)).toFixed(2),
  },
  net: (Number(inv) + Number(stages) - Number(bills) - Number(po)).toFixed(2),
});

function bucket(key: string, kind: CashflowBucket['kind'], start: string | null, cumulativeNet: string | null, m = money('0.00', '0.00', '0.00', '0.00')): CashflowBucket {
  return { key, kind, start, end: null, ...m, cumulativeNet };
}

function currency(code: string): CashflowCurrencyForecast {
  return {
    currency: code,
    buckets: [
      bucket('NOW', 'NOW', null, '18000.00', money('25000.00', '0.00', '7000.00', '0.00')),
      bucket('2026-10-05', 'PERIOD', '2026-10-05', '18000.00'),
      bucket('LATER', 'LATER', '2027-01-04', '48000.00', money('0.00', '30000.00', '0.00', '0.00')),
      bucket('UNDATED', 'UNDATED', null, null, money('0.00', '20000.00', '0.00', '4000.00')),
    ],
    totals: money('25000.00', '50000.00', '7000.00', '4000.00'),
    counts: {
      fromInvoices: 1,
      fromUnbilledStages: 2,
      fromOpeningReceivables: 0,
      fromSupplierBills: 1,
      fromOpenCommitments: 2,
      fromOpeningPayables: 0,
    },
  };
}

function response(over: Partial<CashflowForecastResponse> = {}): CashflowForecastResponse {
  return {
    currencies: [currency('SOS'), currency('USD')],
    bucket: 'WEEK',
    from: '2026-10-05',
    to: '2026-12-27',
    projectId: null,
    basis: {
      fromInvoices: 'Invoice basis note.',
      fromUnbilledStages: 'Stage basis note.',
      fromOpeningReceivables: 'Opening receivable basis note.',
      fromSupplierBills: 'Bill basis note.',
      fromOpenCommitments: 'Order basis note.',
      fromOpeningPayables: 'Opening payable basis note.',
    },
    exclusions: ['The cash already in the bank.'],
    moneyVisible: true,
    asOf: '2026-10-07T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('CashflowView', () => {
  it('shows the forecast table with split inflows/outflows, net, cumulative and the assumptions', async () => {
    api.getCashflowForecast.mockResolvedValue(response());
    renderWithProviders(<CashflowView />, { permissions: [PERMISSION] });

    const table = await screen.findByRole('region', { name: 'Cash flow in SOS' });
    for (const header of ['Period', 'Money in', 'Money out', 'Net', 'Cumulative net', 'Issued invoices', 'Stages not yet invoiced', 'Supplier bills', 'Open purchase orders', 'Opening balances — receivable', 'Opening balances — payable']) {
      expect(within(table).getAllByRole('columnheader', { name: header }).length).toBeGreaterThan(0);
    }
    expect(within(table).getByText('Overdue / now')).toBeInTheDocument();
    expect(within(table).getByText('Week of 5 Oct 2026')).toBeInTheDocument();
    expect(within(table).getByText('From 4 Jan 2027')).toBeInTheDocument();
    expect(within(table).getByText('Undated')).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'Total' })).toBeInTheDocument();
    expect(screen.getByText('Stage basis note.')).toBeInTheDocument();
    expect(screen.getByText('Opening payable basis note.')).toBeInTheDocument();
    expect(screen.getByText('The cash already in the bank.')).toBeInTheDocument();
    expect(api.getCashflowForecast).toHaveBeenCalledWith({ projectId: undefined, bucket: 'WEEK' });
  });

  it('switches currency and bucket size without mixing currencies', async () => {
    api.getCashflowForecast.mockResolvedValue(response());
    const user = userEvent.setup();
    renderWithProviders(<CashflowView projectId="p1" />, { permissions: [PERMISSION] });

    await screen.findByRole('region', { name: 'Cash flow in SOS' });
    await user.click(screen.getByRole('tab', { name: 'USD' }));
    expect(await screen.findByRole('region', { name: 'Cash flow in USD' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Cash flow in SOS' })).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Monthly' }));
    await waitFor(() => expect(api.getCashflowForecast).toHaveBeenLastCalledWith({ projectId: 'p1', bucket: 'MONTH' }));
  });

  it('exports the table to CSV (a currency column) and to Excel (a sheet per currency)', async () => {
    api.getCashflowForecast.mockResolvedValue(response());
    const user = userEvent.setup();
    renderWithProviders(<CashflowView />, { permissions: [PERMISSION] });
    await screen.findByRole('region', { name: 'Cash flow in SOS' });

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    const [filename, headers, rows] = csv.exportCsv.mock.calls[0]!;
    expect(filename).toBe('cash-flow-week-2026-10-05.csv');
    expect(headers[0]).toBe('Currency');
    expect(rows[0]).toEqual(['SOS', 'Overdue / now', 25000, 0, 0, 25000, 7000, 0, 0, 7000, 18000, 18000]);
    expect(rows.filter((r: unknown[]) => r[1] === 'Total')).toHaveLength(2); // one total per currency

    await user.click(screen.getByRole('button', { name: 'Export Excel' }));
    const [, sheets] = xlsx.downloadXlsx.mock.calls[0]!;
    expect(sheets.map((s: { name: string }) => s.name)).toEqual(['SOS', 'USD']);
  });

  it('shows the lock state without the permission and never calls the API', () => {
    renderWithProviders(<CashflowView />, { permissions: [] });
    expect(screen.getByText("You don't have access to finance projects")).toBeInTheDocument();
    expect(api.getCashflowForecast).not.toHaveBeenCalled();
  });

  it('says so when there is nothing to forecast', async () => {
    api.getCashflowForecast.mockResolvedValue(response({ currencies: [] }));
    renderWithProviders(<CashflowView />, { permissions: [PERMISSION] });
    expect(await screen.findByText('Nothing to forecast yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });
});

describe('FinanceProjectsList export', () => {
  const row: FinancePortfolioRow = {
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
    readyToBill: { count: 1, draftCount: 0, amount: '50000.00' },
    overdueInvoices: { count: 1, oldestDaysPastDue: 40 },
    billsToPay: { count: 0, amount: '0.00' },
  };

  it('exports the queue rows with the screen columns and one totals line per currency', async () => {
    api.getFinancePortfolio.mockResolvedValue({
      items: [row],
      totals: [
        {
          currency: 'USD',
          projectCount: 1,
          contractValue: '500000.00',
          billed: '160000.00',
          billedExclTax: '160000.00',
          collected: '50000.00',
          outstanding: '110000.00',
          overdue: '90000.00',
          costToDate: '60000.00',
          committedCost: '170000.00',
          readyToBill: { count: 1, draftCount: 0, amount: '50000.00' },
          overdueInvoices: { count: 1 },
          billsToPay: { count: 0, amount: '0.00' },
        },
      ],
      queueCounts: { ALL: 1, TO_BILL: 1, OVERDUE: 1, TO_PAY: 0 },
      moneyVisible: true,
      marginVisible: true,
      asOf: '2026-10-07T08:00:00.000Z',
    });
    const user = userEvent.setup();
    renderWithProviders(<FinanceProjectsList />, { permissions: [PERMISSION] });
    await screen.findAllByText('Mogadishu clinic');

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    const [filename, headers, rows] = csv.exportCsv.mock.calls[0]!;
    expect(filename).toBe('finance-projects-2026-10-07.csv');
    expect(headers).toEqual([
      'Code',
      'Project',
      'Status',
      'Client',
      'Currency',
      'Contract',
      'Billed (excl. tax)',
      'Collected',
      'Outstanding',
      'Overdue',
      'Cost',
      'Margin',
      'Needs action',
    ]);
    expect(rows[0]).toEqual([
      'ACC-01',
      'Mogadishu clinic',
      'Active',
      'Hodan Trading',
      'USD',
      500000,
      160000,
      50000,
      110000,
      90000,
      60000,
      62.5,
      '1 overdue · 40d; 1 stage not prepared',
    ]);
    expect(rows[1]).toEqual(['Total USD', null, null, null, 'USD', 500000, 160000, 50000, 110000, 90000, 60000, null, null]);

    await user.click(screen.getByRole('button', { name: 'Export Excel' }));
    expect(xlsx.downloadXlsx).toHaveBeenCalledWith('finance-projects-2026-10-07.csv', [
      expect.objectContaining({ name: 'Projects', rows: [headers, ...rows] }),
    ]);
  });
});

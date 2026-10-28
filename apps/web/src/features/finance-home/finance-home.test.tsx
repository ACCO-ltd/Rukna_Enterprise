import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { FinanceHome } from './finance-home';

const mocks = vi.hoisted(() => ({ home: vi.fn(), guide: vi.fn() }));
vi.mock('./hooks', () => ({ useFinanceHome: () => mocks.home() }));
vi.mock('@/features/approvals/hooks', () => ({ useApprovalsInbox: () => ({ data: { count: 3, items: [] } }) }));
vi.mock('@/features/finance/hooks/use-accounting-guide', () => ({
  useAccountingGuide: () => mocks.guide(),
  findCycle: (guide: { cycles: Array<{ key: string }> } | undefined, key: string) => guide?.cycles.find((c) => c.key === key),
}));

const data = {
  asOf: '2026-10-28',
  cash: { total: '18400.00', accounts: [{ bankAccountId: 'b1', bankName: 'Premier Bank', accountName: 'Operating', balance: '18400.00' }] },
  receivables: {
    outstanding: '1050.00',
    overdue: '650.00',
    aging: [
      { key: 'current', amount: '400.00', count: 1 },
      { key: 'd1_30', amount: '0.00', count: 0 },
      { key: 'd31_60', amount: '650.00', count: 1 },
      { key: 'd61_90', amount: '0.00', count: 0 },
      { key: 'd90_plus', amount: '0.00', count: 0 },
    ],
    topOverdue: [{ clientId: 'c1', clientName: 'Water Agency', overdue: '650.00', oldestDaysLate: 45 }],
  },
  payables: { outstanding: '900.00', overdue: '0.00', dueThisWeek: '300.00', dueThisWeekCount: 1 },
  month: { from: '2026-10-01', to: '2026-10-31', invoiced: '1050.00', collected: '400.00', paid: '250.00' },
};

describe('FinanceHome (Step 4)', () => {
  it('shows the money with every figure linking to its list', async () => {
    mocks.home.mockReturnValue({ data, isPending: false, isError: false });
    mocks.guide.mockReturnValue({ data: { ready: true, cycles: [] } });
    renderWithProviders(<FinanceHome />);

    expect(screen.getByRole('link', { name: /Cash in the bank.*\$18,400\.00/ })).toHaveAttribute('href', '/finance/accounting/bank-accounts');
    expect(screen.getByText('$650.00 overdue')).toBeInTheDocument();
    expect(screen.getByText('$300.00 due this week (1 bill)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Waiting on you.*3/ })).toHaveAttribute('href', '/approvals');

    const aging = screen.getByRole('table', { name: 'What clients owe, by age' });
    expect(within(aging).getByRole('row', { name: /31–60 days late 1 \$650\.00/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Water Agency' })).toHaveAttribute('href', '/finance/accounting/invoices?clientId=c1');
    expect(screen.queryByText('Finish setting up finance')).toBeNull();
  });

  it('leads with the setup checklist until setup is complete', () => {
    mocks.home.mockReturnValue({ data, isPending: false, isError: false });
    mocks.guide.mockReturnValue({
      data: {
        ready: false,
        cycles: [{ key: 'setup', title: 'Setup', summary: '', status: 'IN_PROGRESS', steps: [
          { key: 'chart-of-accounts', label: 'Chart of accounts', detail: '', status: 'DONE', href: '/x' },
          { key: 'fiscal-year', label: 'Open the fiscal year', detail: '', status: 'NEXT', href: '/finance/accounting/periods' },
        ] }],
      },
    });
    renderWithProviders(<FinanceHome />);
    expect(screen.getByText('1 of 2 steps done')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Next: Open the fiscal year/ })).toHaveAttribute('href', '/finance/accounting/periods');
  });

  it('shows only the sections the reader may see', () => {
    mocks.home.mockReturnValue({ data: { ...data, cash: null, payables: null, month: null }, isPending: false, isError: false });
    mocks.guide.mockReturnValue({ data: undefined });
    renderWithProviders(<FinanceHome />);
    expect(screen.queryByText('Cash in the bank')).toBeNull();
    expect(screen.queryByText('This month')).toBeNull();
    expect(screen.getByText('Clients owe')).toBeInTheDocument();
  });
});

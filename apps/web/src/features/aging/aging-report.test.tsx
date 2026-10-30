import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgingReport as AgingReportData } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { AgingReport } from './aging-report';

const zero = { current: '0.00', d1_30: '0.00', d31_60: '0.00', d61_90: '0.00', d90_plus: '0.00' };
const report: AgingReportData = {
  side: 'payables',
  asOf: '2026-03-31',
  totals: { ...zero, current: '100.00', d90_plus: '500.00' },
  total: '600.00',
  rows: [
    {
      partyId: 's1', partyCode: 'SUP-000001', partyName: 'Horn Cement', total: '500.00', oldestDaysLate: 120,
      buckets: { ...zero, d90_plus: '500.00' },
      documents: [{ id: 'b1', number: 'OPEN-1', date: '2025-11-01', dueDate: '2025-12-01', outstanding: '500.00', daysLate: 120, bucket: 'd90_plus', opening: true }],
    },
    {
      partyId: 's2', partyCode: 'SUP-000002', partyName: 'Blue Nile Timber', total: '100.00', oldestDaysLate: 0,
      buckets: { ...zero, current: '100.00' },
      documents: [{ id: 'b2', number: 'BILL-0007', date: '2026-03-20', dueDate: '2026-04-19', outstanding: '100.00', daysLate: 0, bucket: 'current', opening: false }],
    },
  ],
};

const receivables: AgingReportData = {
  side: 'receivables',
  asOf: '2026-10-30',
  historical: false,
  totals: { ...zero, current: '1000.00', d1_30: '397.00' },
  total: '1397.00',
  onAccount: '100.00',
  netTotal: '1297.00',
  retentionHeld: '0.00',
  ledger: { balance: '1397.00', difference: '0.00', agrees: true },
  rows: [
    {
      partyId: 'c1', partyCode: 'CLI-HRG', partyName: 'Hargeisa Water Agency', total: '397.00', oldestDaysLate: 1,
      buckets: { ...zero, d1_30: '397.00' }, onAccount: '100.00', netBalance: '297.00', retentionHeld: '0.00',
      documents: [{ id: 'i1', number: 'INV-000005', date: '2026-10-29', dueDate: '2026-10-29', outstanding: '397.00', daysLate: 1, bucket: 'd1_30', opening: false }],
    },
    {
      partyId: 'c2', partyCode: 'CLI-BPS', partyName: 'Berbera Port Services', total: '1000.00', oldestDaysLate: 0,
      buckets: { ...zero, current: '1000.00' }, onAccount: '0.00', netBalance: '1000.00', retentionHeld: '0.00',
      documents: [{ id: 'i2', number: 'INV-2026-0011', date: '2026-10-30', dueDate: '2026-11-29', outstanding: '1000.00', daysLate: 0, bucket: 'current', opening: false }],
    },
  ],
};

const api = vi.hoisted(() => ({ getAgingReport: vi.fn() }));
vi.mock('./api', () => api);
vi.mock('@erp/ui', async (original) => ({
  ...(await original<object>()),
  DatePicker: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

beforeEach(() => {
  api.getAgingReport.mockReset().mockImplementation(async (side: string) => (side === 'payables' ? report : receivables));
});

describe('AgingReport (Step 6)', () => {
  it('shows each supplier by age, and opens to the bills behind the figures', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgingReport side="payables" />);

    const table = await screen.findByRole('table', { name: 'What we owe suppliers' });
    expect(screen.getByText('$600.00 open as of Mar 31, 2026')).toBeInTheDocument();
    const horn = within(table).getByRole('row', { name: /Horn Cement/ });
    expect(horn).toHaveTextContent('$500.00');
    expect(within(table).getAllByRole('row').at(-2)).toHaveTextContent('Total');
    expect(within(table).getAllByRole('row').at(-1)).toHaveTextContent('Share of total');

    await user.click(within(horn).getByRole('button', { name: /Horn Cement/ }));
    const docs = screen.getByRole('list', { name: 'Open documents of Horn Cement' });
    expect(within(docs).getByRole('link', { name: 'OPEN-1' })).toHaveAttribute('href', '/finance/accounting/bills/b1');
    expect(docs).toHaveTextContent('120 days late · opening balance');
  });

  it('receivables: paid in advance and net owed per client, and the ledger check', async () => {
    renderWithProviders(<AgingReport side="receivables" />);
    const table = await screen.findByRole('table', { name: 'What clients owe' });
    const row = within(table).getByRole('row', { name: /Hargeisa Water Agency/ });
    expect(row).toHaveTextContent('−$100.00');
    expect(row).toHaveTextContent('$297.00');
    expect(screen.getByText('Agrees with Accounts receivable in the ledger ($1,397.00).')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Statement of Hargeisa Water Agency' })).toHaveAttribute(
      'href',
      '/finance/accounting/statement?clientId=c1&from=2026-01-01&to=2026-10-30',
    );
  });

  it('receivables: late only hides clients with nothing late; a past day asks the server for that day', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgingReport side="receivables" />);
    const table = await screen.findByRole('table', { name: 'What clients owe' });
    await user.click(screen.getByLabelText('Late only'));
    expect(within(table).queryByRole('row', { name: /Berbera Port Services/ })).toBeNull();

    fireEvent.change(screen.getByLabelText('As of'), { target: { value: '2026-09-30' } });
    await waitFor(() => expect(api.getAgingReport).toHaveBeenLastCalledWith('receivables', '2026-09-30'));
  });

  it('receivables: says when the ledger does not agree', async () => {
    api.getAgingReport.mockResolvedValue({ ...receivables, ledger: { balance: '1400.00', difference: '-3.00', agrees: false } });
    renderWithProviders(<AgingReport side="receivables" />);
    expect(await screen.findByText(/the open invoices differ by -\$3.00/)).toBeInTheDocument();
  });

  it('payables: names opening balances not yet in the ledger as the cause of the gap', async () => {
    api.getAgingReport.mockResolvedValue({ ...report, ledger: { balance: '100.00', difference: '500.00', agrees: false } });
    renderWithProviders(<AgingReport side="payables" />);
    expect(await screen.findByText(/exactly the opening balances carried in from the old system \(\$500.00\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Opening balances' })).toHaveAttribute('href', '/finance/accounting/opening-balance');
  });
});

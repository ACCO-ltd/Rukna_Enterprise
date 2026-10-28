import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

vi.mock('./api', () => ({ getAgingReport: vi.fn(async () => report) }));

describe('AgingReport (Step 6)', () => {
  it('shows each supplier by age, and opens to the bills behind the figures', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgingReport side="payables" />);

    const table = await screen.findByRole('table', { name: 'What we owe suppliers' });
    expect(screen.getByText('$600.00 open as of Mar 31, 2026')).toBeInTheDocument();
    const horn = within(table).getByRole('row', { name: /Horn Cement/ });
    expect(horn).toHaveTextContent('$500.00');
    expect(within(table).getAllByRole('row').at(-1)).toHaveTextContent('Total');

    await user.click(within(horn).getByRole('button', { name: /Horn Cement/ }));
    const docs = screen.getByRole('list', { name: 'Open documents of Horn Cement' });
    expect(within(docs).getByRole('link', { name: 'OPEN-1' })).toHaveAttribute('href', '/finance/accounting/bills/b1');
    expect(docs).toHaveTextContent('120 days late · opening balance');
  });
});

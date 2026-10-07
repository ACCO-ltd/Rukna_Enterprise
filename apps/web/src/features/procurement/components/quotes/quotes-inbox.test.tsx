import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { rowFixture } from '../../quotations/test-fixtures';

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../api/quotations-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listQuotationRequests: (...args: unknown[]) => api.list(...args),
}));

import { QuotesInbox } from './quotes-inbox';

beforeEach(() => {
  api.list.mockReset();
});

describe('QuotesInbox — "Quotes to choose"', () => {
  it('asks for the decide queue and lists the longest wait first, tone written as well as coloured', async () => {
    api.list.mockResolvedValue({
      items: [
        rowFixture({ id: 'a', waitingWorkingMinutes: 20, slaTone: 'none' }),
        rowFixture({ id: 'b', waitingWorkingMinutes: 250, slaTone: 'red' }),
        rowFixture({ id: 'c', waitingWorkingMinutes: 125, slaTone: 'amber', exceptionReason: 'URGENT', distinctSupplierCount: 1 }),
      ],
      total: 3,
    });
    renderWithProviders(<QuotesInbox />, { permissions: ['view:procurement', 'award:quotation'] });

    const links = await screen.findAllByRole('link', { name: /MR-/ });
    // The grid renders a table and phone cards; each lists the rows in the same order.
    const hrefs = [...new Set(links.map((link) => link.getAttribute('href')))];
    expect(hrefs).toEqual(['/finance/quotes/b', '/finance/quotes/c', '/finance/quotes/a']);
    expect(api.list).toHaveBeenCalledWith({ queue: 'decide' });

    const red = screen.getAllByText('Over 4 h')[0]!;
    expect(red.closest('[data-sla]')).toHaveAttribute('data-sla', 'red');
    const amber = screen.getAllByText('Over 2 h')[0]!;
    expect(amber.closest('[data-sla]')).toHaveAttribute('data-sla', 'amber');
    expect(screen.getAllByText('Urgent').length).toBeGreaterThan(0);
  });

  it('says so when nothing is waiting', async () => {
    api.list.mockResolvedValue({ items: [], total: 0 });
    renderWithProviders(<QuotesInbox />, { permissions: ['view:procurement', 'award:quotation'] });
    expect(await screen.findByText('Nothing to choose')).toBeInTheDocument();
  });
});

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../api/quotations-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listQuotationRequests: (...args: unknown[]) => api.list(...args),
}));

import { QuotesList } from './quotes-list';

beforeEach(() => {
  api.list.mockReset();
  api.list.mockResolvedValue({ items: [], page: 1, limit: 25, total: 0 });
});

describe('QuotesList — the buyer queues', () => {
  it('asks for the buyer own requests to collect, and every award to raise', async () => {
    const user = userEvent.setup();
    renderWithProviders(<QuotesList />, { permissions: ['view:procurement', 'collect:quotation'] });
    expect(await screen.findByText('Nothing to collect')).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith({ queue: 'collect', mine: true });

    await user.click(screen.getByRole('button', { name: 'Chosen — raise order' }));
    expect(api.list).toHaveBeenLastCalledWith({ queue: 'awarded' });
  });

  it('opens on Returned to you when finance sent something back', async () => {
    api.list.mockImplementation(async (filters: { queue: string }) =>
      filters.queue === 'returned'
        ? { items: [], page: 1, limit: 1, total: 2 }
        : { items: [], page: 1, limit: 25, total: 0 },
    );
    renderWithProviders(<QuotesList />, { permissions: ['view:procurement', 'collect:quotation'] });
    expect(await screen.findByText('Nothing returned')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Returned to you' })).toHaveAttribute('aria-pressed', 'true');
  });
});

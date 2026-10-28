import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { CommandMenu } from './command-menu';
import { closeCommandMenu, openCommandMenu } from './command-menu-store';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('./record-search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./record-search')>();
  return {
    ...actual,
    useRecordSearch: (query: string) => ({
      isFetching: false,
      data:
        query.length >= 2
          ? {
              query,
              records: [
                {
                  kind: 'INVOICE',
                  id: 'i1',
                  title: 'INV-000118',
                  detail: 'Hargeisa Water Agency · 2026-08-28',
                  amount: '237500.00',
                  currencyCode: 'USD',
                  status: 'POSTED',
                  clientId: 'c1',
                },
                {
                  kind: 'CLIENT',
                  id: 'c1',
                  title: 'Hargeisa Water Agency',
                  detail: 'CL-1',
                  amount: null,
                  currencyCode: null,
                  status: 'ACTIVE',
                  clientId: 'c1',
                },
              ],
            }
          : undefined,
    }),
  };
});

beforeEach(() => push.mockReset());
afterEach(() => act(() => closeCommandMenu()));

describe('CommandMenu records (Step 2f, ADR-047)', () => {
  it('lists matching records first, with the match marked, and opens one', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandMenu />, { permissions: ['view:client', 'manage:receivable'] });
    act(() => openCommandMenu());
    await user.type(screen.getByRole('combobox'), 'harg');

    expect(screen.getByText('Records')).toBeInTheDocument();
    const invoice = screen.getByRole('option', { name: /INV-000118/ });
    expect(invoice).toHaveTextContent('Hargeisa Water Agency · 2026-08-28 · $237,500.00');
    expect(invoice).toHaveTextContent('Invoice');
    expect(invoice.querySelector('mark')).toHaveTextContent('Harg');

    await user.keyboard('{Enter}');
    expect(push).toHaveBeenCalledWith('/finance/accounting/invoices/i1');
  });

  it('offers to invoice and receive from a matched client', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandMenu />, { permissions: ['view:client', 'manage:receivable'] });
    act(() => openCommandMenu());
    await user.type(screen.getByRole('combobox'), 'harg');
    await user.click(screen.getByRole('option', { name: 'New sale invoice for Hargeisa Water Agency' }));
    expect(push).toHaveBeenCalledWith('/finance/accounting/invoices/new/sale?clientId=c1');
  });

  it('offers no invoicing action to someone who cannot invoice', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandMenu />, { permissions: ['view:client'] });
    act(() => openCommandMenu());
    await user.type(screen.getByRole('combobox'), 'harg');
    expect(screen.queryByRole('option', { name: /New sale invoice for/ })).not.toBeInTheDocument();
  });
});

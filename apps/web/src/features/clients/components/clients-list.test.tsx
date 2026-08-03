import { ClientStatus } from '@erp/types';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { listClients } from '@/features/clients/api/clients-api';
import type { Client } from '@/features/clients/types';

import { ClientsList } from './clients-list';

vi.mock('@/features/clients/api/clients-api', () => ({
  listClients: vi.fn(),
}));

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

function client(overrides: Partial<Client> & { id: string }): Client {
  return {
    organizationId: 'org-1',
    code: `CL-${overrides.id}`,
    name: `Client ${overrides.id}`,
    nameAr: null,
    taxNumber: null,
    defaultCurrency: null,
    status: ClientStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(listClients).mockReset();
});

describe('ClientsList', () => {
  it('renders each client as a row with a link to its page', async () => {
    vi.mocked(listClients).mockResolvedValue([
      client({ id: '1', name: 'Baraka Real Estate', taxNumber: 'SO-123' }),
    ]);

    renderWithProviders(<ClientsList />);

    const link = await screen.findByRole('link', { name: 'Baraka Real Estate' });
    expect(link).toHaveAttribute('href', '/clients/1');
    expect(screen.getByText('SO-123')).toBeInTheDocument();
  });

  it('shows a dash-free placeholder for fields the client has not set', async () => {
    vi.mocked(listClients).mockResolvedValue([client({ id: '1', taxNumber: null })]);

    renderWithProviders(<ClientsList />);

    await screen.findByRole('link', { name: 'Client 1' });
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0);
  });

  it('filters by search across code, name and tax number', async () => {
    vi.mocked(listClients).mockResolvedValue([
      client({ id: '1', name: 'Baraka Real Estate' }),
      client({ id: '2', name: 'Hodan Holdings', taxNumber: 'SO-999' }),
    ]);

    const user = userEvent.setup();
    renderWithProviders(<ClientsList />);

    await screen.findByRole('link', { name: 'Baraka Real Estate' });
    await user.type(screen.getByLabelText('Search clients'), 'SO-999');

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Baraka Real Estate' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Hodan Holdings' })).toBeInTheDocument();
  });

  it('filters by status', async () => {
    vi.mocked(listClients).mockResolvedValue([
      client({ id: '1', name: 'Active One', status: ClientStatus.ACTIVE }),
      client({ id: '2', name: 'Retired One', status: ClientStatus.INACTIVE }),
    ]);

    const user = userEvent.setup();
    renderWithProviders(<ClientsList />);

    await screen.findByRole('link', { name: 'Active One' });
    await user.selectOptions(screen.getByLabelText('Filter by status'), ClientStatus.INACTIVE);

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Active One' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Retired One' })).toBeInTheDocument();
  });

  // "No clients yet" and "nothing matches your filter" are different problems needing
  // different escape routes — offering "Clear filters" to someone with no clients at all
  // would be nonsense.
  it('offers to create a client when there are none at all', async () => {
    vi.mocked(listClients).mockResolvedValue([]);

    renderWithProviders(<ClientsList />);

    expect(await screen.findByText('No clients yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New client' })).toHaveAttribute(
      'href',
      '/clients/new',
    );
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('offers to clear filters when a filter hides everything', async () => {
    vi.mocked(listClients).mockResolvedValue([client({ id: '1', name: 'Baraka' })]);

    const user = userEvent.setup();
    renderWithProviders(<ClientsList />);

    await screen.findByRole('link', { name: 'Baraka' });
    await user.type(screen.getByLabelText('Search clients'), 'nothing matches this');

    expect(await screen.findByText('No clients match these filters.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('link', { name: 'Baraka' })).toBeInTheDocument();
  });

  it('offers a retry when the request fails', async () => {
    vi.mocked(listClients).mockRejectedValue(new Error('network'));

    renderWithProviders(<ClientsList />);

    expect(await screen.findByText('Could not load clients.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('prefers the Arabic name when the UI is in Arabic', async () => {
    vi.mocked(listClients).mockResolvedValue([
      client({ id: '1', name: 'Baraka Real Estate', nameAr: 'شركة البركة' }),
    ]);

    renderWithProviders(<ClientsList />, { locale: 'ar' });

    expect(await screen.findByRole('link', { name: 'شركة البركة' })).toBeInTheDocument();
  });

  it('announces the visible count', async () => {
    vi.mocked(listClients).mockResolvedValue([client({ id: '1' }), client({ id: '2' })]);

    renderWithProviders(<ClientsList />);

    await screen.findByRole('link', { name: 'Client 1' });
    const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('client'));
    expect(status).toBeDefined();
    expect(within(status!).getByText('2 clients')).toBeInTheDocument();
  });
});

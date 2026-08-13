import { ClientStatus } from '@erp/types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listClientSummaries } from '@/features/clients/api/clients-api';
import type { ClientListItem } from '@/features/clients/types';
import { renderWithProviders } from '@/test/render';

import { ClientsList } from './clients-list';

vi.mock('@/features/clients/api/clients-api', () => ({ listClientSummaries: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a>,
}));

function client(overrides: Partial<ClientListItem> & { id: string }): ClientListItem {
  return {
    name: `Client ${overrides.id}`,
    status: ClientStatus.ACTIVE,
    primaryContact: null,
    activeProjectCount: 0,
    outstandingBalance: '0.00',
    ...overrides,
  };
}

beforeEach(() => vi.mocked(listClientSummaries).mockReset());

describe('ClientsList', () => {
  it('renders the approved business context without internal identifiers', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue([
      client({ id: '1', name: 'Baraka Real Estate', primaryContact: { name: 'Yusuf Ahmed', role: 'Commercial Director' }, activeProjectCount: 2, outstandingBalance: '1250.00' }),
    ]);
    renderWithProviders(<ClientsList />);

    expect(await screen.findByRole('link', { name: 'Baraka Real Estate' })).toHaveAttribute('href', '/clients/1');
    expect(screen.getByText('Yusuf Ahmed')).toBeInTheDocument();
    expect(screen.getByText('Commercial Director')).toBeInTheDocument();
    expect(screen.queryByText('CL-1')).not.toBeInTheDocument();
  });

  it('shows restrained placeholders for missing contacts and restricted balances', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue([client({ id: '1', outstandingBalance: null })]);
    renderWithProviders(<ClientsList />);

    await screen.findByRole('link', { name: 'Client 1' });
    expect(screen.getAllByText('Not assigned').length).toBeGreaterThan(0);
    expect(screen.getByText('Restricted')).toBeInTheDocument();
  });

  it('filters by client and primary-contact names', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue([
      client({ id: '1', name: 'Baraka Real Estate' }),
      client({ id: '2', name: 'Hodan Holdings', primaryContact: { name: 'Amina Ali', role: null } }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<ClientsList />);

    await screen.findByRole('link', { name: 'Baraka Real Estate' });
    await user.type(screen.getByLabelText('Search'), 'Amina');
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Baraka Real Estate' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Hodan Holdings' })).toBeInTheDocument();
  });

  it('filters by status', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue([
      client({ id: '1', name: 'Active One' }),
      client({ id: '2', name: 'Retired One', status: ClientStatus.INACTIVE }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<ClientsList />);

    await screen.findByRole('link', { name: 'Active One' });
    await user.selectOptions(screen.getByLabelText('Filter by status'), ClientStatus.INACTIVE);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Active One' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Retired One' })).toBeInTheDocument();
  });

  it('offers to create a client when there are none', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue([]);
    renderWithProviders(<ClientsList />);

    expect(await screen.findByText('No clients yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New client' })).toHaveAttribute('href', '/clients/new');
  });

  it('offers to clear filters when a search hides everything', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue([client({ id: '1', name: 'Baraka' })]);
    const user = userEvent.setup();
    renderWithProviders(<ClientsList />);

    await screen.findByRole('link', { name: 'Baraka' });
    await user.type(screen.getByLabelText('Search'), 'nothing matches this');
    expect(await screen.findByText('No results match your search.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByRole('link', { name: 'Baraka' })).toBeInTheDocument();
  });

  it('uses the legal display name in Arabic UI', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue([client({ id: '1', name: 'Baraka Real Estate' })]);
    renderWithProviders(<ClientsList />, { locale: 'ar' });
    expect(await screen.findByRole('link', { name: 'Baraka Real Estate' })).toBeInTheDocument();
  });

  it('announces the visible count', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue([client({ id: '1' }), client({ id: '2' })]);
    renderWithProviders(<ClientsList />);

    await screen.findByRole('link', { name: 'Client 1' });
    expect(screen.getByRole('status')).toHaveTextContent('2 results');
  });
});

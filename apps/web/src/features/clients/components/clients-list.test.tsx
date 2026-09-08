import { ClientStatus } from '@erp/types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listClientSummaries } from '@/features/clients/api/clients-api';
import type { ClientListItem } from '@/features/clients/types';
import { renderWithProviders } from '@/test/render';
import { chooseOption } from '@/test/choose-option';

import { ClientsList } from './clients-list';

vi.mock('@/features/clients/api/clients-api', () => ({ listClientSummaries: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a>,
}));

function client(overrides: Partial<ClientListItem> & { id: string }): ClientListItem {
  return {
    code: `CLI-00000${overrides.id}`,
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
  it('renders the business context, including the code a person would quote', async () => {
    // The code used to be withheld here as an "internal identifier". It is not one: CLI-000001
    // is what a client is called on a contract and in a phone call, and a list that omits it
    // makes the reader open a record to confirm they have the right one. The identifier that
    // stays hidden is the cuid in the URL.
    vi.mocked(listClientSummaries).mockResolvedValue([
      client({ id: '1', name: 'Baraka Real Estate', primaryContact: { name: 'Yusuf Ahmed', role: 'Commercial Director' }, activeProjectCount: 2, outstandingBalance: '1250.00' }),
    ]);
    renderWithProviders(<ClientsList />);

    expect(await screen.findByRole('link', { name: /Baraka Real Estate/ })).toHaveAttribute('href', '/clients/1');
    expect(screen.getByText('CLI-000001')).toBeInTheDocument();
    expect(screen.getByText('Yusuf Ahmed')).toBeInTheDocument();
    expect(screen.getByText('Commercial Director')).toBeInTheDocument();
  });

  it('shows restrained placeholders for missing contacts and restricted balances', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue([client({ id: '1', outstandingBalance: null })]);
    renderWithProviders(<ClientsList />);

    await screen.findByRole('link', { name: /Client 1/ });
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

    await screen.findByRole('link', { name: /Baraka Real Estate/ });
    await user.type(screen.getByLabelText('Search'), 'Amina');
    await waitFor(() => expect(screen.queryByRole('link', { name: /Baraka Real Estate/ })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: /Hodan Holdings/ })).toBeInTheDocument();
  });

  it('filters by status', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue([
      client({ id: '1', name: 'Active One' }),
      client({ id: '2', name: 'Retired One', status: ClientStatus.INACTIVE }),
    ]);
    const user = userEvent.setup();
    renderWithProviders(<ClientsList />);

    await screen.findByRole('link', { name: /Active One/ });
    await chooseOption(user, screen.getByLabelText('Filter by status'), ClientStatus.INACTIVE);
    await waitFor(() => expect(screen.queryByRole('link', { name: /Active One/ })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: /Retired One/ })).toBeInTheDocument();
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

    await screen.findByRole('link', { name: /Baraka/ });
    await user.type(screen.getByLabelText('Search'), 'nothing matches this');
    expect(await screen.findByText('No results match your search.')).toBeInTheDocument();
    // "Clear filters", not "Clear search": the control now also resets the status filter, so
    // it names the whole thing it undoes rather than only the half it used to.
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('link', { name: /Baraka/ })).toBeInTheDocument();
  });


  it('announces the visible count', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue([client({ id: '1' }), client({ id: '2' })]);
    renderWithProviders(<ClientsList />);

    await screen.findByRole('link', { name: /Client 1/ });
    expect(screen.getByRole('status')).toHaveTextContent('2 results');
  });

  it('says how much of the list is on screen, under the rows', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue([client({ id: '1' }), client({ id: '2' })]);
    renderWithProviders(<ClientsList />);

    // The count above the table scrolls away with it; the footer is what a reader sees when
    // they reach the bottom and want to know whether that was all of them.
    expect(await screen.findByText('Showing 2 of 2 results')).toBeInTheDocument();
  });

  it('puts one link behind the row, which the whole row activates', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue([client({ id: '7', name: 'Baraka' })]);
    renderWithProviders(<ClientsList />);

    await screen.findByRole('link', { name: /Baraka/ });

    // The row click handler activates this link rather than pushing a route of its own, so
    // the two can never point at different places. It is also what a keyboard reaches and
    // what open-in-new-tab acts on.
    const rowLink = document.querySelector('a[data-row-link]');
    expect(rowLink).toHaveAttribute('href', '/clients/7');
    expect(document.querySelectorAll('a[data-row-link]')).toHaveLength(1);
  });

  it('marks live status with a dot, and the drill-down number as a link', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue([
      client({ id: '1', name: 'Baraka', activeProjectCount: 3 }),
    ]);
    renderWithProviders(<ClientsList />);

    // The dot is what the eye finds scanning a status column; the word confirms it.
    const badge = (await screen.findByText('Active')).closest('span');
    expect(badge?.querySelector('span[aria-hidden="true"]')).not.toBeNull();

    // Underlined at rest, not only on hover: the one drillable number in the row has to
    // advertise itself, or it reads as plain text.
    const count = screen.getByRole('link', { name: '3' });
    expect(count.className).toContain('underline');
    expect(count.className).not.toContain('hover:underline');
  });

  it('offers view and edit behind the row menu, and nothing destructive', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue([client({ id: '7', name: 'Baraka' })]);
    const user = userEvent.setup();
    renderWithProviders(<ClientsList />);

    await user.click(await screen.findByRole('button', { name: 'Actions for Baraka' }));

    expect(await screen.findByRole('menuitem', { name: 'View client' })).toHaveAttribute('href', '/clients/7');
    expect(screen.getByRole('menuitem', { name: 'Edit client' })).toHaveAttribute('href', '/clients/7/edit');
    // A list row is the wrong place to deactivate a client from — it is one slip away from
    // the row above it, and the record page is where that decision has its context.
    expect(screen.queryByRole('menuitem', { name: /Deactivate/i })).not.toBeInTheDocument();
  });
});

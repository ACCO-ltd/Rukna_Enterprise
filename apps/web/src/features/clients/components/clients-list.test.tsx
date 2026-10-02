import { ClientStatus } from '@erp/types';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listClientSummaries } from '@/features/clients/api/clients-api';
import type { ClientSummaryItem, ClientSummaryPage } from '@/features/clients/types';
import { chooseOption } from '@/test/choose-option';
import { renderWithProviders } from '@/test/render';

import { ClientsList, toServerSort } from './clients-list';

vi.mock('@/features/clients/api/clients-api', () => ({ listClientSummaries: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const MONEY = 'view:financial-position';

function row(overrides: Partial<ClientSummaryItem> & { id: string }): ClientSummaryItem {
  return {
    code: `CLI-00000${overrides.id}`,
    name: `Client ${overrides.id}`,
    type: 'COMPANY',
    status: ClientStatus.ACTIVE,
    primaryContact: null,
    activeProjectCount: 0,
    totalProjectCount: 0,
    outstanding: '0.00',
    overdue: '0.00',
    ...overrides,
  };
}

function page(items: ClientSummaryItem[], overrides: Partial<ClientSummaryPage> = {}): ClientSummaryPage {
  return { items, total: items.length, page: 1, pageSize: 25, moneyVisible: true, ...overrides };
}

/**
 * The table. Below 640px the grid renders phone cards from the same rows; jsdom has no media
 * queries, so both are in the DOM and every query is scoped to the table.
 */
async function grid() {
  return within(await screen.findByRole('table'));
}

const lastQuery = () => vi.mocked(listClientSummaries).mock.calls.at(-1)?.[0];

beforeEach(() => vi.mocked(listClientSummaries).mockReset());

describe('ClientsList — columns', () => {
  it('shows the client as the row link with code · type, the contact with a formatted phone, and project counts', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue(
      page([
        row({
          id: '1',
          name: 'Baraka Real Estate',
          type: 'GOVERNMENT',
          primaryContact: { name: 'Yusuf Ahmed', phone: '+252616666666' },
          activeProjectCount: 2,
          totalProjectCount: 5,
        }),
      ]),
    );
    renderWithProviders(<ClientsList />, { permissions: [MONEY] });

    const link = await (await grid()).findByRole('link', { name: /Baraka Real Estate/ });
    expect(link).toHaveAttribute('href', '/clients/1');
    expect(link).toHaveTextContent('CLI-000001 · Government');
    expect(document.querySelectorAll('table a[data-row-link]')).toHaveLength(1);
    expect((await grid()).getByText('Yusuf Ahmed')).toBeInTheDocument();
    expect((await grid()).getByText('+252 61 666 6666')).toBeInTheDocument();
    expect((await grid()).getByText('2 active')).toBeInTheDocument();
    expect((await grid()).getByText('5 in total')).toBeInTheDocument();
    // Project counts are plain text, never a link.
    expect((await grid()).queryByRole('link', { name: /active/ })).not.toBeInTheDocument();
  });

  it('words project counts for none-active and none-yet', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue(
      page([
        row({ id: '1', activeProjectCount: 0, totalProjectCount: 3 }),
        row({ id: '2', activeProjectCount: 0, totalProjectCount: 0 }),
        row({ id: '3', activeProjectCount: 4, totalProjectCount: 4 }),
      ]),
    );
    renderWithProviders(<ClientsList />, { permissions: [MONEY] });

    expect(await (await grid()).findByText('None active')).toBeInTheDocument();
    expect((await grid()).getByText('3 in total')).toBeInTheDocument();
    expect((await grid()).getByText('None yet')).toBeInTheDocument();
    expect((await grid()).getByText('4 active')).toBeInTheDocument();
    expect((await grid()).queryByText('4 in total')).not.toBeInTheDocument();
  });

  it('shows outstanding with an overdue line, and $0.00 when nothing is owed', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue(
      page([
        row({ id: '1', name: 'Owes', outstanding: '1250.00', overdue: '400.00' }),
        row({ id: '2', name: 'Clear', outstanding: '0.00', overdue: '0.00' }),
      ]),
    );
    renderWithProviders(<ClientsList />, { permissions: [MONEY] });

    expect(await screen.findByRole('columnheader', { name: /Outstanding/ })).toBeInTheDocument();
    expect((await grid()).getByText('$1,250.00')).toBeInTheDocument();
    expect((await grid()).getByText('$400.00 overdue')).toHaveClass('text-danger');
    expect((await grid()).getByText('$0.00')).toBeInTheDocument();
  });

  it('drops the money column for money-blind roles and says so once under the grid', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue(
      page([row({ id: '1', outstanding: null, overdue: null })], { moneyVisible: false }),
    );
    renderWithProviders(<ClientsList />, { permissions: [] });

    await (await grid()).findByRole('link', { name: /Client 1/ });
    expect(screen.queryByRole('columnheader', { name: /Outstanding/ })).not.toBeInTheDocument();
    expect((await grid()).queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.getByText('Balances are not shown for your role.')).toBeInTheDocument();
  });
});

describe('ClientsList — states', () => {
  it('shows the first-use empty state with the create action', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue(page([]));
    renderWithProviders(<ClientsList />, { permissions: ['create:client'] });

    expect(await screen.findByText('No clients yet')).toBeInTheDocument();
    expect(
      screen.getByText('Add the client first, then create its project. Clients are shared by every project, invoice and receipt.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New client' })).toHaveAttribute('href', '/clients/new');
  });

  it('shows a filtered-empty state with Clear filters when a search finds nothing', async () => {
    vi.mocked(listClientSummaries).mockImplementation(async (query) =>
      query?.search ? page([]) : page([row({ id: '1', name: 'Baraka' })]),
    );
    const user = userEvent.setup();
    renderWithProviders(<ClientsList />);

    await (await grid()).findByRole('link', { name: /Baraka/ });
    await user.type(screen.getByRole('searchbox', { name: 'Search clients' }), 'zzz');
    expect(await screen.findAllByText('No clients match these filters.')).not.toHaveLength(0);
    expect(screen.queryByText('No clients yet')).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    expect(await (await grid()).findByRole('link', { name: /Baraka/ })).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    vi.mocked(listClientSummaries).mockRejectedValueOnce(new Error('boom')).mockResolvedValue(page([row({ id: '1' })]));
    const user = userEvent.setup();
    renderWithProviders(<ClientsList />);

    expect(await screen.findByText('Could not load clients.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await (await grid()).findByRole('link', { name: /Client 1/ })).toBeInTheDocument();
  });
});

describe('ClientsList — server query', () => {
  it('sends search, filters, sort and page to GET /clients/summary', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue(
      page([row({ id: '1', name: 'Baraka' })], { total: 60 }),
    );
    const user = userEvent.setup();
    renderWithProviders(<ClientsList />, { permissions: [MONEY] });
    await (await grid()).findByRole('link', { name: /Baraka/ });
    expect(lastQuery()).toEqual(expect.objectContaining({ page: 1, pageSize: 25 }));

    await user.type(screen.getByRole('searchbox', { name: 'Search clients' }), 'Amina');
    await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ search: 'Amina', page: 1 })));

    await user.click(screen.getByRole('button', { name: /^Filter/ }));
    await chooseOption(user, screen.getByRole('combobox', { name: 'Status' }), ClientStatus.INACTIVE);
    await chooseOption(user, screen.getByRole('combobox', { name: 'Client type' }), 'NGO');
    await chooseOption(user, screen.getByRole('combobox', { name: 'Balance' }), 'OVERDUE');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(lastQuery()).toEqual(
        expect.objectContaining({ search: 'Amina', status: 'INACTIVE', type: 'NGO', balance: 'OVERDUE' }),
      ),
    );
    // Applied filters show as chips.
    expect(screen.getByRole('button', { name: 'Remove filter: Balance' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Sort Outstanding/ }));
    await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ sort: 'outstanding' })));

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastQuery()).toEqual(expect.objectContaining({ page: 2 })));
  });

  it('offers no Balance filter to money-blind roles', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue(page([row({ id: '1' })], { moneyVisible: false }));
    const user = userEvent.setup();
    renderWithProviders(<ClientsList />, { permissions: [] });
    await (await grid()).findByRole('link', { name: /Client 1/ });
    await user.click(screen.getByRole('button', { name: /^Filter/ }));
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Balance' })).not.toBeInTheDocument();
  });

  it('maps grid sort to the API sort param', () => {
    expect(toServerSort(null)).toBeUndefined();
    expect(toServerSort({ key: 'client', direction: 'asc' })).toBe('name');
    expect(toServerSort({ key: 'client', direction: 'desc' })).toBe('-name');
    expect(toServerSort({ key: 'outstanding', direction: 'desc' })).toBe('-outstanding');
    expect(toServerSort({ key: 'status', direction: 'asc' })).toBeUndefined();
  });
});

describe('ClientsList — row menu and gates', () => {
  it('offers Open, New project (active clients) and Edit client, gated by permission', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue(
      page([row({ id: '7', name: 'Baraka' }), row({ id: '8', name: 'Retired', status: ClientStatus.INACTIVE })]),
    );
    const user = userEvent.setup();
    renderWithProviders(<ClientsList />, { permissions: ['manage:client', 'create:project', 'create:client'] });

    expect(await screen.findByRole('link', { name: /New client/ })).toHaveAttribute('href', '/clients/new');
    await user.click((await grid()).getByRole('button', { name: 'Actions for Baraka' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Open' })).toHaveAttribute('href', '/clients/7');
    expect(within(menu).getByRole('menuitem', { name: 'New project' })).toHaveAttribute('href', '/projects/new?clientId=7');
    expect(within(menu).getByRole('menuitem', { name: 'Edit client' })).toHaveAttribute('href', '/clients/7/edit');
    await user.keyboard('{Escape}');

    await user.click((await grid()).getByRole('button', { name: 'Actions for Retired' }));
    const retiredMenu = await screen.findByRole('menu');
    expect(within(retiredMenu).queryByRole('menuitem', { name: 'New project' })).not.toBeInTheDocument();
  });

  it('hides New client, New project and Edit without their permissions', async () => {
    vi.mocked(listClientSummaries).mockResolvedValue(page([row({ id: '7', name: 'Baraka' })]));
    const user = userEvent.setup();
    renderWithProviders(<ClientsList />, { permissions: ['view:client'] });

    await (await grid()).findByRole('link', { name: /Baraka/ });
    expect(screen.queryByRole('link', { name: /New client/ })).not.toBeInTheDocument();
    await user.click((await grid()).getByRole('button', { name: 'Actions for Baraka' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(1);
  });
});

import { screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chooseOption } from '@/test/choose-option';
import { renderWithProviders } from '@/test/render';

/**
 * New material request: one page, no wizard. Items are picked from the catalogue (or added as a
 * one-off) through the line editor's combobox column; save creates the draft and opens it. The
 * request date is the server's and is never sent.
 */

const routerMocks = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }));
const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => routerMocks,
  useSearchParams: () => search.params,
  usePathname: () => '/procurement/requests/new',
}));
vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProjects: () => ({
    isPending: false,
    data: [
      { id: 'p1', code: 'ACCO-HDN-26-0005', name: 'Hodan villa' },
      { id: 'p2', code: 'ACCO-WRT-26-0002', name: 'Warta Nabadda school' },
    ],
  }),
}));

const create = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, error: null as unknown }));
vi.mock('../hooks/use-procurement', () => ({
  useCreateMaterialRequest: () => create,
  useMaterials: () => ({
    data: [
      {
        id: 'm1',
        code: 'RB-12',
        name: 'Rebar 12mm',
        status: 'ACTIVE',
        defaultSpendCategoryId: 'sc-steel',
        baseUom: { id: 'u1', code: 'TON', name: 'Tonne', symbol: 't', status: 'ACTIVE' },
        lastPurchasePrice: '850.00',
      },
    ],
  }),
  useUoms: () => ({
    data: [
      { id: 'u1', code: 'TON', name: 'Tonne', symbol: 't', status: 'ACTIVE' },
      { id: 'u2', code: 'DAY', name: 'Day', symbol: 'day', status: 'ACTIVE' },
    ],
  }),
  useSpendCategories: () => ({
    data: [{ id: 'sc-steel', code: 'STL', name: 'Steel', status: 'ACTIVE', parentId: null, children: [] }],
  }),
}));

import { MrForm } from './mr-form';

const MONEY = 'view:commitment-ledger';

beforeEach(() => {
  vi.clearAllMocks();
  search.params = new URLSearchParams();
  create.error = null;
});

/** The phone card and table row are one set of controls; scope to the editor's table. */
const lines = () => within(screen.getByRole('table', { name: 'Requested items' }));

async function pickProject(user: UserEvent) {
  await user.click(screen.getByRole('combobox', { name: /Project/ }));
  await user.click(await screen.findByRole('option', { name: /Hodan villa/ }));
}

async function pickRebar(user: UserEvent) {
  await user.click(lines().getByRole('combobox', { name: /Item/ }));
  await user.type(await screen.findByPlaceholderText('Search by name or code'), 'rebar');
  await user.keyboard('{Enter}');
}

describe('MrForm', () => {
  it('is one page: action bar, lifecycle, identity — and no requested date', () => {
    renderWithProviders(<MrForm />, { permissions: [MONEY] });

    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    expect(screen.getByText('New request')).toBeInTheDocument();
    expect(
      screen.getByText('The number is assigned when you save. You submit it for approval from the saved request.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /A project/ })).toBeChecked();
    expect(screen.queryByText(/Requested/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('blocks save with inline errors and a counted summary', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrForm />, { permissions: [MONEY] });

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(create.mutate).not.toHaveBeenCalled();
    expect(screen.getAllByText('Choose the project this is for.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Choose an item, or type its name and add it as a one-off item.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Enter a quantity greater than zero.').length).toBeGreaterThan(0);
  });

  it('picks a catalogue item: read-only unit and spend category, prefilled price, live totals; saves the draft', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrForm />, { permissions: [MONEY] });

    await pickProject(user);
    await pickRebar(user);
    expect(lines().getByText('Material')).toBeInTheDocument();
    expect(lines().getByText('t')).toBeInTheDocument();
    expect(lines().getByText('Steel')).toBeInTheDocument();
    expect(lines().getByLabelText('Est. unit price')).toHaveValue('850.00');

    await user.type(lines().getByLabelText(/Quantity/), '2');
    expect(lines().getByText('$1,700.00')).toBeInTheDocument();
    expect(screen.getByText('Estimated total').nextSibling).toHaveTextContent('$1,700.00');

    await user.type(screen.getByLabelText(/Title/), 'Rebar for level 2 slab');
    await user.type(screen.getByLabelText(/Note to the buyer/), 'Deliver to gate B');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(create.mutate).toHaveBeenCalledTimes(1);
    const [payload, options] = create.mutate.mock.calls[0]!;
    expect(payload).toEqual({
      requestScope: 'PROJECT',
      projectId: 'p1',
      title: 'Rebar for level 2 slab',
      currencyCode: 'USD',
      notes: 'Deliver to gate B',
      lines: [
        {
          lineType: 'MATERIAL',
          description: 'Rebar 12mm',
          uomCode: 'TON',
          requestedQuantity: 2,
          materialCode: 'RB-12',
          estimatedUnitPrice: 850,
          spendCategoryId: 'sc-steel',
        },
      ],
    });
    expect(payload).not.toHaveProperty('requestedDate');
    options.onSuccess({ id: 'req-1' });
    expect(routerMocks.push).toHaveBeenCalledWith('/procurement/requests/req-1');
  });

  it('adds a one-off item from the typed text, with a Service/Other type and its own unit', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrForm />, { permissions: [MONEY] });

    await user.click(screen.getByRole('radio', { name: /ACCO overhead/ }));
    expect(screen.queryByRole('combobox', { name: /Project/ })).not.toBeInTheDocument();

    await user.click(lines().getByRole('combobox', { name: /Item/ }));
    await user.type(await screen.findByPlaceholderText('Search by name or code'), 'Crane hire');
    await user.click(screen.getByRole('option', { name: 'Add "Crane hire" as a one-off item' }));
    expect(lines().getByRole('combobox', { name: /Item/ })).toHaveTextContent('Crane hire');
    // The list closes without returning focus; it moves on to the one-off's next field.
    await waitFor(() => expect(lines().getByLabelText('Type')).toHaveFocus());

    await user.type(lines().getByLabelText(/Quantity/), '3');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(create.mutate).not.toHaveBeenCalled();
    expect(screen.getAllByText('Choose a unit.').length).toBeGreaterThan(0);

    await chooseOption(user, lines().getByLabelText('Type'), 'SERVICE');
    await chooseOption(user, lines().getByLabelText('Unit'), 'DAY');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(create.mutate).toHaveBeenCalledTimes(1));
    expect(create.mutate.mock.calls[0]![0]).toEqual({
      requestScope: 'ORGANIZATION',
      lines: [{ lineType: 'SERVICE', description: 'Crane hire', uomCode: 'DAY', requestedQuantity: 3 }],
    });
  });

  it('moves focus to the new row after Add an item', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrForm />, { permissions: [MONEY] });

    await user.click(screen.getByRole('button', { name: 'Add an item' }));
    const items = lines().getAllByRole('combobox', { name: /Item/ });
    expect(items).toHaveLength(2);
    await waitFor(() => expect(items[1]).toHaveFocus());
  });

  it('shows no prices or totals to a money-blind role', () => {
    renderWithProviders(<MrForm />, { permissions: ['create:material-request'] });
    expect(screen.queryByText('Est. unit price')).not.toBeInTheDocument();
    expect(screen.queryByText('Estimated total')).not.toBeInTheDocument();
  });

  it("shows the server's refusal in the summary", () => {
    create.error = new (class extends Error {})('x');
    renderWithProviders(<MrForm />, { permissions: [MONEY] });
    expect(screen.getByText('This page could not be loaded.')).toBeInTheDocument();
  });
});

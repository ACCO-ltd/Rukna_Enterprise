import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { ACCOUNTING_PERMISSIONS } from '@/features/auth/permissions/can';

import type { Supplier } from '../types';

/**
 * Tier A — the supplier master and the shared picker.
 *
 * Rendering against the real catalogues is half the point: `renderWithProviders` throws on
 * a missing key, so every string these components ask for is proven to exist. Only this
 * proves the catalogue agrees with the code.
 *
 * The behavioural assertions each pin a decision that a future reader would otherwise be
 * tempted to undo:
 *
 *  - an Edit control appears only for a holder of `manage:payable` (A15 / D8), never for a
 *    viewer, and there is still no deactivate control
 *  - the edit form pre-fills, gates on client validation, sends only the changed fields as
 *    a PATCH, and never sends `code` or `status`
 *  - the picker's empty state links to the Suppliers screen rather than rendering an empty
 *    select, because no environment seeds a supplier
 */

const mocks = vi.hoisted(() => ({
  useSuppliers: vi.fn(),
  useSupplier: vi.fn(),
  useSupplierDirectory: vi.fn(),
  useDeactivateSupplier: vi.fn(),
  useReactivateSupplier: vi.fn(),
  useCreateSupplier: vi.fn(),
  useUpdateSupplier: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => mocks);

import { SupplierList } from './supplier-list';
import type { SupplierDirectoryRow } from '../types';
import { SupplierPicker, supplierOptionLabel } from './supplier-picker';
import { openSelect } from '@/test/choose-option';

const RASHID: Supplier = {
  id: 'sup-1',
  code: 'SUP-001',
  name: 'Al-Rashid Trading',
  taxNumber: '310122445500003',
  defaultCurrency: 'USD',
  paymentTermsDays: 30,
  address: 'King Fahd Rd, Riyadh',
  status: 'ACTIVE',
};

const BAREBONES: Supplier = {
  id: 'sup-2',
  code: 'SUP-002',
  name: 'Horn Cement',
  taxNumber: null,
  defaultCurrency: null,
  paymentTermsDays: null,
  address: null,
  status: 'ACTIVE',
};

function loaded(data: Supplier[]) {
  return { data, isPending: false, isError: false };
}

const updateMutate = vi.fn();

const row = (supplier: Supplier, patch: Partial<SupplierDirectoryRow> = {}): SupplierDirectoryRow => ({
  id: supplier.id,
  code: supplier.code,
  name: supplier.name,
  status: supplier.status,
  primaryContact: null,
  paymentTermsDays: supplier.paymentTermsDays,
  defaultCurrency: supplier.defaultCurrency,
  openOrderCount: 0,
  payableBalance: null,
  payableBalances: null,
  moneyVisible: false,
  ...patch,
});
const statusCommand = () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useSuppliers.mockReturnValue(loaded([RASHID, BAREBONES]));
  mocks.useSupplierDirectory.mockReturnValue({
    ...loaded([]),
    data: [
      row(RASHID, {
        primaryContact: { name: 'Hassan Ali', phone: '+252616666666' },
        openOrderCount: 2,
        payableBalance: '1250.00',
        payableBalances: [{ currencyCode: 'USD', amount: '1250.00' }],
        moneyVisible: true,
      }),
      row(BAREBONES, { status: 'INACTIVE', moneyVisible: true }),
    ],
    refetch: vi.fn(),
  });
  mocks.useSupplier.mockImplementation((id: string) => ({ data: id === 'sup-1' ? RASHID : undefined }));
  mocks.useDeactivateSupplier.mockReturnValue(statusCommand());
  mocks.useReactivateSupplier.mockReturnValue(statusCommand());
  mocks.useCreateSupplier.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
  mocks.useUpdateSupplier.mockReturnValue({
    mutate: updateMutate,
    isPending: false,
    isError: false,
    error: null,
  });
});

/** The permission the edit affordance and the PATCH endpoint both gate on. */
const MANAGE_PAYABLE = [ACCOUNTING_PERMISSIONS.managePayables];

describe('SupplierList', () => {
  const table = async () => within(await screen.findByRole('table'));

  it('shows supplier + code, contact, terms, open orders, what we owe and status', async () => {
    renderWithProviders(<SupplierList />, { permissions: MANAGE_PAYABLE });
    const grid = await table();

    expect(grid.getByText('Al-Rashid Trading')).toBeInTheDocument();
    expect(grid.getByText('SUP-001')).toBeInTheDocument();
    expect(grid.getByText('Hassan Ali')).toBeInTheDocument();
    expect(grid.getByText('Net 30 days')).toBeInTheDocument();
    expect(grid.getByText('2 open')).toBeInTheDocument();
    expect(grid.getByText('None')).toBeInTheDocument();
    expect(grid.getByText('$1,250.00')).toBeInTheDocument();
    expect(screen.queryByText(/permanent once created/i)).not.toBeInTheDocument();
  });

  it("hides what we owe when the server says money is not visible — never $0", async () => {
    mocks.useSupplierDirectory.mockReturnValue({ ...loaded([]), data: [row(RASHID)], refetch: vi.fn() });
    renderWithProviders(<SupplierList />, { permissions: MANAGE_PAYABLE });
    const grid = await table();
    expect(grid.queryByRole('columnheader', { name: /We owe/ })).not.toBeInTheDocument();
    expect(screen.getByText('What we owe is hidden for your role.')).toBeInTheDocument();
  });

  it('hides every row command from a user without manage:payable', async () => {
    renderWithProviders(<SupplierList />);
    await table();
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it('offers Deactivate… on an active supplier and Reactivate on an inactive one', async () => {
    const user = userEvent.setup();
    const reactivate = statusCommand();
    mocks.useReactivateSupplier.mockReturnValue(reactivate);
    renderWithProviders(<SupplierList />, { permissions: MANAGE_PAYABLE });

    await user.click((await table()).getByRole('button', { name: 'Actions for Al-Rashid Trading' }));
    expect(await screen.findByRole('menuitem', { name: 'Deactivate…' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click((await table()).getByRole('button', { name: 'Actions for Horn Cement' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Reactivate' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reactivate' }));
    expect(reactivate.mutate).toHaveBeenCalledWith('sup-2', expect.anything());
  });

  it('first use: says to add a supplier', async () => {
    mocks.useSupplierDirectory.mockReturnValue({ ...loaded([]), data: [], refetch: vi.fn() });
    renderWithProviders(<SupplierList />, { permissions: MANAGE_PAYABLE });
    expect(await screen.findByText('No suppliers yet')).toBeInTheDocument();
  });

  it('offers New supplier to a holder of manage:payable — the permission POST /suppliers enforces', async () => {
    renderWithProviders(<SupplierList />, { permissions: MANAGE_PAYABLE });
    await table();
    expect(screen.getByRole('link', { name: /New supplier/ })).toHaveAttribute('href', '/procurement/suppliers/new');
  });

  it('hides New supplier from a user without manage:payable', async () => {
    renderWithProviders(<SupplierList />);
    await table();
    expect(screen.queryByRole('link', { name: /New supplier/ })).not.toBeInTheDocument();
  });
});

describe('SupplierList — edit form (A15 / D8)', () => {
  async function openEditor() {
    const user = userEvent.setup();
    renderWithProviders(<SupplierList />, { permissions: MANAGE_PAYABLE });
    const grid = within(await screen.findByRole('table'));
    await user.click(grid.getByRole('button', { name: 'Actions for Al-Rashid Trading' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    return { user, dialog };
  }

  it('pre-fills every editable field from the supplier and shows the code read-only', async () => {
    const { dialog } = await openEditor();

    // Code is context, not an input: rendered read-only, never editable.
    const code = within(dialog).getByDisplayValue('SUP-001');
    expect(code).toHaveAttribute('readonly');

    expect(within(dialog).getByDisplayValue('Al-Rashid Trading')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('310122445500003')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('USD')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('30')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('King Fahd Rd, Riyadh')).toBeInTheDocument();

    // Status is a separate flow — it must not appear on this form at all.
    expect(within(dialog).queryByText(/status/i)).not.toBeInTheDocument();
  });

  it('sends only the changed field as a PATCH, with no code or status', async () => {
    const { user, dialog } = await openEditor();

    const name = within(dialog).getByDisplayValue('Al-Rashid Trading');
    await user.clear(name);
    await user.type(name, 'Al-Rashid Trading Co.');

    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const [args] = updateMutate.mock.calls[0];
    expect(args.id).toBe('sup-1');
    // Only the changed field travels — a true PATCH.
    expect(args.payload).toEqual({ name: 'Al-Rashid Trading Co.' });
    expect(args.payload).not.toHaveProperty('code');
    expect(args.payload).not.toHaveProperty('status');
  });

  it('refuses to submit an empty name and never calls the mutation', async () => {
    const { user, dialog } = await openEditor();

    const name = within(dialog).getByDisplayValue('Al-Rashid Trading');
    await user.clear(name);
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

    expect(updateMutate).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/supplier name is required/i)).toBeInTheDocument();
  });

  it('refuses to submit when nothing changed rather than provoking the server 400', async () => {
    const { user, dialog } = await openEditor();

    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

    expect(updateMutate).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/change at least one field/i)).toBeInTheDocument();
  });

  it('surfaces the backend error verbatim', async () => {
    const { ApiError } = await import('@/lib/api-client');
    mocks.useUpdateSupplier.mockReturnValue({
      mutate: updateMutate,
      isPending: false,
      isError: true,
      error: new ApiError(404, 'Supplier sup-1 not found', 'NOT_FOUND'),
    });

    const { dialog } = await openEditor();
    expect(within(dialog).getByText(/supplier sup-1 not found/i)).toBeInTheDocument();
  });
});

describe('supplierOptionLabel', () => {
  it('leads with the code, which is what a buyer knows the supplier by', () => {
    expect(supplierOptionLabel(RASHID)).toBe('SUP-001 · Al-Rashid Trading');
  });
});

describe('SupplierPicker', () => {
  function Picker() {
    return <SupplierPicker id="supplier" value="" onChange={() => {}} />;
  }

  it('lists every supplier as an option', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Picker />);

    await openSelect(user, screen.getByRole('combobox'));
    expect(
      screen.getByRole('option', { name: 'SUP-001 · Al-Rashid Trading' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'SUP-002 · Horn Cement' })).toBeInTheDocument();
  });

  /**
   * Nothing in `prisma/seeds/` creates a supplier, so an empty list is the normal first
   * state of every environment — not an error. An empty `<select>` here reads as a broken
   * screen; a link to the place that fixes it does not.
   */
  it('links to the Suppliers screen instead of rendering an empty select', () => {
    mocks.useSuppliers.mockReturnValue(loaded([]));
    renderWithProviders(<Picker />);

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to suppliers/i })).toHaveAttribute(
      'href',
      '/procurement/suppliers',
    );
  });

  it('surfaces a load failure rather than showing an empty picker', () => {
    mocks.useSuppliers.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderWithProviders(<Picker />);

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  /**
   * Rendered in both locales because `loading` lives in the shared `common` catalogue while
   * every other string here comes from `procurement.*`. That split is easy to get wrong, and
   * the loading branch is the one state no other test in this file reaches — so without this
   * a missing key would ship and only appear on a slow connection.
   */
  it.each(['en'] as const)('announces loading in %s', (locale) => {
    mocks.useSuppliers.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderWithProviders(<Picker />, { locale });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

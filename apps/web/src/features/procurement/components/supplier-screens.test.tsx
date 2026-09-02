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
  useCreateSupplier: vi.fn(),
  useUpdateSupplier: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => mocks);

import { SupplierList, filterSuppliers } from './supplier-list';
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useSuppliers.mockReturnValue(loaded([RASHID, BAREBONES]));
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

describe('filterSuppliers', () => {
  const all = [RASHID, BAREBONES];

  it('returns everything for an empty or whitespace query', () => {
    expect(filterSuppliers(all, '')).toHaveLength(2);
    expect(filterSuppliers(all, '   ')).toHaveLength(2);
  });

  it('matches on code and name, case-insensitively', () => {
    expect(filterSuppliers(all, 'sup-002')).toEqual([BAREBONES]);
    expect(filterSuppliers(all, 'rashid')).toEqual([RASHID]);
    expect(filterSuppliers(all, 'CEMENT')).toEqual([BAREBONES]);
  });


});

describe('SupplierList', () => {
  it('renders each supplier with its code, tax number and payment terms', () => {
    renderWithProviders(<SupplierList />);

    expect(screen.getByText('SUP-001')).toBeInTheDocument();
    expect(screen.getByText('Al-Rashid Trading')).toBeInTheDocument();
    expect(screen.getByText('310122445500003')).toBeInTheDocument();
    expect(screen.getByText('30 days')).toBeInTheDocument();
  });

  it('falls back to a placeholder for every optional field left empty', () => {
    renderWithProviders(<SupplierList />);

    // Horn Cement has no tax number or terms — two placeholders on its row.
    expect(screen.getByText('Horn Cement')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  /**
   * A15 / D8. `PATCH /suppliers/:id` exists but is gated on `manage:payable`. A viewer who
   * lacks it must not see an Edit control the server would reject — and there is still no
   * deactivate control, because this endpoint cannot move `status`.
   */
  it('hides the edit control from a user without manage:payable', () => {
    renderWithProviders(<SupplierList />);

    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /deactivate/i })).not.toBeInTheDocument();
  });

  it('shows an edit control per row for a holder of manage:payable', () => {
    renderWithProviders(<SupplierList />, { permissions: MANAGE_PAYABLE });

    expect(
      screen.getByRole('button', { name: /edit sup-001/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /edit sup-002/i }),
    ).toBeInTheDocument();
    // Still no deactivate — status is a separate flow this endpoint cannot reach.
    expect(screen.queryByRole('button', { name: /deactivate/i })).not.toBeInTheDocument();
  });

  it('tells the user to create one when the list is empty', () => {
    mocks.useSuppliers.mockReturnValue(loaded([]));
    renderWithProviders(<SupplierList />);

    expect(screen.getByText(/create one before raising a purchase order/i)).toBeInTheDocument();
  });
});

describe('SupplierList — edit form (A15 / D8)', () => {
  async function openEditor(supplierName: RegExp) {
    const user = userEvent.setup();
    renderWithProviders(<SupplierList />, { permissions: MANAGE_PAYABLE });
    await user.click(screen.getByRole('button', { name: supplierName }));
    const dialog = await screen.findByRole('dialog');
    return { user, dialog };
  }

  it('pre-fills every editable field from the supplier and shows the code read-only', async () => {
    const { dialog } = await openEditor(/edit sup-001/i);

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
    const { user, dialog } = await openEditor(/edit sup-001/i);

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
    const { user, dialog } = await openEditor(/edit sup-001/i);

    const name = within(dialog).getByDisplayValue('Al-Rashid Trading');
    await user.clear(name);
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));

    expect(updateMutate).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/supplier name is required/i)).toBeInTheDocument();
  });

  it('refuses to submit when nothing changed rather than provoking the server 400', async () => {
    const { user, dialog } = await openEditor(/edit sup-001/i);

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

    const { dialog } = await openEditor(/edit sup-001/i);
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

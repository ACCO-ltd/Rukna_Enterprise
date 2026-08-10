import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { Supplier } from '../types';

/**
 * Tier A — the supplier master and the shared picker.
 *
 * Rendering against the real catalogues is half the point: `renderWithProviders` throws on
 * a missing key, so every string these components ask for is proven to exist in English
 * and Arabic. `catalogues.test.ts` proves en and ar agree with each other; only this proves
 * they agree with the code.
 *
 * The behavioural assertions each pin a decision that a future reader would otherwise be
 * tempted to undo:
 *
 *  - no edit or deactivate control anywhere, because the API has no PATCH (A15)
 *  - the write-once warning on both the screen and the create form
 *  - the picker's empty state links to the Suppliers screen rather than rendering an empty
 *    select, because no environment seeds a supplier
 */

const mocks = vi.hoisted(() => ({
  useSuppliers: vi.fn(),
  useCreateSupplier: vi.fn(),
}));

vi.mock('../hooks/use-procurement', () => mocks);

import { SupplierList, filterSuppliers } from './supplier-list';
import { SupplierPicker, supplierOptionLabel } from './supplier-picker';

const RASHID: Supplier = {
  id: 'sup-1',
  code: 'SUP-001',
  name: 'Al-Rashid Trading',
  nameAr: 'الراشد للتجارة',
  taxNumber: '310122445500003',
  defaultCurrency: 'USD',
  paymentTermsDays: 30,
  status: 'ACTIVE',
};

const BAREBONES: Supplier = {
  id: 'sup-2',
  code: 'SUP-002',
  name: 'Horn Cement',
  nameAr: null,
  taxNumber: null,
  defaultCurrency: null,
  paymentTermsDays: null,
  status: 'ACTIVE',
};

function loaded(data: Supplier[]) {
  return { data, isPending: false, isError: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useSuppliers.mockReturnValue(loaded([RASHID, BAREBONES]));
  mocks.useCreateSupplier.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  });
});

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

  it('matches on the Arabic name, so an Arabic user can search in Arabic', () => {
    expect(filterSuppliers(all, 'الراشد')).toEqual([RASHID]);
  });

  it('does not throw on a supplier with no Arabic name', () => {
    expect(() => filterSuppliers([BAREBONES], 'x')).not.toThrow();
    expect(filterSuppliers([BAREBONES], 'x')).toEqual([]);
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

    // Horn Cement has no tax number, currency or terms — three placeholders on its row.
    expect(screen.getByText('Horn Cement')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  /**
   * A15. There is no `PATCH /suppliers/:id` and nothing sets `status`, so offering either
   * control would be an input that silently does nothing. If an edit button ever appears
   * here, the endpoint has to appear first.
   */
  it('offers no edit or deactivate control', () => {
    renderWithProviders(<SupplierList />);

    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /deactivate/i })).not.toBeInTheDocument();
  });

  it('warns that a supplier cannot be edited once created', () => {
    renderWithProviders(<SupplierList />);

    expect(screen.getByText(/cannot be edited or deactivated/i)).toBeInTheDocument();
  });

  it('renders in Arabic without a missing translation key', () => {
    renderWithProviders(<SupplierList />, { locale: 'ar' });

    expect(screen.getByRole('heading', { name: 'الموردون' })).toBeInTheDocument();
  });

  it('tells the user to create one when the list is empty', () => {
    mocks.useSuppliers.mockReturnValue(loaded([]));
    renderWithProviders(<SupplierList />);

    expect(screen.getByText(/create one before raising a purchase order/i)).toBeInTheDocument();
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

  it('lists every supplier as an option', () => {
    renderWithProviders(<Picker />);

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
  it.each(['en', 'ar'] as const)('announces loading in %s', (locale) => {
    mocks.useSuppliers.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderWithProviders(<Picker />, { locale });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

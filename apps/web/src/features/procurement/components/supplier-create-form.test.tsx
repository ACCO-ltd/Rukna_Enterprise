import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PROCUREMENT_PERMISSIONS } from '@/features/auth/permissions/can';
import { ApiError } from '@/lib/api-client';
import { chooseOption, openSelect } from '@/test/choose-option';
import { renderWithProviders } from '@/test/render';

/**
 * New supplier as a full page (ADR-037). It sends only what `POST /suppliers` accepts, and the
 * list's "New supplier" now links here instead of opening a dialog.
 */

const mocks = vi.hoisted(() => ({
  useCreateSupplier: vi.fn(),
  useSuppliers: vi.fn(),
  useSupplier: vi.fn(() => ({ data: undefined })),
  useSupplierDirectory: vi.fn(() => ({ data: [], isPending: false, isError: false, refetch: vi.fn() })),
  useDeactivateSupplier: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useReactivateSupplier: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null })),
  useUpdateSupplier: vi.fn(),
}));
const routerMocks = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }));

vi.mock('../hooks/use-procurement', () => mocks);
vi.mock('next/navigation', () => ({ useRouter: () => routerMocks, usePathname: () => '/procurement/suppliers/new' }));

import { SupplierCreateForm } from './supplier-create-form';
import { SupplierList } from './supplier-list';

const MANAGE = [PROCUREMENT_PERMISSIONS.manageSuppliers];
const mutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useCreateSupplier.mockReturnValue({ mutate, reset: vi.fn(), isPending: false, isSuccess: false, isError: false, error: null });
  mocks.useSuppliers.mockReturnValue({ data: [], isPending: false, isError: false });
  mocks.useUpdateSupplier.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false, error: null });
});

const byId = (id: string) => document.getElementById(id) as HTMLElement;

describe('SupplierCreateForm', () => {
  it('asks for the name, short code, tax ID and payment terms — and nothing the API does not take', () => {
    renderWithProviders(<SupplierCreateForm />, { permissions: MANAGE });

    expect(screen.getByLabelText(/^Supplier name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Short code/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Tax ID/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Payment terms/)).toBeInTheDocument();
    expect(screen.getByText('Suppliers are shared by purchase orders, goods receipts, bills and payments.')).toBeInTheDocument();
    for (const absent of [/currency/i, /address/i, /district/i, /contact/i, /payable account/i]) {
      expect(screen.queryByLabelText(absent)).not.toBeInTheDocument();
    }
  });

  it('offers the agreed terms, from due on receipt to Net 90', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SupplierCreateForm />, { permissions: MANAGE });

    await openSelect(user, byId('supplier-terms'));
    for (const name of ['Due on receipt', 'Net 7', 'Net 14', 'Net 30', 'Net 45', 'Net 60', 'Net 90']) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    }
  });

  it('refuses an empty save and lists the three required fields', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SupplierCreateForm />, { permissions: MANAGE });

    await user.click(screen.getByRole('button', { name: 'Save supplier' }));

    expect(mutate).not.toHaveBeenCalled();
    const summary = screen.getByText('Fix 3 fields before saving').closest('[role="alert"]') as HTMLElement;
    expect(within(summary).getByRole('link', { name: 'Supplier name' })).toBeInTheDocument();
    expect(within(summary).getByRole('link', { name: 'Short code' })).toBeInTheDocument();
    expect(within(summary).getByRole('link', { name: 'Payment terms' })).toBeInTheDocument();
  });

  it('creates the supplier with USD and the chosen terms in days, then returns to the list', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_payload, options) => options.onSuccess({ id: 'sup-9' }));
    renderWithProviders(<SupplierCreateForm />, { permissions: MANAGE });

    await user.type(byId('supplier-name'), 'Horn Cement Ltd');
    await user.type(byId('supplier-code'), 'SUP-009');
    await chooseOption(user, byId('supplier-terms'), '30');
    await user.click(screen.getByRole('button', { name: 'Save supplier' }));

    expect(mutate.mock.calls[0]![0]).toEqual({
      code: 'SUP-009',
      name: 'Horn Cement Ltd',
      defaultCurrency: 'USD',
      paymentTermsDays: 30,
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/procurement/suppliers');
  });

  it('sends Due on receipt as zero days, and a tax ID when one is given', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SupplierCreateForm />, { permissions: MANAGE });

    await user.type(byId('supplier-name'), 'Horn Cement Ltd');
    await user.type(byId('supplier-code'), 'SUP-009');
    await user.type(byId('supplier-tax-id'), '310122445500003');
    await chooseOption(user, byId('supplier-terms'), '0');
    await user.click(screen.getByRole('button', { name: 'Save supplier' }));

    expect(mutate.mock.calls[0]![0]).toMatchObject({ taxNumber: '310122445500003', paymentTermsDays: 0 });
  });

  it('shows a duplicate code (409) on the short-code field', () => {
    mocks.useCreateSupplier.mockReturnValue({
      mutate,
      reset: vi.fn(),
      isPending: false,
      isSuccess: false,
      isError: true,
      error: new ApiError(409, 'Supplier code SUP-001 already exists', 'CONFLICT'),
    });
    renderWithProviders(<SupplierCreateForm />, { permissions: MANAGE });

    expect(byId('supplier-code-error')).toHaveTextContent('Supplier code SUP-001 already exists');
  });

  it('refuses the page to a user who cannot manage suppliers', () => {
    renderWithProviders(<SupplierCreateForm />);

    expect(screen.queryByLabelText(/^Supplier name/)).not.toBeInTheDocument();
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });
});

describe('SupplierList — New supplier', () => {
  it('links to the create page for a user who can manage suppliers', () => {
    renderWithProviders(<SupplierList />, { permissions: MANAGE });

    expect(screen.getAllByRole('link', { name: 'New supplier' })[0]).toHaveAttribute('href', '/procurement/suppliers/new');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is withheld without the permission', () => {
    renderWithProviders(<SupplierList />);

    expect(screen.queryByRole('link', { name: 'New supplier' })).not.toBeInTheDocument();
  });
});

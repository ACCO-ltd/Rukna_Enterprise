import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

import type { TaxCode, TaxCodesView } from '../tax-codes';
import { TaxCodes } from './tax-codes';

/**
 * Accounting → Tax (ADR-041): view:accounting reads, manage:accounting maintains codes and the
 * default sales code.
 */

const api = vi.hoisted(() => ({
  listTaxCodes: vi.fn(),
  createTaxCode: vi.fn(),
  setDefaultOutputTaxCode: vi.fn(),
  setTaxCodeActive: vi.fn(),
}));

vi.mock('../api/accounting-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

function code(
  id: string,
  codeText: string,
  name: string,
  ratePercent: string,
  extra: Partial<TaxCode> = {},
): TaxCode {
  return {
    id,
    code: codeText,
    name,
    ratePercent,
    direction: 'OUTPUT',
    status: 'ACTIVE',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    isDefault: false,
    ...extra,
  };
}

const VAT5 = code('tc-5', 'VAT5_OUT', 'Sales tax 5%', '5', { isDefault: true });
const EXEMPT = code('tc-0', 'EXEMPT', 'No tax', '0');
const INPUT = code('tc-in', 'VAT5_IN', 'Purchase VAT', '5', { direction: 'INPUT' });

function view(codes: TaxCode[], defaultId: string | null = 'tc-5'): TaxCodesView {
  return {
    codes: codes.map((c) => ({ ...c, isDefault: c.id === defaultId })),
    defaultOutputTaxCodeId: defaultId,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listTaxCodes.mockResolvedValue(view([VAT5, EXEMPT, INPUT]));
});

const VIEW = ['view:accounting'];
const MANAGE = ['view:accounting', 'manage:accounting'];

const rowOf = async (text: string) => (await screen.findByText(text)).closest('tr')!;

describe('TaxCodes — reading', () => {
  it('lists each code with its rate, side, status and the default badge', async () => {
    renderWithProviders(<TaxCodes />, { permissions: VIEW });

    const vat = await rowOf('VAT5_OUT');
    expect(vat).toHaveTextContent('Sales tax 5%');
    expect(vat).toHaveTextContent('5%');
    expect(vat).toHaveTextContent('Sales');
    expect(within(vat).getByText('Default')).toBeInTheDocument();
    expect(within(vat).getByText('Active')).toBeInTheDocument();

    const input = await rowOf('VAT5_IN');
    expect(input).toHaveTextContent('Purchases');
    expect(within(input).queryByText('Default')).not.toBeInTheDocument();

    expect(screen.getByText(/A tax code's rate never changes/)).toBeInTheDocument();
  });

  it('is read-only without manage:accounting', async () => {
    renderWithProviders(<TaxCodes />, { permissions: VIEW });
    await screen.findByText('VAT5_OUT');
    expect(screen.queryByRole('button', { name: 'New tax code' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Make default/ })).not.toBeInTheDocument();
    expect(screen.getByText('Only Finance can change tax codes.')).toBeInTheDocument();
  });

  it('warns when no default sales tax is set', async () => {
    api.listTaxCodes.mockResolvedValue(view([VAT5, EXEMPT], null));
    renderWithProviders(<TaxCodes />, { permissions: MANAGE });
    expect(
      await screen.findByText(/No default sales tax is set, so client invoices can't be raised/),
    ).toBeInTheDocument();
  });

  it('shows the grid error with a retry when the list fails', async () => {
    api.listTaxCodes.mockRejectedValue(new ApiError(500, 'boom'));
    renderWithProviders(<TaxCodes />, { permissions: VIEW });
    expect(await screen.findByText('Could not load tax codes.')).toBeInTheDocument();
  });
});

describe('TaxCodes — managing', () => {
  it('creates a sales code with the exact body', async () => {
    const user = userEvent.setup();
    api.createTaxCode.mockResolvedValue(
      view([VAT5, EXEMPT, INPUT, code('tc-6', 'VAT6_OUT', 'Sales tax 6%', '6')]),
    );
    renderWithProviders(<TaxCodes />, { permissions: MANAGE, withToast: true });

    await screen.findByText('VAT5_OUT');
    await user.click(screen.getAllByRole('button', { name: 'New tax code' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'New tax code' });

    await user.type(within(dialog).getByLabelText('Name'), 'Sales tax 6%');
    await user.type(within(dialog).getByLabelText('Code'), 'vat6_out');
    await user.type(within(dialog).getByLabelText('Rate (%)'), '6');
    await user.click(within(dialog).getByRole('button', { name: 'Create tax code' }));

    await waitFor(() =>
      expect(api.createTaxCode).toHaveBeenCalledWith({
        code: 'VAT6_OUT',
        name: 'Sales tax 6%',
        ratePercent: '6',
        direction: 'OUTPUT',
      }),
    );
    expect(await screen.findByText('Tax code VAT6_OUT created')).toBeInTheDocument();
    expect(await screen.findByText('VAT6_OUT')).toBeInTheDocument();
  });

  it('refuses a taken code and a bad rate before sending', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TaxCodes />, { permissions: MANAGE });

    await screen.findByText('VAT5_OUT');
    await user.click(screen.getAllByRole('button', { name: 'New tax code' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'New tax code' });
    await user.type(within(dialog).getByLabelText('Name'), 'Dup');
    await user.type(within(dialog).getByLabelText('Code'), 'EXEMPT');
    await user.type(within(dialog).getByLabelText('Rate (%)'), '150');
    await user.click(within(dialog).getByRole('button', { name: 'Create tax code' }));

    expect(within(dialog).getByText('A tax code with this code already exists.')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Enter a rate from 0 to 100, with at most four decimals.'),
    ).toBeInTheDocument();
    expect(api.createTaxCode).not.toHaveBeenCalled();
  });

  it('makes an active sales code the default', async () => {
    const user = userEvent.setup();
    api.setDefaultOutputTaxCode.mockResolvedValue(view([VAT5, EXEMPT, INPUT], 'tc-0'));
    renderWithProviders(<TaxCodes />, { permissions: MANAGE, withToast: true });

    const exempt = await rowOf('EXEMPT');
    // Not offered on the default itself, nor on a purchases code.
    expect(
      within(await rowOf('VAT5_OUT')).queryByRole('button', { name: /Make default/ }),
    ).not.toBeInTheDocument();
    expect(
      within(await rowOf('VAT5_IN')).queryByRole('button', { name: /Make default/ }),
    ).not.toBeInTheDocument();

    await user.click(within(exempt).getByRole('button', { name: 'Make default EXEMPT' }));
    await waitFor(() => expect(api.setDefaultOutputTaxCode).toHaveBeenCalledWith('tc-0'));
    expect(await screen.findByText('EXEMPT is now the default sales tax')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(exempt).getByText('Default')).toBeInTheDocument(),
    );
  });

  it('does not offer to deactivate the default, and says why', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TaxCodes />, { permissions: MANAGE });

    await user.click(await screen.findByRole('button', { name: 'Actions for VAT5_OUT' }));
    const item = await screen.findByRole('menuitem', { name: /Deactivate/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByText("The default can't be deactivated — make another code the default first."),
    ).toBeInTheDocument();
  });

  it('deactivates a non-default code after confirming', async () => {
    const user = userEvent.setup();
    api.setTaxCodeActive.mockResolvedValue(
      view([VAT5, { ...EXEMPT, status: 'INACTIVE' }, INPUT]),
    );
    renderWithProviders(<TaxCodes />, { permissions: MANAGE });

    await user.click(await screen.findByRole('button', { name: 'Actions for EXEMPT' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate EXEMPT' });
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate code' }));

    await waitFor(() => expect(api.setTaxCodeActive).toHaveBeenCalledWith('tc-0', false));
  });

  it('explains a 409 TAX_CODE_IS_DEFAULT inside the confirmation', async () => {
    const user = userEvent.setup();
    api.setTaxCodeActive.mockRejectedValue(
      new ApiError(409, 'is default', 'TAX_CODE_IS_DEFAULT'),
    );
    renderWithProviders(<TaxCodes />, { permissions: MANAGE });

    await user.click(await screen.findByRole('button', { name: 'Actions for EXEMPT' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate EXEMPT' });
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate code' }));

    expect(
      await within(dialog).findByText(
        'This is the default sales tax. Make another code the default first.',
      ),
    ).toBeInTheDocument();
  });
});

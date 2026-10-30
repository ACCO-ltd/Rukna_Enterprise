import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { InvoiceNumbering } from '../types';
import { InvoiceNumberingSettings } from './invoice-numbering-settings';

/** CI-8 — Invoice settings → Invoice numbering. */

const mocks = vi.hoisted(() => ({
  useInvoiceNumbering: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock('../hooks/use-accounting', () => ({
  useInvoiceNumbering: mocks.useInvoiceNumbering,
  useUpdateInvoiceNumbering: () => ({ mutate: mocks.mutate, isPending: false, isError: false, error: null }),
}));
vi.mock('../invoice-overdue', () => ({ todayWireDate: () => '2026-10-30' }));

const SAVED: InvoiceNumbering = {
  prefix: 'INV-',
  resetPolicy: 'NEVER',
  paddingLength: 6,
  nextNumber: 43,
  nextInvoiceNumber: 'INV-000043',
  updatedAt: null,
};
const MANAGE = ['manage:accounting'];

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.useInvoiceNumbering.mockReturnValue({ data: SAVED, isError: false });
});

describe('InvoiceNumberingSettings', () => {
  it('shows the next invoice number and an example of every format', () => {
    renderWithProviders(<InvoiceNumberingSettings />, { permissions: MANAGE });
    expect(screen.getByText('INV-000043')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Running number/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Yearly INV-2026-0001/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Monthly INV-2026-10-0001/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Daily INV-2026-10-30-001/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save numbering' })).toBeDisabled();
  });

  it('switches to yearly with 4 digits, starting the year at 1, and saves it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InvoiceNumberingSettings />, { permissions: MANAGE });
    await user.click(screen.getByRole('radio', { name: /Yearly/ }));
    expect(screen.getByLabelText('Next number this year')).toHaveValue('1');
    expect(screen.getByText(/Next invoice/)).toHaveTextContent('Next invoice: INV-2026-0001');
    await user.click(screen.getByRole('button', { name: 'Save numbering' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ prefix: 'INV-', resetPolicy: 'YEARLY', paddingLength: 4, nextNumber: 1 });
  });

  it('carries on from an old system’s last number', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InvoiceNumberingSettings />, { permissions: MANAGE });
    const next = screen.getByLabelText('Next number');
    await user.clear(next);
    await user.type(next, '3151');
    expect(screen.getByText('INV-003151')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save numbering' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ prefix: 'INV-', resetPolicy: 'NEVER', paddingLength: 6, nextNumber: 3151 });
  });

  it('is read-only without manage:accounting', () => {
    renderWithProviders(<InvoiceNumberingSettings />, { permissions: ['view:accounting'] });
    expect(screen.queryByRole('button', { name: 'Save numbering' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Prefix')).toBeDisabled();
  });
});

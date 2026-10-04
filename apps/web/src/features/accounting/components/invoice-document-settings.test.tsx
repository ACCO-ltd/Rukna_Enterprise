import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { InvoiceDocumentSettings } from '../types';
import { InvoiceDocumentSettingsPanel, incompleteRows, rowsToSave } from './invoice-document-settings';

/** Accounting → Invoice settings: the bank table, notes and signatory on invoice PDFs. */

const mocks = vi.hoisted(() => ({
  useInvoiceDocumentSettings: vi.fn(),
  useUpdateInvoiceDocumentSettings: vi.fn(),
}));

vi.mock('../hooks/use-accounting', () => ({
  useInvoiceDocumentSettings: mocks.useInvoiceDocumentSettings,
  useUpdateInvoiceDocumentSettings: mocks.useUpdateInvoiceDocumentSettings,
}));

const SETTINGS: InvoiceDocumentSettings = {
  paymentAccounts: [],
  notes: null,
  defaultNotes: ['Please quote the invoice number in your payment.', 'This invoice is issued in accordance with the project contract.'],
  signatoryName: null,
  signatoryTitle: null,
  updatedAt: null,
};

const mutate = vi.fn();
const settingsWith = (over: Partial<InvoiceDocumentSettings>) =>
  mocks.useInvoiceDocumentSettings.mockReturnValue({ data: { ...SETTINGS, ...over }, isError: false, isPending: false });

beforeEach(() => {
  vi.clearAllMocks();
  settingsWith({});
  mocks.useUpdateInvoiceDocumentSettings.mockReturnValue({ mutate, isPending: false, isError: false });
});

const MANAGE = ['view:accounting', 'manage:accounting'];
const VIEW = ['view:accounting'];

describe('row helpers', () => {
  it('flags half-filled rows and drops fully blank ones', () => {
    const rows = [
      { bankName: 'Salaam Bank', accountNumber: '' },
      { bankName: ' ', accountNumber: ' ' },
      { bankName: ' Premier Bank ', accountNumber: ' 0102 ' },
    ];
    expect(incompleteRows(rows)).toEqual([0]);
    expect(rowsToSave(rows.slice(1))).toEqual([{ bankName: 'Premier Bank', accountNumber: '0102' }]);
  });
});

describe('InvoiceDocumentSettingsPanel', () => {
  it('starts with no banks, the standard notes and Save disabled', () => {
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });
    expect(screen.getByRole('heading', { name: 'Invoice settings' })).toBeInTheDocument();
    expect(screen.getByText('No bank accounts yet — invoices print without a Bank Account Details table.')).toBeInTheDocument();
    expect(screen.getByText('Please quote the invoice number in your payment.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  });

  it('adds typed bank rows and a typed signatory, and saves them trimmed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });

    await user.click(screen.getByRole('button', { name: 'Add bank' }));
    await user.type(screen.getByLabelText('Bank 1'), 'Salaam Bank');
    await user.type(screen.getByLabelText('Account number 1'), '33020045871');
    await user.click(screen.getByRole('button', { name: 'Add bank' }));
    await user.type(screen.getByLabelText('Bank 2'), ' Premier Bank ');
    await user.type(screen.getByLabelText('Account number 2'), '0102 0033 4410');
    await user.type(screen.getByLabelText('Name'), 'Ahmed Ali');
    await user.type(screen.getByLabelText('Title'), 'Finance Manager');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(mutate).toHaveBeenCalledWith({
      paymentAccounts: [
        { bankName: 'Salaam Bank', accountNumber: '33020045871' },
        { bankName: 'Premier Bank', accountNumber: '0102 0033 4410' },
      ],
      notes: null,
      signatoryName: 'Ahmed Ali',
      signatoryTitle: 'Finance Manager',
    });
  });

  it('refuses to save a row with only one of its two fields', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });
    await user.click(screen.getByRole('button', { name: 'Add bank' }));
    await user.type(screen.getByLabelText('Bank 1'), 'Dahabshiil Bank');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByText('Each bank needs both a bank name and an account number.')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('removes a saved bank and caps the table at eight rows', async () => {
    const user = userEvent.setup();
    settingsWith({
      paymentAccounts: Array.from({ length: 8 }, (_, i) => ({ bankName: `Bank ${i + 1}`, accountNumber: `${i}` })),
      updatedAt: '2026-10-04T00:00:00Z',
    });
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });
    expect(screen.queryByRole('button', { name: 'Add bank' })).not.toBeInTheDocument();
    expect(screen.getByText('An invoice prints at most 8 bank accounts.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove bank 1' }));
    expect(screen.getByRole('button', { name: 'Add bank' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(mutate.mock.calls[0][0].paymentAccounts).toHaveLength(7);
    expect(mutate.mock.calls[0][0].paymentAccounts[0]).toEqual({ bankName: 'Bank 2', accountNumber: '1' });
  });

  it('is read-only without manage:accounting', () => {
    settingsWith({ paymentAccounts: [{ bankName: 'My Bank', accountNumber: '7700' }] });
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: VIEW });
    expect(screen.getByText('Only Finance (manage accounting) can change these settings.')).toBeInTheDocument();
    expect(screen.getByLabelText('Bank 1')).toBeDisabled();
    expect(screen.getByLabelText('Invoice notes')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add bank' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
  });

  it('reports a load failure', () => {
    mocks.useInvoiceDocumentSettings.mockReturnValue({ data: undefined, isError: true, isPending: false });
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });
    expect(screen.getByText('Could not load the invoice settings.')).toBeInTheDocument();
  });
});

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { InvoiceDocumentSettings } from '../types';
import {
  InvoiceDocumentSettingsPanel,
  contactProblems,
  incompleteRows,
  rowsToSave,
  toPreviewBody,
  type Draft,
} from './invoice-document-settings';

/** Accounting → Invoice settings: the bank table, notes and signatory on invoice PDFs. */

const mocks = vi.hoisted(() => ({
  useInvoiceDocumentSettings: vi.fn(),
  useUpdateInvoiceDocumentSettings: vi.fn(),
  useInvoiceSettingsPreview: vi.fn(),
}));

vi.mock('../hooks/use-accounting', () => ({
  useInvoiceDocumentSettings: mocks.useInvoiceDocumentSettings,
  useUpdateInvoiceDocumentSettings: mocks.useUpdateInvoiceDocumentSettings,
  useInvoiceSettingsPreview: mocks.useInvoiceSettingsPreview,
}));

const SETTINGS: InvoiceDocumentSettings = {
  paymentAccounts: [],
  notes: null,
  defaultNotes: [
    'Please quote the invoice number in your payment.',
    'This invoice is issued in accordance with the project contract.',
  ],
  signatoryName: null,
  signatoryTitle: null,
  tagline: null,
  footerAddress: null,
  defaultFooterAddress: 'Olow Tower, Maka Al-Mukarama Road\nMogadishu, Somalia',
  footerPhones: [],
  footerEmail: null,
  footerWebsite: null,
  showBankDetails: false,
  showNotes: false,
  updatedAt: null,
};

/** What a save sends for the untouched defaults; tests override the fields they change. */
const UNCHANGED = {
  paymentAccounts: [],
  notes: null,
  signatoryName: null,
  signatoryTitle: null,
  tagline: null,
  footerAddress: null,
  footerPhones: [],
  footerEmail: null,
  footerWebsite: null,
  showBankDetails: false,
  showNotes: false,
};

const mutate = vi.fn();
const settingsWith = (over: Partial<InvoiceDocumentSettings>) =>
  mocks.useInvoiceDocumentSettings.mockReturnValue({
    data: { ...SETTINGS, ...over },
    isError: false,
    isPending: false,
  });

beforeEach(() => {
  vi.clearAllMocks();
  settingsWith({});
  mocks.useUpdateInvoiceDocumentSettings.mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
  });
  mocks.useInvoiceSettingsPreview.mockReturnValue({
    data: undefined,
    isFetching: false,
    isError: false,
    error: null,
  });
});

const DRAFT: Draft = {
  paymentAccounts: [],
  notes: '',
  signatoryName: '',
  signatoryTitle: '',
  tagline: '',
  footerAddress: '',
  phone1: '',
  phone2: '',
  footerEmail: '',
  footerWebsite: '',
  showBankDetails: false,
  showNotes: false,
};

describe('toPreviewBody', () => {
  it('previews a valid draft exactly as it would be saved', () => {
    const { body, partial } = toPreviewBody({
      ...DRAFT,
      tagline: ' Construction ',
      phone1: '+252 61 234 5678',
      footerEmail: 'info@acco.so',
      paymentAccounts: [{ bankName: 'Salaam Bank', accountNumber: '3302' }],
      showBankDetails: true,
    });
    expect(partial).toBe(false);
    expect(body).toMatchObject({
      tagline: 'Construction',
      footerPhones: ['+252 61 234 5678'],
      footerEmail: 'info@acco.so',
      paymentAccounts: [{ bankName: 'Salaam Bank', accountNumber: '3302' }],
      showBankDetails: true,
    });
  });

  it('leaves out values that are not valid yet, and says so', () => {
    const { body, partial } = toPreviewBody({
      ...DRAFT,
      footerEmail: 'info@',
      footerWebsite: 'acco',
      phone1: '+2',
      footerAddress: 'a\nb\nc',
      paymentAccounts: [
        { bankName: 'Salaam Bank', accountNumber: '' },
        { bankName: 'Premier', accountNumber: '01' },
      ],
    });
    expect(partial).toBe(true);
    expect(body).toMatchObject({
      footerEmail: null,
      footerWebsite: null,
      footerPhones: [],
      footerAddress: null,
      paymentAccounts: [{ bankName: 'Premier', accountNumber: '01' }],
    });
  });
});

const MANAGE = ['view:accounting', 'manage:accounting'];

describe('the live preview', () => {
  it('previews the form as typed, marked unsaved', async () => {
    const user = userEvent.setup();
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
    mocks.useInvoiceSettingsPreview.mockReturnValue({
      data: new Blob(['%PDF']),
      isFetching: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });

    expect(screen.getByRole('heading', { name: 'Invoice preview' })).toBeInTheDocument();
    expect(mocks.useInvoiceSettingsPreview).toHaveBeenLastCalledWith(
      expect.objectContaining({ tagline: null, showBankDetails: false }),
    );

    await user.type(screen.getByLabelText('Tagline'), 'Construction');
    expect(screen.getByText('12 / 80')).toBeInTheDocument();
    // The request waits for typing to pause; the panel says it is updating meanwhile.
    const panel = screen.getByRole('region', { name: 'Invoice preview' });
    expect(within(panel).getByRole('status')).toHaveTextContent('Updating…');
    expect(mocks.useInvoiceSettingsPreview).not.toHaveBeenLastCalledWith(
      expect.objectContaining({ tagline: 'Construction' }),
    );
    await waitFor(
      () =>
        expect(mocks.useInvoiceSettingsPreview).toHaveBeenLastCalledWith(
          expect.objectContaining({ tagline: 'Construction' }),
        ),
      { timeout: 2000 },
    );
    expect(screen.getByText('Not saved yet')).toBeInTheDocument();
    expect(screen.getByTitle('Invoice preview (PDF)')).toHaveAttribute(
      'src',
      'blob:preview#toolbar=0&navpanes=0&view=FitH',
    );
    expect(screen.getByRole('link', { name: 'Open full size' })).toHaveAttribute(
      'href',
      'blob:preview',
    );
  });

  it('notes values left out of the preview, and shows a render failure', () => {
    mocks.useInvoiceSettingsPreview.mockReturnValue({
      data: undefined,
      isFetching: false,
      isError: true,
      error: new Error('boom'),
    });
    settingsWith({ footerEmail: 'info@' });
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: VIEW });

    expect(
      screen.getByText(
        'Some values are not complete yet and are left out of the preview until they are.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The preview could not be rendered.');
  });
});
const VIEW = ['view:accounting'];

describe('row helpers', () => {
  it('flags half-filled rows and drops fully blank ones', () => {
    const rows = [
      { bankName: 'Salaam Bank', accountNumber: '' },
      { bankName: ' ', accountNumber: ' ' },
      { bankName: ' Premier Bank ', accountNumber: ' 0102 ' },
    ];
    expect(incompleteRows(rows)).toEqual([0]);
    expect(rowsToSave(rows.slice(1))).toEqual([
      { bankName: 'Premier Bank', accountNumber: '0102' },
    ]);
  });
});

describe('InvoiceDocumentSettingsPanel', () => {
  it('starts with no banks, the standard notes and Save disabled', () => {
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });
    expect(screen.getByRole('heading', { name: 'Invoice settings' })).toBeInTheDocument();
    expect(screen.getByText('No bank accounts yet.')).toBeInTheDocument();
    expect(
      screen.getByText('Please quote the invoice number in your payment.'),
    ).toBeInTheDocument();
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
      ...UNCHANGED,
      paymentAccounts: [
        { bankName: 'Salaam Bank', accountNumber: '33020045871' },
        { bankName: 'Premier Bank', accountNumber: '0102 0033 4410' },
      ],
      signatoryName: 'Ahmed Ali',
      signatoryTitle: 'Finance Manager',
    });
  });

  it('saves the tagline, footer contacts and the two section switches', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });

    expect(
      screen.getByText('Left blank, the footer prints the organisation address shown above.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Print bank account details on invoices')).not.toBeChecked();
    expect(screen.getByLabelText('Print notes on invoices')).not.toBeChecked();

    await user.type(screen.getByLabelText('Tagline'), 'Construction & Development');
    await user.type(screen.getByLabelText('Phone 1'), '+252 61 234 5678');
    await user.type(screen.getByLabelText('Phone 2'), '+252 90 123 4567');
    await user.type(screen.getByLabelText('Email'), 'info@acco.com');
    await user.type(screen.getByLabelText('Website'), 'www.acco.com');
    await user.click(screen.getByLabelText('Print bank account details on invoices'));
    await user.click(screen.getByLabelText('Print notes on invoices'));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    expect(mutate).toHaveBeenCalledWith({
      ...UNCHANGED,
      tagline: 'Construction & Development',
      footerPhones: ['+252 61 234 5678', '+252 90 123 4567'],
      footerEmail: 'info@acco.com',
      footerWebsite: 'www.acco.com',
      showBankDetails: true,
      showNotes: true,
    });
  });

  it('refuses a malformed email or website before saving', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });
    await user.type(screen.getByLabelText('Email'), 'info@acco');
    await user.type(screen.getByLabelText('Website'), 'not a site');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(screen.getByText('Enter an email address like info@acco.com.')).toBeInTheDocument();
    expect(screen.getByText('Enter a website like www.acco.com.')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
    expect(contactProblems({ footerEmail: 'a@b.co', footerWebsite: 'https://acco.com/x' })).toEqual(
      [],
    );
  });

  it('refuses a footer address that cannot fit two lines of 60 characters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });
    expect(screen.getByText('Up to 2 lines of 60 characters each.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Address'), 'x'.repeat(70));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(
      screen.getByText('The footer fits 2 lines of 60 characters each. Shorten the address.'),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
    expect(
      contactProblems({ footerEmail: '', footerWebsite: '', footerAddress: 'a\nb\nc' }),
    ).toEqual(['address']);
  });

  it('refuses to save a row with only one of its two fields', async () => {
    const user = userEvent.setup();
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });
    await user.click(screen.getByRole('button', { name: 'Add bank' }));
    await user.type(screen.getByLabelText('Bank 1'), 'Dahabshiil Bank');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(
      screen.getByText('Each bank needs both a bank name and an account number.'),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('removes a saved bank and caps the table at eight rows', async () => {
    const user = userEvent.setup();
    settingsWith({
      paymentAccounts: Array.from({ length: 8 }, (_, i) => ({
        bankName: `Bank ${i + 1}`,
        accountNumber: `${i}`,
      })),
      updatedAt: '2026-10-04T00:00:00Z',
    });
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });
    expect(screen.queryByRole('button', { name: 'Add bank' })).not.toBeInTheDocument();
    expect(screen.getByText('An invoice prints at most 8 bank accounts.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove bank 1' }));
    expect(screen.getByRole('button', { name: 'Add bank' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(mutate.mock.calls[0][0].paymentAccounts).toHaveLength(7);
    expect(mutate.mock.calls[0][0].paymentAccounts[0]).toEqual({
      bankName: 'Bank 2',
      accountNumber: '1',
    });
  });

  it('is read-only without manage:accounting', () => {
    settingsWith({ paymentAccounts: [{ bankName: 'My Bank', accountNumber: '7700' }] });
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: VIEW });
    expect(
      screen.getByText('Only Finance (manage accounting) can change these settings.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Bank 1')).toBeDisabled();
    expect(screen.getByLabelText('Invoice notes')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add bank' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
  });

  it('reports a load failure', () => {
    mocks.useInvoiceDocumentSettings.mockReturnValue({
      data: undefined,
      isError: true,
      isPending: false,
    });
    renderWithProviders(<InvoiceDocumentSettingsPanel />, { permissions: MANAGE });
    expect(screen.getByText('Could not load the invoice settings.')).toBeInTheDocument();
  });
});

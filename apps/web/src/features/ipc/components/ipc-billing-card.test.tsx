import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import {
  generateInvoiceFromIpc,
  listInvoices,
} from '@/features/accounting/api/invoices-api';
import type { ClientInvoice } from '@/features/accounting/types';

import { IpcBillingCard } from './ipc-billing-card';

vi.mock('@/features/accounting/api/invoices-api', () => ({
  listInvoices: vi.fn(),
  getInvoice: vi.fn(),
  generateInvoiceFromIpc: vi.fn(),
  approveInvoice: vi.fn(),
  postInvoice: vi.fn(),
  reverseInvoice: vi.fn(),
}));

function invoice(overrides: Partial<ClientInvoice> = {}): ClientInvoice {
  return {
    id: 'inv-1',
    organizationId: 'org-1',
    invoiceNumber: 'INV-2026-031',
    invoiceDate: '2026-08-10',
    dueDate: '2026-09-09',
    clientId: 'client-1',
    sourceIpcId: 'ipc-1',
    projectId: 'proj-1',
    contractId: 'con-1',
    currencyCode: 'SOS',
    subtotal: '6190.48',
    vatAmount: '307.52',
    totalAmount: '6498.00',
    outstandingAmount: '6498.00',
    paymentTerms: 'Net 30',
    documentStatus: 'DRAFT',
    postingStatus: 'NOT_POSTED',
    postedJournalEntryId: null,
    postedAt: null,
    postedBy: null,
    reversedAt: null,
    reversalJournalEntryId: null,
    cancelledAt: null,
    cancellationReason: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: '2026-08-10T09:00:00.000Z',
    createdBy: 'user-1',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(listInvoices).mockResolvedValue([]);
  vi.mocked(generateInvoiceFromIpc).mockResolvedValue(invoice());
});

describe('IpcBillingCard', () => {
  it('renders nothing for a certificate that is not effective', () => {
    const { container } = renderWithProviders(
      <IpcBillingCard ipcId="ipc-1" isEffective={false} currency="SOS" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('offers to generate when the certificate has no invoice', async () => {
    renderWithProviders(<IpcBillingCard ipcId="ipc-1" isEffective currency="SOS" />, { permissions: ['manage:receivable'] });

    expect(
      await screen.findByText('No invoice has been raised against this certificate.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate invoice' })).toBeInTheDocument();
  });

  it('shows the existing invoice instead of the action once one exists', async () => {
    vi.mocked(listInvoices).mockResolvedValue([invoice()]);

    renderWithProviders(<IpcBillingCard ipcId="ipc-1" isEffective currency="SOS" />, { permissions: ['manage:receivable'] });

    expect(await screen.findByText('INV-2026-031')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View invoice' })).toHaveAttribute(
      'href',
      '/finance/accounting/invoices/inv-1',
    );
    expect(screen.queryByRole('button', { name: 'Generate invoice' })).not.toBeInTheDocument();
  });

  it('matches the invoice to this certificate and not another', async () => {
    vi.mocked(listInvoices).mockResolvedValue([
      invoice({ id: 'other', invoiceNumber: 'INV-OTHER', sourceIpcId: 'ipc-999' }),
    ]);

    renderWithProviders(<IpcBillingCard ipcId="ipc-1" isEffective currency="SOS" />, { permissions: ['manage:receivable'] });

    expect(
      await screen.findByText('No invoice has been raised against this certificate.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('INV-OTHER')).not.toBeInTheDocument();
  });

  it('sends the ipc id with the chosen dates', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IpcBillingCard ipcId="ipc-1" isEffective currency="SOS" />, { permissions: ['manage:receivable'] });

    await user.click(await screen.findByRole('button', { name: 'Generate invoice' }));
    await user.click(screen.getByRole('button', { name: 'Generate invoice' }));

    expect(generateInvoiceFromIpc).toHaveBeenCalledWith(
      expect.objectContaining({ ipcId: 'ipc-1' }),
    );
  });

  it('defaults the due date to 30 days after the invoice date', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IpcBillingCard ipcId="ipc-1" isEffective currency="SOS" />, { permissions: ['manage:receivable'] });

    await user.click(await screen.findByRole('button', { name: 'Generate invoice' }));

    const invoiceDate = screen.getByLabelText('Invoice date') as HTMLInputElement;
    const dueDate = screen.getByLabelText('Due date') as HTMLInputElement;

    const expected = new Date(`${invoiceDate.value}T00:00:00.000Z`);
    expected.setUTCDate(expected.getUTCDate() + 30);

    expect(dueDate.value).toBe(expected.toISOString().slice(0, 10));
  });

  it('will not let the due date fall before the invoice date', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IpcBillingCard ipcId="ipc-1" isEffective currency="SOS" />, { permissions: ['manage:receivable'] });

    await user.click(await screen.findByRole('button', { name: 'Generate invoice' }));

    const invoiceDate = screen.getByLabelText('Invoice date') as HTMLInputElement;
    expect(screen.getByLabelText('Due date')).toHaveAttribute('min', invoiceDate.value);
  });

  it('says the amount comes from the certificate rather than offering a field', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IpcBillingCard ipcId="ipc-1" isEffective currency="SOS" />, { permissions: ['manage:receivable'] });

    await user.click(await screen.findByRole('button', { name: 'Generate invoice' }));

    expect(screen.getByText(/amount is taken from this certificate/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/total|amount/i)).not.toBeInTheDocument();
  });

});

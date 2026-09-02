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
import { findDayCell } from '@/test/pick-date';

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

    // The controls are triggers now, not inputs with a `.value`. The date each one holds is
    // read back the way a user would see it: open the calendar and look at which cell is
    // selected. `data-day` carries the ISO date, so no formatted string has to be re-parsed.
    const invoice = await selectedDay(user, 'Invoice date');
    const due = await selectedDay(user, 'Due date');

    expect(daysBetween(invoice, due)).toBe(30);
  });

  it('will not let the due date fall before the invoice date', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IpcBillingCard ipcId="ipc-1" isEffective currency="SOS" />, { permissions: ['manage:receivable'] });

    await user.click(await screen.findByRole('button', { name: 'Generate invoice' }));

    // `min` used to be an attribute on a native date input. It is now a constraint the
    // calendar enforces, so the assertion is that the day before the invoice date cannot be
    // chosen — which is the behaviour the attribute was standing in for.
    const invoice = await selectedDay(user, 'Invoice date');
    const dayBefore = addDays(invoice, -1);

    const cell = await findDayCell(user, screen.getByLabelText('Due date'), dayBefore);
    expect(cell).toHaveAttribute('data-disabled');
  });

  it('says the amount comes from the certificate rather than offering a field', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IpcBillingCard ipcId="ipc-1" isEffective currency="SOS" />, { permissions: ['manage:receivable'] });

    await user.click(await screen.findByRole('button', { name: 'Generate invoice' }));

    expect(screen.getByText(/amount is taken from this certificate/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/total|amount/i)).not.toBeInTheDocument();
  });

});

/** The ISO date a picker currently holds, read from the selected cell in its calendar. */
async function selectedDay(user: ReturnType<typeof userEvent.setup>, label: string): Promise<string> {
  await user.click(screen.getByLabelText(label));
  const cell = document.querySelector('[data-day][data-selected]');
  const iso = cell?.getAttribute('data-day');
  await user.keyboard('{Escape}');
  if (!iso) throw new Error(`no day selected in "${label}"`);
  return iso;
}

/** UTC arithmetic on `yyyy-MM-dd`, so neither helper can drift across a timezone boundary. */
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const day = 24 * 60 * 60 * 1000;
  return (Date.parse(`${toIso}T00:00:00.000Z`) - Date.parse(`${fromIso}T00:00:00.000Z`)) / day;
}

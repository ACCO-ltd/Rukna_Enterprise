import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientStatement as ClientStatementData } from '@erp/types';

import { renderWithProviders } from '@/test/render';

/**
 * AR-3 / ST — the client statement: the account by project and contract, the invoices still owed,
 * and every movement with a running balance, with links to the documents.
 */
const search = vi.hoisted(() => ({ params: new URLSearchParams('clientId=c1&from=2026-01-01&to=2026-10-31') }));
vi.mock('next/navigation', () => ({ useSearchParams: () => search.params }));
vi.mock('@/features/clients/hooks/use-clients', () => ({
  useClients: () => ({ isPending: false, data: [{ id: 'c1', name: 'Hargeisa Water Agency', code: 'HWA' }] }),
}));
const api = vi.hoisted(() => ({ apiClient: vi.fn() }));
vi.mock('@/lib/api-client', async (original) => ({ ...(await original<object>()), apiClient: api.apiClient }));

import { ClientStatement } from './client-statement';

const STATEMENT: ClientStatementData = {
  client: { id: 'c1', name: 'Hargeisa Water Agency', code: 'HWA', address: 'Road 1, Hargeisa', taxNumber: 'TIN-77' },
  organization: { name: 'Asas Construction', address: 'Mogadishu', taxNumber: null },
  asOf: '2026-10-31',
  accounts: [
    {
      key: 'contract:k1', kind: 'CONTRACT', projectId: 'p1', projectName: 'Hargeisa Reservoir Works', contractId: 'k1',
      contractNumber: 'ACC-HRG-26-01-C1', contractStatus: 'ACTIVE', contractValue: '500000.00', billedToDate: '250000.00',
      leftToBill: '250000.00', invoiced: '237500.00', received: '200000.00', credited: '0.00', writtenOff: '0.00',
      balanceDue: '37500.00', overdue: '37500.00', retentionHeld: '12500.00', invoiceCount: 1,
    },
    {
      key: 'other', kind: 'OTHER_SALES', projectId: null, projectName: null, contractId: null, contractNumber: null,
      contractStatus: null, contractValue: null, billedToDate: null, leftToBill: null, invoiced: '1400.00', received: '1000.00',
      credited: '0.00', writtenOff: '0.00', balanceDue: '400.00', overdue: '0.00', retentionHeld: '0.00', invoiceCount: 1,
    },
  ],
  openInvoices: [
    { id: 'inv-2', invoiceNumber: 'INV-000002', invoiceDate: '2026-09-01', dueDate: '2026-10-01', projectName: 'Hargeisa Reservoir Works', contractNumber: 'ACC-HRG-26-01-C1', label: null, total: '237500.00', received: '200000.00', adjusted: '0.00', balance: '37500.00', daysOverdue: 30 },
    { id: 'inv-1', invoiceNumber: 'INV-000005', invoiceDate: '2026-10-29', dueDate: '2026-11-28', projectName: null, contractNumber: null, label: 'Crane hire', total: '1400.00', received: '1000.00', adjusted: '0.00', balance: '400.00', daysOverdue: 0 },
  ],
  overdue: '37500.00',
  retentionHeld: '12500.00',
  from: '2026-01-01',
  to: '2026-10-31',
  openingBalance: '0.00',
  lines: [
    { date: '2026-10-29', kind: 'INVOICE', documentId: 'inv-1', reference: 'INV-000005', description: null, debit: '1400.00', credit: null, balance: '1400.00' },
    { date: '2026-10-29', kind: 'RECEIPT', documentId: 'rcp-1', reference: 'RCP-000012', description: 'E2E-AR', debit: null, credit: '1000.00', balance: '400.00' },
  ],
  totals: { debits: '1400.00', credits: '1000.00' },
  closingBalance: '400.00',
  aging: { current: '400.00', d1_30: '0.00', d31_60: '0.00', d61_90: '0.00', d90_plus: '0.00' },
  onAccount: '0.00',
};

const PREVIEW = {
  templateConfigured: true,
  whatsappConfigured: true,
  recipients: [{ contactId: 'k1', name: 'Hodan', role: null, number: '+252615555555', isPrimary: true, source: 'whatsapp' }],
  defaultRecipient: '+252615555555',
  message: 'Hello Hargeisa Water Agency, please find attached your statement of account from ACCO Ltd as of 31 Oct 2026.',
  filename: 'Statement-HWA-2026-10-31.pdf',
  sendable: true,
  blockedReason: null,
};

beforeEach(() => {
  // Each endpoint answers with its own shape: the statement, its PDF, the WhatsApp preview, the messages.
  api.apiClient.mockReset().mockImplementation((url: string) => {
    if (url.startsWith('/communications')) return Promise.resolve([]);
    if (url.includes('/statement/document')) return Promise.resolve(new Blob(['%PDF'], { type: 'application/pdf' }));
    if (url.includes('/statement/whatsapp/preview')) return Promise.resolve(PREVIEW);
    return Promise.resolve(STATEMENT);
  });
});

describe('ClientStatement', () => {
  it('opens on the account by project: contract value, billed, owed, retention, other sales', async () => {
    renderWithProviders(<ClientStatement />);
    expect(await screen.findByText('Statement for')).toBeInTheDocument();
    expect(api.apiClient).toHaveBeenCalledWith('/finance/clients/c1/statement?from=2026-01-01&to=2026-10-31');
    expect(screen.getByText('Tax no. TIN-77')).toBeInTheDocument();
    // Balance due today = open invoices 37,900 − nothing on account.
    expect(screen.getAllByText('Balance due').length).toBeGreaterThan(0);
    const table = within(screen.getByRole('tabpanel', { name: 'By project' }));
    expect(table.getByText('Hargeisa Reservoir Works')).toBeInTheDocument();
    expect(table.getByText('ACC-HRG-26-01-C1 · Active')).toBeInTheDocument();
    expect(table.getAllByText('$500,000.00')).toHaveLength(2); // the contract and the total
    expect(table.getByText('$37,500.00 overdue')).toBeInTheDocument();
    expect(table.getAllByText('$12,500.00').length).toBeGreaterThan(0);
    expect(table.getByText('Other sales')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeInTheDocument();
  });

  it('lists the invoices still owed, most overdue first, and what is due after cash on account', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientStatement />);
    await user.click(await screen.findByRole('tab', { name: /Open invoices/ }));
    const panel = within(screen.getByRole('tabpanel', { name: /Open invoices/ }));
    const rows = panel.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByRole('link', { name: 'INV-000002' })).toHaveAttribute('href', '/finance/accounting/invoices/inv-2');
    expect(within(rows[0]!).getByText('30 days overdue')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Crane hire')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Part paid')).toBeInTheDocument();
    expect(panel.getByText('Balance due').nextSibling).toHaveTextContent('$37,900.00');
  });

  it('shows every movement with its running balance under Activity', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientStatement />);
    await user.click(await screen.findByRole('tab', { name: 'Activity' }));
    const panel = within(screen.getByRole('tabpanel', { name: 'Activity' }));
    expect(panel.getByRole('link', { name: 'INV-000005' })).toHaveAttribute('href', '/finance/accounting/invoices/inv-1');
    expect(panel.getByRole('link', { name: 'RCP-000012' })).toHaveAttribute('href', '/receipts/rcp-1');
    expect(panel.getAllByText('$400.00').length).toBeGreaterThan(0);
  });

  it('downloads the branded statement PDF for the period', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:statement');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    renderWithProviders(<ClientStatement />);
    await user.click(await screen.findByRole('button', { name: 'PDF' }));
    expect(api.apiClient).toHaveBeenCalledWith('/finance/clients/c1/statement/document?from=2026-01-01&to=2026-10-31', { responseType: 'blob' });
    expect(createObjectURL).toHaveBeenCalled();
  });

  it('sends the statement on WhatsApp after showing the exact message', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientStatement />, { withToast: true });
    await user.click(await screen.findByRole('button', { name: 'Send on WhatsApp' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Send statement on WhatsApp')).toBeInTheDocument();
    expect(await dialog.findByText('Statement-HWA-2026-10-31.pdf')).toBeInTheDocument();
    expect(api.apiClient).toHaveBeenCalledWith('/finance/clients/c1/statement/whatsapp/preview?from=2026-01-01&to=2026-10-31');
  });

  it('asks for a client before loading anything', () => {
    search.params = new URLSearchParams();
    renderWithProviders(<ClientStatement />);
    expect(screen.getByText('See what the client owes on each project and contract, which invoices are unpaid, and every payment.')).toBeInTheDocument();
    expect(api.apiClient).not.toHaveBeenCalled();
  });
});

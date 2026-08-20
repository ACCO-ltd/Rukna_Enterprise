import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientStatus } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import { listClients } from '@/features/clients/api/clients-api';
import { listInvoices } from '@/features/accounting/api/invoices-api';
import type { Account, AccountVersion, ClientInvoice } from '@/features/accounting/types';

import { InvoicesList } from './invoices-list';
import { PostInvoiceDialog } from './post-invoice-dialog';

vi.mock('@/features/accounting/api/invoices-api', () => ({
  listInvoices: vi.fn(),
  getInvoice: vi.fn(),
  generateInvoiceFromIpc: vi.fn(),
  approveInvoice: vi.fn(),
  postInvoice: vi.fn(),
  reverseInvoice: vi.fn(),
}));

vi.mock('@/features/clients/api/clients-api', () => ({ listClients: vi.fn() }));

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
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    postedJournalEntryId: 'je-1',
    postedAt: '2026-08-10T10:00:00.000Z',
    postedBy: 'user-1',
    reversedAt: null,
    reversalJournalEntryId: null,
    cancelledAt: null,
    cancellationReason: null,
    approvedBy: 'user-1',
    approvedAt: '2026-08-10T09:30:00.000Z',
    createdAt: '2026-08-10T09:00:00.000Z',
    createdBy: 'user-1',
    ...overrides,
  };
}

function version(overrides: Partial<AccountVersion> = {}): AccountVersion {
  return {
    id: 'ver-1',
    accountId: 'acc-1',
    versionNumber: 1,
    name: 'Accounts Receivable',
    parentAccountId: null,
    accountClass: 'ASSET',
    accountSubtype: 'ACCOUNTS_RECEIVABLE',
    isPostingAllowed: false,
    isControlAccount: true,
    controlledSubledgerType: 'ACCOUNTS_RECEIVABLE',
    controlPostingPolicy: 'SYSTEM_ONLY',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...overrides,
  };
}

function account(code: string, ver: Partial<AccountVersion>): Account {
  return {
    id: `acc-${code}`,
    organizationId: 'org-1',
    code,
    normalBalance: 'DEBIT',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'user-1',
    versions: [version(ver)],
  };
}

function chart(): Account[] {
  return [
    account('11000', { name: 'Accounts Receivable', }),
    account('42600', {
      name: 'Project Income',
      accountSubtype: 'PROJECT_REVENUE',
    }),
    account('20200', {
      name: 'Output VAT Payable',
      accountSubtype: 'VAT_OUTPUT_PAYABLE',
    }),
  ];
}

const client = {
  id: 'client-1',
  organizationId: 'org-1',
  code: 'CL-001',
  name: 'Al-Noor Development',
  taxNumber: null,
  defaultCurrency: 'SOS',
  status: ClientStatus.ACTIVE,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.mocked(listClients).mockResolvedValue([client]);
});

describe('InvoicesList', () => {
  it('renders an invoice with its client name joined from GET /clients', async () => {
    vi.mocked(listInvoices).mockResolvedValue([invoice()]);

    renderWithProviders(<InvoicesList />);

    expect(await screen.findByText('INV-2026-031')).toBeInTheDocument();
    expect(await screen.findByText('Al-Noor Development')).toBeInTheDocument();
  });

  it('labels a draft as unnumbered rather than showing an empty cell', async () => {
    vi.mocked(listInvoices).mockResolvedValue([
      invoice({ invoiceNumber: null, documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' }),
    ]);

    renderWithProviders(<InvoicesList />);

    expect(await screen.findByText('Not yet numbered')).toBeInTheDocument();
  });

  it('shows both status axes, because one badge cannot express the pair', async () => {
    vi.mocked(listInvoices).mockResolvedValue([
      invoice({ documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED' }),
    ]);

    renderWithProviders(<InvoicesList />);

    // Scoped to the table: the status filter renders its own "Approved" option, and an
    // unscoped query would pass on the dropdown while the badge was missing.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Approved')).toBeInTheDocument();
    expect(within(table).getByText('Not posted')).toBeInTheDocument();
  });

  it('filters by document status in the browser', async () => {
    const user = userEvent.setup();
    vi.mocked(listInvoices).mockResolvedValue([
      invoice({ id: 'a', invoiceNumber: 'INV-A', documentStatus: 'APPROVED' }),
      invoice({ id: 'b', invoiceNumber: 'INV-B', documentStatus: 'DRAFT' }),
    ]);

    renderWithProviders(<InvoicesList />);
    expect(await screen.findByText('INV-A')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter by status'), 'DRAFT');

    expect(screen.queryByText('INV-A')).not.toBeInTheDocument();
    expect(screen.getByText('INV-B')).toBeInTheDocument();
  });

  it('explains the empty state rather than showing a bare table', async () => {
    vi.mocked(listInvoices).mockResolvedValue([]);

    renderWithProviders(<InvoicesList />);

    expect(await screen.findByText('No client invoices yet')).toBeInTheDocument();
    expect(screen.getByText(/raised from an effective payment certificate/i)).toBeInTheDocument();
  });

});

describe('PostInvoiceDialog', () => {
  const noop = () => {};

  it('shows the exact three lines the server will write', () => {
    renderWithProviders(
      <PostInvoiceDialog
        invoice={invoice({ postingStatus: 'NOT_POSTED' })}
        accounts={chart()}
        isPending={false}
        onConfirm={noop}
        onDismiss={noop}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('11000')).toBeInTheDocument();
    expect(within(dialog).getByText('Accounts Receivable')).toBeInTheDocument();
    expect(within(dialog).getByText('42600')).toBeInTheDocument();
    expect(within(dialog).getByText('20200')).toBeInTheDocument();
  });

  it('drops the VAT line for a zero-VAT invoice', () => {
    renderWithProviders(
      <PostInvoiceDialog
        invoice={invoice({ subtotal: '6498.00', vatAmount: '0.00', totalAmount: '6498.00' })}
        accounts={chart()}
        isPending={false}
        onConfirm={noop}
        onDismiss={noop}
      />,
    );

    expect(screen.queryByText('20200')).not.toBeInTheDocument();
  });

  it('sends exactly the codes it displayed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    renderWithProviders(
      <PostInvoiceDialog
        invoice={invoice()}
        accounts={chart()}
        isPending={false}
        onConfirm={onConfirm}
        onDismiss={noop}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Post to GL' }));

    expect(onConfirm).toHaveBeenCalledWith({
      arAccountCode: '11000',
      revenueAccountCode: '42600',
      vatAccountCode: '20200',
    });
  });

  it('blocks posting and names the missing role when the chart is incomplete', () => {
    renderWithProviders(
      <PostInvoiceDialog
        invoice={invoice()}
        accounts={chart().filter((a) => a.code !== '42600')}
        isPending={false}
        onConfirm={noop}
        onDismiss={noop}
      />,
    );

    expect(screen.getByText(/no account is configured as Revenue/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post to GL' })).toBeDisabled();
  });

  it('blocks posting and names both codes when two accounts claim one role', () => {
    const conflicted = [...chart(), account('11010', { name: 'AR — Retentions' })];

    renderWithProviders(
      <PostInvoiceDialog
        invoice={invoice()}
        accounts={conflicted}
        isPending={false}
        onConfirm={noop}
        onDismiss={noop}
      />,
    );

    expect(screen.getByText(/11000, 11010 are both configured/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post to GL' })).toBeDisabled();
  });

});

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientStatus } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import { chooseOption } from '@/test/choose-option';
import { listClients } from '@/features/clients/api/clients-api';
import { cancelInvoice, listInvoices } from '@/features/accounting/api/invoices-api';
import type { Account, AccountVersion, ClientInvoice } from '@/features/accounting/types';

import { invoiceMatchesFilters, InvoicesList } from './invoices-list';
import { PostInvoiceDialog } from './post-invoice-dialog';

vi.mock('@/features/accounting/api/invoices-api', () => ({
  listInvoices: vi.fn(),
  getInvoice: vi.fn(),
  generateInvoiceFromIpc: vi.fn(),
  approveInvoice: vi.fn(),
  postInvoice: vi.fn(),
  reverseInvoice: vi.fn(),
  cancelInvoice: vi.fn(),
  listIncomeAccounts: vi.fn().mockResolvedValue([]),
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
    source: { kind: 'IPC', label: null, id: 'ipc-1' },
    projectId: 'proj-1',
    contractId: 'con-1',
    currencyCode: 'SOS',
    subtotal: '6498.00',
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
  it('flags an overdue invoice under its due date', async () => {
    vi.mocked(listInvoices).mockResolvedValue([
      invoice({ documentStatus: 'APPROVED', postingStatus: 'POSTED', dueDate: '2020-01-31', outstandingAmount: '100.00' }),
    ]);
    renderWithProviders(<InvoicesList />, { withToast: true });
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Overdue')).toBeInTheDocument();
  });

  it('offers Open, Open PDF and Copy link in the row menu — and no create action without manage:receivable', async () => {
    const user = userEvent.setup();
    vi.mocked(listInvoices).mockResolvedValue([invoice()]);
    renderWithProviders(<InvoicesList />, { withToast: true });
    const table = await screen.findByRole('table');
    await user.click(within(table).getByRole('button', { name: /Actions for INV-2026-031/ }));
    expect(await screen.findByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open PDF' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /New invoice/ })).toBeNull();
    // A posted invoice is reversed, never cancelled.
    expect(screen.queryByRole('menuitem', { name: 'Cancel draft' })).toBeNull();
  });

  it('renders an invoice with its client name joined from GET /clients', async () => {
    vi.mocked(listInvoices).mockResolvedValue([invoice()]);

    renderWithProviders(<InvoicesList />, { withToast: true });

    // Scoped to the table: below 640px the same row also renders as a phone card.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('INV-2026-031')).toBeInTheDocument();
    expect(await within(table).findByText('Al-Noor Development')).toBeInTheDocument();
  });

  it('still renders a row that arrives without its source (an older API) instead of crashing', async () => {
    const legacy = invoice();
    delete (legacy as Partial<ClientInvoice>).source;
    vi.mocked(listInvoices).mockResolvedValue([legacy]);

    renderWithProviders(<InvoicesList />, { withToast: true });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('INV-2026-031')).toBeInTheDocument();
  });

  it('labels a draft as unnumbered rather than showing an empty cell', async () => {
    vi.mocked(listInvoices).mockResolvedValue([
      invoice({ invoiceNumber: null, documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' }),
    ]);

    renderWithProviders(<InvoicesList />, { withToast: true });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Not yet numbered')).toBeInTheDocument();
  });

  it('shows the one state a reader acts on, derived from both axes and the balance (ADR-047)', async () => {
    vi.mocked(listInvoices).mockResolvedValue([
      invoice({ id: 'a', documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED' }),
      invoice({ id: 'b', documentStatus: 'APPROVED', postingStatus: 'POSTED', totalAmount: '100.00', outstandingAmount: '40.00', dueDate: '2999-01-01' }),
    ]);

    renderWithProviders(<InvoicesList />, { withToast: true });

    // Scoped to the table: the filters render their own option labels.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('To post')).toBeInTheDocument();
    expect(within(table).getByText('Part paid')).toBeInTheDocument();
  });

  it('filters by document status in the browser', async () => {
    const user = userEvent.setup();
    vi.mocked(listInvoices).mockResolvedValue([
      invoice({ id: 'a', invoiceNumber: 'INV-A', documentStatus: 'APPROVED' }),
      invoice({ id: 'b', invoiceNumber: 'INV-B', documentStatus: 'DRAFT' }),
    ]);

    renderWithProviders(<InvoicesList />, { withToast: true });
    const table = await screen.findByRole('table');
    expect(within(table).getByText('INV-A')).toBeInTheDocument();

    // The Filter panel edits a draft; nothing changes until Apply (ADR-035).
    await user.click(screen.getByRole('button', { name: /^Filter/ }));
    await chooseOption(user, await screen.findByLabelText('Approval status'), 'DRAFT');
    expect(within(table).getByText('INV-A')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(within(screen.getByRole('table')).queryByText('INV-A')).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('INV-B')).toBeInTheDocument();
  });

  it('explains the empty state rather than showing a bare table', async () => {
    vi.mocked(listInvoices).mockResolvedValue([]);

    renderWithProviders(<InvoicesList />, { withToast: true });

    expect(await screen.findByText('No client invoices yet')).toBeInTheDocument();
    expect(screen.getByText(/a sale, a payment certificate, a milestone or a separate charge/i)).toBeInTheDocument();
  });

});

describe('PostInvoiceDialog', () => {
  const noop = () => {};

  it('shows the exact lines the server will write', () => {
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

describe('InvoicesList — cancel a draft with undo (Step 2g)', () => {
  const draft = () =>
    invoice({ id: 'd1', invoiceNumber: null, documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED', source: { kind: 'MANUAL', label: null, id: null } });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(cancelInvoice).mockReset().mockResolvedValue(draft());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function cancelFromMenu() {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(listInvoices).mockResolvedValue([draft()]);
    renderWithProviders(<InvoicesList />, { withToast: true, permissions: ['manage:receivable'] });
    const table = await screen.findByRole('table');
    await user.click(within(table).getByRole('button', { name: /Actions for Not yet numbered/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel draft' }));
    return user;
  }

  it('hides the row at once and sends the cancel only when the undo window closes', async () => {
    await cancelFromMenu();
    expect(await screen.findByText('Draft invoice cancelled')).toBeInTheDocument();
    expect(screen.queryByText('Not yet numbered')).toBeNull();
    expect(cancelInvoice).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    expect(cancelInvoice).toHaveBeenCalledWith('d1', undefined);
  });

  it('brings the row back and sends nothing when Undo is pressed', async () => {
    const user = await cancelFromMenu();
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Draft restored')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Not yet numbered')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(cancelInvoice).not.toHaveBeenCalled();
  });

  it('undoes the latest pending cancel with Z', async () => {
    const user = await cancelFromMenu();
    await screen.findByText('Draft invoice cancelled');
    await user.keyboard('z');
    expect(await screen.findByText('Draft restored')).toBeInTheDocument();
    expect(cancelInvoice).not.toHaveBeenCalled();
  });

  it('puts the row back and says so when the server refuses the cancel', async () => {
    vi.mocked(cancelInvoice).mockRejectedValue(new Error('boom'));
    await cancelFromMenu();
    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    expect(await screen.findByText('Could not cancel the draft')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Not yet numbered')).toBeInTheDocument();
  });
});

describe('invoiceMatchesFilters — the Status filter', () => {
  const today = '2026-10-30';
  const rows = {
    draft: invoice({ id: 'd', documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' }),
    open: invoice({ id: 'o', documentStatus: 'APPROVED', postingStatus: 'POSTED', dueDate: '2026-11-30', outstandingAmount: '10.00' }),
    late: invoice({ id: 'l', documentStatus: 'APPROVED', postingStatus: 'POSTED', dueDate: '2026-10-01', outstandingAmount: '10.00' }),
    paid: invoice({ id: 'p', documentStatus: 'APPROVED', postingStatus: 'POSTED', outstandingAmount: '0.00' }),
    void: invoice({ id: 'v', documentStatus: 'CANCELLED', postingStatus: 'NOT_POSTED' }),
  };
  const kept = (state: string) =>
    Object.entries(rows)
      .filter(([, inv]) => invoiceMatchesFilters(inv, { state }, today))
      .map(([key]) => key);

  it('reads what the reader acts on, not the two status axes', () => {
    expect(kept('DRAFT')).toEqual(['draft']);
    // Awaiting payment includes the overdue ones: both are owed.
    expect(kept('UNPAID')).toEqual(['open', 'late']);
    expect(kept('OVERDUE')).toEqual(['late']);
    expect(kept('PAID')).toEqual(['paid']);
    expect(kept('VOID')).toEqual(['void']);
  });
});

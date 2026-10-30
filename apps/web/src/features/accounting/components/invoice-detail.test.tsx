import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { ClientInvoice } from '../types';

const mocks = vi.hoisted(() => ({
  useInvoice: vi.fn(),
  useInvoiceAction: vi.fn(),
  useInvoiceDocumentUrl: vi.fn(),
  useAccounts: vi.fn(),
  useApprovalSettings: vi.fn(() => ({ data: { invoiceApprovalAbove: null as string | null } })),
  useClients: vi.fn(),
  useInvoiceCreditNotes: vi.fn(() => ({ data: [] as unknown[] })),
  searchParams: new URLSearchParams(),
}));

vi.mock('../hooks/use-invoices', () => ({
  useInvoice: mocks.useInvoice,
  useInvoiceAction: mocks.useInvoiceAction,
  useInvoiceDocumentUrl: mocks.useInvoiceDocumentUrl,
  useInvoiceCreditNotes: mocks.useInvoiceCreditNotes,
  useIncomeAccounts: () => ({ data: [{ code: '42100', name: 'Equipment hire income' }] }),
  useOpenInvoiceDocument: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCancelInvoice: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null }),
  invoiceKeys: { all: ['accounting', 'invoices'] },
}));
vi.mock('@/features/write-offs/hooks', () => ({
  useWriteOffs: () => ({ data: [] }),
  useRequestWriteOff: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false }),
  useDecideWriteOff: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false }),
}));
vi.mock('@/features/communications/hooks', () => ({
  useCommunications: () => ({ isPending: false, isError: false, data: [] }),
  useCommunicationsFor: () => ({ isPending: false, isError: false, data: [] }),
  useResolveCommunication: () => ({ isPending: false, mutate: vi.fn() }),
  communicationKeys: { all: ['communications'], resource: () => ['communications'] },
}));
vi.mock('../hooks/use-accounting', () => ({ useAccounts: mocks.useAccounts, useApprovalSettings: mocks.useApprovalSettings }));
vi.mock('@/features/clients/hooks/use-clients', () => ({ useClients: mocks.useClients }));
vi.mock('@/features/projects/hooks/use-projects', () => ({ useProjects: () => ({ data: [] }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.searchParams }));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { InvoiceDetail } from './invoice-detail';

/** Opens the More menu, where every action but the one primary action lives. */
async function openMore() {
  await userEvent.setup().click(screen.getByRole('button', { name: 'More' }));
}

function invoice(overrides: Partial<ClientInvoice> = {}): ClientInvoice {
  return {
    id: 'inv-1',
    organizationId: 'org-1',
    invoiceNumber: null,
    invoiceDate: '2026-09-18',
    dueDate: '2026-10-18',
    clientId: 'client-1',
    sourceIpcId: null,
    source: { kind: 'SEPARATE_CHARGE', label: 'Temporary site power', id: 'node-9' },
    projectId: 'proj-1',
    contractId: 'con-1',
    currencyCode: 'USD',
    subtotal: '25000.00',
    vatAmount: '1250.00',
    totalAmount: '26250.00',
    outstandingAmount: '26250.00',
    paymentTerms: null,
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
    createdAt: '2026-09-18T09:00:00.000Z',
    createdBy: 'user-1',
    ...overrides,
  };
}

beforeEach(() => {
  mocks.searchParams = new URLSearchParams();
  mocks.useApprovalSettings.mockReturnValue({ data: { invoiceApprovalAbove: null } });
  mocks.useAccounts.mockReturnValue({ data: [], isPending: false, isError: false });
  mocks.useClients.mockReturnValue({ data: [], isPending: false, isError: false });
  mocks.useInvoiceAction.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    reset: vi.fn(),
  });
  mocks.useInvoiceDocumentUrl.mockReturnValue({ isPending: true, isError: false, data: undefined });
});

describe('InvoiceDetail — state-aware title and totals', () => {
  it('shows the draft title, the one Issue action (ADR-046 §2), and "Draft total" (never a collectible balance)', async () => {
    mocks.useInvoice.mockReturnValue({ data: invoice(), isPending: false, isError: false });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, {
      permissions: ['manage:receivable'],
    });

    expect(screen.getByRole('heading', { name: /Draft invoice/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issue invoice' })).toBeInTheDocument();
    // No separate Approve step any more, and no Post before issue.
    expect(screen.queryByRole('button', { name: 'Approve invoice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post & assign number' })).not.toBeInTheDocument();
    expect(screen.getByText('Draft total')).toBeInTheDocument();
    expect(screen.queryByText('Balance due')).not.toBeInTheDocument();
    // Step 2g — an unposted invoice can be cancelled from its page.
    await openMore();
    expect(screen.getByRole('menuitem', { name: 'Cancel draft' })).toBeInTheDocument();
  });

  it('shows "awaiting posting" for an approved, not-yet-posted invoice, with the Post action', () => {
    mocks.useInvoice.mockReturnValue({
      data: invoice({ documentStatus: 'APPROVED', approvedAt: '2026-09-19T10:00:00.000Z' }),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, {
      permissions: ['manage:receivable'],
    });

    expect(screen.getByText('To post')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post & assign number' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve invoice' })).not.toBeInTheDocument();
    // Still a draft total pre-posting, not a real collectible balance.
    expect(screen.getByText('Draft total')).toBeInTheDocument();
  });

  it('shows the invoice number and "Balance due" once posted', async () => {
    mocks.useInvoice.mockReturnValue({
      data: invoice({
        invoiceNumber: 'INV-2026-0042',
        documentStatus: 'APPROVED',
        postingStatus: 'POSTED',
        approvedAt: '2026-09-19T10:00:00.000Z',
        postedAt: '2026-09-19T11:00:00.000Z',
        outstandingAmount: '10000.00',
      }),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, {
      permissions: ['manage:receivable'],
    });

    expect(screen.getByRole('heading', { name: /INV-2026-0042/ })).toBeInTheDocument();
    expect(screen.getAllByText('Balance due').length).toBeGreaterThan(0);
    expect(screen.queryByText('Draft total')).not.toBeInTheDocument();
    // CI-5 — an open invoice's one primary action is Record payment, for this invoice's balance.
    expect(screen.getByRole('link', { name: 'Record payment' })).toHaveAttribute(
      'href',
      '/receipts/new?clientId=client-1&invoiceId=inv-1&amount=10000.00',
    );
    await openMore();
    // A posted invoice is reversed, never cancelled.
    expect(screen.queryByRole('menuitem', { name: 'Cancel draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Reverse' })).toBeInTheDocument();
    // AR-1 — a posted invoice with a balance can be credited from Finance, project or not.
    expect(screen.getByRole('menuitem', { name: 'Issue credit note' })).toBeInTheDocument();
    // AR-4 — and written off.
    expect(screen.getByRole('menuitem', { name: 'Write off' })).toBeInTheDocument();
    // ADR-042 step 4 — something is still owed, so a WhatsApp reminder is offered.
    expect(screen.getByRole('menuitem', { name: 'Send reminder' })).toBeInTheDocument();
  });

  it('CI-3: breaks the balance down by kind and lists the payments applied', () => {
    mocks.useInvoice.mockReturnValue({
      data: invoice({
        invoiceNumber: 'INV-000006',
        documentStatus: 'APPROVED',
        postingStatus: 'POSTED',
        totalAmount: '580.00',
        outstandingAmount: '320.00',
        amountPaid: '200.00',
        amountCredited: '50.00',
        amountWrittenOff: '10.00',
        payments: [
          {
            allocationId: 'a1',
            receiptId: 'r1',
            receiptNumber: 'RCP-000003',
            receiptDate: '2026-10-30',
            appliedOn: '2026-10-30',
            paymentMethod: 'Bank transfer',
            reference: null,
            amount: '200.00',
          },
        ],
      }),
      isPending: false,
      isError: false,
    });
    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: ['manage:receivable'] });

    expect(screen.getByRole('link', { name: 'RCP-000003' })).toHaveAttribute('href', '/receipts/r1');
    expect(screen.getAllByText('−$200.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('−$50.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('−$10.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$320.00').length).toBeGreaterThan(0);
  });

  it('lists the credit notes raised against the invoice, with Reverse on a posted one (AR-1)', async () => {
    mocks.useInvoiceCreditNotes.mockReturnValue({
      data: [
        {
          id: 'cn1',
          creditNoteNumber: 'CN-000003',
          reason: 'PRICE_ERROR',
          netAmount: '100.00',
          vatAmount: '0.00',
          totalAmount: '100.00',
          accountingDate: '2026-10-20',
          postingStatus: 'POSTED',
          note: null,
          reversedAt: null,
          reversalReason: null,
        },
      ],
    });
    mocks.useInvoice.mockReturnValue({
      data: invoice({
        invoiceNumber: 'INV-2026-0042',
        documentStatus: 'APPROVED',
        postingStatus: 'POSTED',
        outstandingAmount: '0.00',
      }),
      isPending: false,
      isError: false,
    });
    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: ['manage:receivable'] });

    expect(screen.getByText('CN-000003')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Reverse' }).length).toBeGreaterThan(0);
    // Nothing left to credit: no new credit note.
    await openMore();
    expect(screen.queryByRole('menuitem', { name: 'Issue credit note' })).not.toBeInTheDocument();
  });

  it('offers a reminder on an opening-balance invoice (no Rukna number)', async () => {
    mocks.useInvoice.mockReturnValue({
      data: invoice({
        invoiceNumber: null,
        documentStatus: 'APPROVED',
        postingStatus: 'OPENING_BALANCE',
        outstandingAmount: '800.00',
      }),
      isPending: false,
      isError: false,
    });
    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, {
      permissions: ['manage:receivable'],
    });
    await openMore();
    expect(screen.getByRole('menuitem', { name: 'Send reminder' })).toBeInTheDocument();
  });

  it('offers no reminder once the invoice is fully paid', async () => {
    mocks.useInvoice.mockReturnValue({
      data: invoice({
        invoiceNumber: 'INV-2026-0042',
        documentStatus: 'APPROVED',
        postingStatus: 'POSTED',
        outstandingAmount: '0.00',
      }),
      isPending: false,
      isError: false,
    });
    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, {
      permissions: ['manage:receivable'],
    });
    await openMore();
    expect(screen.queryByRole('menuitem', { name: 'Send reminder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Record payment' })).not.toBeInTheDocument();
  });
});

describe('InvoiceDetail — approval above an amount (ADR-046 §8)', () => {
  it('offers Approve, not Issue, to someone other than the preparer', () => {
    mocks.useApprovalSettings.mockReturnValue({ data: { invoiceApprovalAbove: '10000.00' } });
    mocks.useInvoice.mockReturnValue({ data: invoice({ createdBy: 'user-1' }), isPending: false, isError: false });
    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: ['manage:receivable'] });
    expect(screen.getByRole('button', { name: 'Approve invoice' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Issue invoice' })).not.toBeInTheDocument();
  });

  it('tells the preparer someone else must approve it', () => {
    mocks.useApprovalSettings.mockReturnValue({ data: { invoiceApprovalAbove: '10000.00' } });
    mocks.useInvoice.mockReturnValue({ data: invoice({ createdBy: 'test-user' }), isPending: false, isError: false });
    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: ['manage:receivable'] });
    expect(screen.getByText(/need another person’s approval before they are issued/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve invoice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Issue invoice' })).not.toBeInTheDocument();
  });

  it('issues directly below the amount', () => {
    mocks.useApprovalSettings.mockReturnValue({ data: { invoiceApprovalAbove: '50000.00' } });
    mocks.useInvoice.mockReturnValue({ data: invoice({ createdBy: 'test-user' }), isPending: false, isError: false });
    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: ['manage:receivable'] });
    expect(screen.getByRole('button', { name: 'Issue invoice' })).toBeInTheDocument();
  });
});

describe('InvoiceDetail — permission gating', () => {
  it('hides every lifecycle action for a caller without manage:receivable, on any state', () => {
    mocks.useInvoice.mockReturnValue({
      data: invoice({ documentStatus: 'APPROVED' }),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: [] });

    expect(screen.queryByRole('button', { name: 'Issue invoice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post & assign number' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });
});

describe('InvoiceDetail — readable source', () => {
  it('reads a separate charge as "Separate charge · {description}", not a bare code', () => {
    mocks.useInvoice.mockReturnValue({
      data: invoice({
        source: { kind: 'SEPARATE_CHARGE', label: 'Temporary site power', id: 'node-9' },
      }),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: [] });

    expect(screen.getByText('Separate charge · Temporary site power')).toBeInTheDocument();
  });

  it('falls back to the bare kind for a migration-loaded invoice with no source reference', () => {
    mocks.useInvoice.mockReturnValue({
      data: invoice({ source: { kind: 'NONE', label: null, id: null } }),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: [] });

    expect(screen.getByText('Source').nextElementSibling).toHaveTextContent(/^Invoice$/);
  });
});

describe('InvoiceDetail — breadcrumb back-link', () => {
  it("renders the calling page's label and link when ?from=/?fromLabel= are present", () => {
    mocks.searchParams = new URLSearchParams({
      from: '/projects/p-1/commercial/billing?filter=needsAction',
      fromLabel: 'Billing & Collection',
    });
    mocks.useInvoice.mockReturnValue({ data: invoice(), isPending: false, isError: false });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: [] });

    const back = screen.getByRole('link', { name: /Billing & Collection/ });
    expect(back).toHaveAttribute('href', '/projects/p-1/commercial/billing?filter=needsAction');
  });

  it('renders no breadcrumb when the caller passes no ?from=', () => {
    mocks.useInvoice.mockReturnValue({ data: invoice(), isPending: false, isError: false });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: [] });

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('InvoiceDetail — embedded document preview', () => {
  it('shows a loading state while the signed URL is in flight', async () => {
    mocks.useInvoice.mockReturnValue({ data: invoice(), isPending: false, isError: false });
    mocks.useInvoiceDocumentUrl.mockReturnValue({
      isPending: true,
      isError: false,
      data: undefined,
    });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: [] });
    await userEvent.setup().click(screen.getByRole('tab', { name: 'PDF' }));

    expect(screen.queryByTitle(/invoice/i)).not.toBeInTheDocument();
  });

  it('offers a retry when the signed URL fails or has expired', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    mocks.useInvoice.mockReturnValue({ data: invoice(), isPending: false, isError: false });
    mocks.useInvoiceDocumentUrl.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
      refetch,
    });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: [] });
    await user.click(screen.getByRole('tab', { name: 'PDF' }));

    await user.click(screen.getByRole('button', { name: 'Reload preview' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('embeds the signed URL and offers download / open-in-new-tab as secondary actions', async () => {
    mocks.useInvoice.mockReturnValue({ data: invoice(), isPending: false, isError: false });
    mocks.useInvoiceDocumentUrl.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        url: 'https://storage.rukna.site/signed-abc',
        originalName: 'invoice.pdf',
        mimeType: 'application/pdf',
      },
      refetch: vi.fn(),
    });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: [] });
    await userEvent.setup().click(screen.getByRole('tab', { name: 'PDF' }));

    const frame = screen.getByTitle('invoice.pdf');
    expect(frame).toHaveAttribute('src', 'https://storage.rukna.site/signed-abc');
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute(
      'href',
      'https://storage.rukna.site/signed-abc',
    );
    expect(screen.getByRole('link', { name: 'Open in new tab' })).toHaveAttribute(
      'href',
      'https://storage.rukna.site/signed-abc',
    );
  });
});

describe('InvoiceDetail — project-scoped route and safe back-link (flow plan PR 4 review)', () => {
  it('shows another project’s invoice as not found under this project', () => {
    mocks.useInvoice.mockReturnValue({ data: invoice(), isPending: false, isError: false });
    renderWithProviders(<InvoiceDetail invoiceId="inv-1" projectId="other-project" />, {
      permissions: [],
    });
    expect(screen.getByText('This invoice does not belong to this project.')).toBeInTheDocument();
  });

  it('never follows a `from` that leaves the site', () => {
    mocks.searchParams = new URLSearchParams({ from: '//evil.example/phish', fromLabel: 'Back' });
    mocks.useInvoice.mockReturnValue({ data: invoice(), isPending: false, isError: false });
    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: [] });
    expect(screen.queryByRole('link', { name: /Back/ })).not.toBeInTheDocument();
  });
});

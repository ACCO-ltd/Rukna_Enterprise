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
  useClients: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('../hooks/use-invoices', () => ({
  useInvoice: mocks.useInvoice,
  useInvoiceAction: mocks.useInvoiceAction,
  useInvoiceDocumentUrl: mocks.useInvoiceDocumentUrl,
}));
vi.mock('../hooks/use-accounting', () => ({ useAccounts: mocks.useAccounts }));
vi.mock('@/features/clients/hooks/use-clients', () => ({ useClients: mocks.useClients }));
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

function invoice(overrides: Partial<ClientInvoice> = {}): ClientInvoice {
  return {
    id: 'inv-1',
    organizationId: 'org-1',
    invoiceNumber: null,
    invoiceDate: '2026-09-18',
    dueDate: '2026-10-18',
    clientId: 'client-1',
    sourceIpcId: null,
    source: { kind: 'SEPARATE_CHARGE', label: 'shamiito', id: 'node-9' },
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
  it('shows the draft title, Approve action, and "Draft total" (never a collectible balance)', () => {
    mocks.useInvoice.mockReturnValue({ data: invoice(), isPending: false, isError: false });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, {
      permissions: ['manage:receivable'],
    });

    expect(screen.getByText('Review draft invoice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve invoice' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post & assign number' })).not.toBeInTheDocument();
    expect(screen.getByText('Draft total')).toBeInTheDocument();
    expect(screen.queryByText('Balance due')).not.toBeInTheDocument();
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

    expect(screen.getByText('Approved invoice · awaiting posting')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post & assign number' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve invoice' })).not.toBeInTheDocument();
    // Still a draft total pre-posting, not a real collectible balance.
    expect(screen.getByText('Draft total')).toBeInTheDocument();
  });

  it('shows the invoice number and "Balance due" once posted', () => {
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

    expect(screen.getByText('Invoice INV-2026-0042')).toBeInTheDocument();
    expect(screen.getByText('Balance due')).toBeInTheDocument();
    expect(screen.queryByText('Draft total')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reverse' })).toBeInTheDocument();
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

    expect(screen.queryByRole('button', { name: 'Approve invoice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post & assign number' })).not.toBeInTheDocument();
  });
});

describe('InvoiceDetail — readable source', () => {
  it('reads a separate charge as "Separate charge · {description}", not a bare code', () => {
    mocks.useInvoice.mockReturnValue({
      data: invoice({ source: { kind: 'SEPARATE_CHARGE', label: 'shamiito', id: 'node-9' } }),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: [] });

    expect(screen.getByText('Separate charge · shamiito')).toBeInTheDocument();
  });

  it('falls back to the bare kind for a migration-loaded invoice with no source reference', () => {
    mocks.useInvoice.mockReturnValue({
      data: invoice({ source: { kind: 'NONE', label: null, id: null } }),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: [] });

    expect(screen.getByText('Invoice')).toBeInTheDocument();
  });
});

describe('InvoiceDetail — breadcrumb back-link', () => {
  it('renders the calling page\'s label and link when ?from=/?fromLabel= are present', () => {
    mocks.searchParams = new URLSearchParams({
      from: '/projects/p-1/commercial/billing-collection?filter=needsAction',
      fromLabel: 'Billing & Collection',
    });
    mocks.useInvoice.mockReturnValue({ data: invoice(), isPending: false, isError: false });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: [] });

    const back = screen.getByRole('link', { name: /Billing & Collection/ });
    expect(back).toHaveAttribute('href', '/projects/p-1/commercial/billing-collection?filter=needsAction');
  });

  it('renders no breadcrumb when the caller passes no ?from=', () => {
    mocks.useInvoice.mockReturnValue({ data: invoice(), isPending: false, isError: false });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: [] });

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('InvoiceDetail — embedded document preview', () => {
  it('shows a loading state while the signed URL is in flight', () => {
    mocks.useInvoice.mockReturnValue({ data: invoice(), isPending: false, isError: false });
    mocks.useInvoiceDocumentUrl.mockReturnValue({ isPending: true, isError: false, data: undefined });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: [] });

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

    await user.click(screen.getByRole('button', { name: 'Reload preview' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('embeds the signed URL and offers download / open-in-new-tab as secondary actions', () => {
    mocks.useInvoice.mockReturnValue({ data: invoice(), isPending: false, isError: false });
    mocks.useInvoiceDocumentUrl.mockReturnValue({
      isPending: false,
      isError: false,
      data: { url: 'https://storage.rukna.site/signed-abc', originalName: 'invoice.pdf', mimeType: 'application/pdf' },
      refetch: vi.fn(),
    });

    renderWithProviders(<InvoiceDetail invoiceId="inv-1" />, { permissions: [] });

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

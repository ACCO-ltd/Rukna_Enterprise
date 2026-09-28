import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

import * as invoiceApi from '../api/commercial-invoice-api';
import { makeInvoiceDocument } from './invoice-document.fixture';
import { ProjectInvoicePage } from './project-invoice-page';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

vi.mock('../api/commercial-invoice-api', () => ({
  getInvoiceDocument: vi.fn(),
  issueInvoice: vi.fn(),
  deleteDraftInvoice: vi.fn(),
  getPreparePreview: vi.fn(),
  preparePackage: vi.fn(),
  createInvoiceCreditNote: vi.fn(),
  postInvoiceCreditNote: vi.fn(),
}));

vi.mock('../api/commercial-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/commercial-api')>()),
  getIssuedInvoiceDocument: vi.fn(),
  recordPackageDelivery: vi.fn(),
  getCommercialBilling: vi.fn(() => new Promise(() => {})),
  getProjectDepositAccounts: vi.fn(async () => []),
}));

let ledgerBlocked = false;
vi.mock('@/features/finance/hooks/use-accounting-readiness', () => ({
  useLedgerBlocked: () => ledgerBlocked,
  useAccountingReadiness: () => ({
    data: ledgerBlocked ? { ready: false, blockers: [{ code: 'NO_OPEN_PERIOD', label: 'Open period' }] } : undefined,
  }),
}));

const getDocument = vi.mocked(invoiceApi.getInvoiceDocument);

function renderPage() {
  return renderWithProviders(<ProjectInvoicePage projectId="p1" invoiceId="inv-1" />);
}

const ISSUED = {
  lifecycle: 'ISSUED' as const,
  documentStatus: 'APPROVED' as const,
  postingStatus: 'POSTED' as const,
  settlementStatus: 'UNPAID' as const,
  invoiceNumber: 'INV-0042',
  invoiceDate: '2026-09-21',
  dueDate: '2026-10-21',
  journalEntryId: 'je-9',
};

const ISSUED_CAPS = {
  canIssue: false,
  canSend: true,
  canRecordPayment: true,
  canEditDraft: false,
  canDeleteDraft: false,
  canIssueCreditNote: true,
  canDownloadPdf: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  ledgerBlocked = false;
});

describe('ProjectInvoicePage — the invoice as a document inside the project', () => {
  it('goes back to Billing', async () => {
    getDocument.mockResolvedValue(makeInvoiceDocument());
    renderPage();
    const back = await screen.findByRole('link', { name: 'Billing' });
    expect(back).toHaveAttribute('href', '/projects/p1/commercial/billing');
  });

  it('draft: the primary is Issue invoice, with the draft title, pills and who created it', async () => {
    getDocument.mockResolvedValue(makeInvoiceDocument());
    renderPage();
    expect(await screen.findByRole('button', { name: 'Issue invoice' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Draft invoice' })).toBeInTheDocument();
    expect(screen.getByText(/Created Sep 20, 2026 by Amina Yusuf/)).toBeInTheDocument();
    expect(screen.getByText('Not posted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to client' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });

  it('issue: confirms in one sentence, calls the API, and refetches the document', async () => {
    const user = userEvent.setup();
    getDocument
      .mockResolvedValueOnce(makeInvoiceDocument())
      .mockResolvedValue(makeInvoiceDocument({ ...ISSUED, capabilities: ISSUED_CAPS }));
    vi.mocked(invoiceApi.issueInvoice).mockResolvedValue({
      invoiceIds: ['inv-1'],
      invoiceNumbers: ['INV-0042'],
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Issue invoice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Issue invoice?' });
    expect(
      within(dialog).getByText(/approves, numbers and posts the invoice in one step/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));

    expect(invoiceApi.issueInvoice).toHaveBeenCalledWith('p1', 'inv-1');
    expect(await screen.findByRole('heading', { name: 'INV-0042' })).toBeInTheDocument();
    expect(getDocument).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Send to client' })).toBeInTheDocument();
  });

  it('issued stage invoice: the primary is Send to client, and the journal and source are linked', async () => {
    getDocument.mockResolvedValue(makeInvoiceDocument({ ...ISSUED, capabilities: ISSUED_CAPS }));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Send to client' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Issue invoice' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View journal' })).toHaveAttribute(
      'href',
      '/finance/accounting/journals/je-9',
    );
    expect(screen.getByRole('link', { name: 'Structure complete' })).toHaveAttribute(
      'href',
      '/projects/p1/commercial/contract',
    );
  });

  it('send: records the delivery against the stage package', async () => {
    const user = userEvent.setup();
    const commercialApi = await import('../api/commercial-api');
    const record = vi.mocked(commercialApi.recordPackageDelivery).mockResolvedValue({ deliveries: [] });
    getDocument.mockResolvedValue(makeInvoiceDocument({ ...ISSUED, capabilities: ISSUED_CAPS }));
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Send to client' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send to client' });
    expect(within(dialog).queryByRole('button', { name: 'Mark as sent' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: /Hand delivered/ }));
    await user.type(within(dialog).getByLabelText('Received by'), 'Site office');
    await user.click(within(dialog).getByRole('button', { name: 'Mark as sent' }));

    await waitFor(() =>
      expect(record).toHaveBeenCalledWith(
        'p1',
        'inst-2',
        expect.objectContaining({ method: 'PHYSICAL', recipient: 'Site office' }),
      ),
    );
  });

  it('a separate-charge invoice has no delivery route, so Send is never offered', async () => {
    getDocument.mockResolvedValue(
      makeInvoiceDocument({
        ...ISSUED,
        source: { kind: 'SEPARATE_CHARGE', label: 'SC-01 Site mobilisation', id: 'sc-1' },
        capabilities: ISSUED_CAPS,
      }),
    );
    renderPage();
    expect(await screen.findByRole('button', { name: 'Record payment' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to client' })).not.toBeInTheDocument();
  });

  it('sent: the primary is Record payment', async () => {
    getDocument.mockResolvedValue(
      makeInvoiceDocument({ ...ISSUED, lifecycle: 'SENT', capabilities: ISSUED_CAPS }),
    );
    renderPage();
    expect(await screen.findByRole('button', { name: 'Record payment' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to client' })).not.toBeInTheDocument();
  });

  it('sent, ledger blocked: Record payment is hidden and the reason is said', async () => {
    ledgerBlocked = true;
    getDocument.mockResolvedValue(
      makeInvoiceDocument({ ...ISSUED, lifecycle: 'SENT', capabilities: ISSUED_CAPS }),
    );
    renderPage();
    expect(
      await screen.findByText("Payments can't be recorded until accounting setup is finished."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });

  it('paid: no primary command at all', async () => {
    getDocument.mockResolvedValue(
      makeInvoiceDocument({
        ...ISSUED,
        lifecycle: 'PAID',
        capabilities: { ...ISSUED_CAPS, canSend: false, canRecordPayment: false },
      }),
    );
    renderPage();
    await screen.findByRole('heading', { name: 'INV-0042' });
    for (const name of ['Issue invoice', 'Send to client', 'Record payment']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('delete draft: confirm, call the API, go back to Billing', async () => {
    const user = userEvent.setup();
    getDocument.mockResolvedValue(makeInvoiceDocument());
    vi.mocked(invoiceApi.deleteDraftInvoice).mockResolvedValue(undefined);
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete draft…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete draft invoice?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete draft' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/p1/commercial/billing'));
    expect(invoiceApi.deleteDraftInvoice).toHaveBeenCalledWith('p1', 'inv-1');
  });

  it('ledger blocked: Issue is hidden and the reason is said in words, with the way to fix it', async () => {
    ledgerBlocked = true;
    getDocument.mockResolvedValue(makeInvoiceDocument());
    renderPage();
    expect(
      await screen.findByText("Invoices can't be issued until accounting setup is finished."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Issue invoice' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Finish accounting setup' })).toHaveAttribute(
      'href',
      '/finance/accounting/periods',
    );
  });

  it('money-blind: amounts show the hidden state, never $0', async () => {
    getDocument.mockResolvedValue(
      makeInvoiceDocument({
        financialsVisible: false,
        lines: [{ description: 'Stage 2', detail: null, amount: null }],
        subtotal: null,
        taxAmount: null,
        total: null,
        balanceDue: null,
      }),
    );
    renderPage();
    const rail = await screen.findByRole('complementary', { name: 'Summary' });
    expect(within(rail).getAllByText('Hidden by permission')).toHaveLength(2);
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });

  it('collection tools sit in the kebab of an issued invoice with a balance, never on a draft', async () => {
    const user = userEvent.setup();
    getDocument.mockResolvedValue(makeInvoiceDocument({ ...ISSUED, capabilities: ISSUED_CAPS }));
    const { unmount } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    for (const name of ['Log follow-up…', 'Record promise to pay…', 'Open dispute…', 'History', 'Issue credit note…', 'Download PDF']) {
      expect(await screen.findByRole('menuitem', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('menuitem', { name: 'Delete draft…' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    unmount();

    getDocument.mockResolvedValue(makeInvoiceDocument());
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Edit draft' })).toBeInTheDocument();
    for (const name of ['Log follow-up…', 'Record promise to pay…', 'Open dispute…', 'History']) {
      expect(screen.queryByRole('menuitem', { name })).not.toBeInTheDocument();
    }
  });

  it('a missing invoice reads as not found', async () => {
    getDocument.mockRejectedValue(new ApiError(404, 'Not found'));
    renderPage();
    expect(await screen.findByText('Invoice not found')).toBeInTheDocument();
  });
});

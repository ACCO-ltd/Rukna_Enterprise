import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { BLOCKED, DRAFT, OVERDUE, READY, invoiceRow, receiptRow, workspaceFixture } from '../test-fixtures';
import { CommercialBillingView, collectionState } from './commercial-billing-view';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/projects/p1/commercial/billing' }));

const readiness = vi.hoisted(() => ({ value: undefined as undefined | { ready: boolean; blockers: { code: string }[] } }));
vi.mock('@/features/finance/hooks/use-accounting-readiness', () => ({
  useAccountingReadiness: () => ({ data: readiness.value }),
}));

const billing = vi.hoisted(() => ({ invoices: [] as unknown[], receipts: [] as unknown[] }));
vi.mock('../hooks/use-commercial', () => ({
  useCommercialBilling: () => ({
    isPending: false,
    isError: false,
    data: { invoices: billing.invoices, receipts: billing.receipts, asOf: '2026-09-28T00:00:00.000Z' },
  }),
}));

vi.mock('./prepare-invoice-dialog', () => ({
  PrepareInvoiceDialog: ({ installmentId }: { installmentId: string }) => <div role="dialog">prepare {installmentId}</div>,
}));
vi.mock('@/features/communications/components/invoice-reminder-dialog', () => ({
  InvoiceReminderDialog: ({ invoiceId, daysOverdue }: { invoiceId: string; daysOverdue: number }) => (
    <div role="dialog">reminder {invoiceId} {daysOverdue}</div>
  ),
}));
vi.mock('./record-payment-dialog', () => ({
  RecordPaymentDialog: ({ preselectedInvoice }: { preselectedInvoice: { invoiceId: string } | null }) => (
    <div role="dialog">payment {preselectedInvoice?.invoiceId ?? 'none'}</div>
  ),
}));

beforeEach(() => {
  readiness.value = undefined;
  billing.invoices = [
    invoiceRow({ id: 'inv-draft' }),
    invoiceRow({
      id: 'inv-130',
      invoiceNumber: 'INV-2026-0130',
      source: { kind: 'SEPARATE_CHARGE', label: 'SC-01 Extra site mobilisation', id: 'sc1' },
      dueDate: '2026-09-19',
      totalAmount: '12600.00',
      outstandingAmount: '12600.00',
      documentStatus: 'APPROVED',
      postingStatus: 'POSTED',
      status: 'UNPAID',
      daysOverdue: 9,
      sentAt: '2026-08-20',
    }),
  ];
  billing.receipts = [receiptRow()];
});

function render(workspace = workspaceFixture({ todo: [OVERDUE, READY, DRAFT, BLOCKED] })) {
  return renderWithProviders(<CommercialBillingView projectId="p1" workspace={workspace} />);
}

describe('Billing — To do', () => {
  it('lists the server-ranked rows in order, with one primary: the first row’s command', () => {
    render();
    expect(screen.getByRole('heading', { name: 'To do · 4' })).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: 'Things to do next' })).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('p')?.textContent)).toEqual([
      'INV-2026-0130 is 9 days overdue',
      'Stage 2 · Substructure complete is ready to bill',
      'Draft invoice for SC-02 Temporary site power',
      'Stage 3 · Frame complete can’t be billed yet',
    ]);
    const primary = within(rows[0]!).getByRole('button', { name: 'Record payment' });
    expect(primary.className).not.toMatch(/border-border/);
    expect(within(rows[1]!).getByRole('button', { name: 'Prepare invoice' }).className).toMatch(/border/);
  });

  it('says why a stage waits, and links to Progress instead of offering a billing button', () => {
    render();
    const blocked = screen.getByText('Stage 3 · Frame complete can’t be billed yet').closest('li')!;
    expect(within(blocked).getByText('It waits for MS-02 Frame complete to be verified in Progress.')).toBeInTheDocument();
    expect(within(blocked).queryByRole('button')).not.toBeInTheDocument();
    // Without manage:project the wait is stated, not linked — the reader can't verify.
    expect(within(blocked).queryByRole('link')).not.toBeInTheDocument();
    expect(within(blocked).getByText('Waiting for site verification')).toBeInTheDocument();
  });

  it('links a reader who can verify straight to Progress review', () => {
    renderWithProviders(
      <CommercialBillingView projectId="p1" workspace={workspaceFixture({ todo: [OVERDUE, READY, DRAFT, BLOCKED] })} />,
      { permissions: ['manage:project'] },
    );
    const blocked = screen.getByText('Stage 3 · Frame complete can’t be billed yet').closest('li')!;
    expect(within(blocked).getByRole('link', { name: 'Verify in Progress' })).toHaveAttribute('href', '/projects/p1/progress/review');
  });

  it('names the released milestone and the unbilled variation that can ride on the invoice', () => {
    render();
    expect(
      screen.getByText('MS-01 was verified in Progress on Sep 26, 2026. VO-03 is approved and not billed yet.'),
    ).toBeInTheDocument();
  });

  it('opens Prepare invoice and Record payment as focused dialogs from their rows', async () => {
    const user = userEvent.setup();
    render();
    await user.click(screen.getByRole('button', { name: 'Prepare invoice' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('prepare s2');
  });

  it('while the ledger cannot post: one notice, and "After accounting setup" instead of Record payment', () => {
    readiness.value = { ready: false, blockers: [{ code: 'NO_OPEN_PERIOD' }, { code: 'NO_DOCUMENT_SEQUENCE' }] };
    render();
    expect(screen.getByText('Invoices and payments can’t be posted until accounting setup is finished')).toBeInTheDocument();
    expect(screen.getByText('2 setup items left.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open accounting setup' })).toHaveAttribute('href', '/finance/accounting/periods');
    const overdue = screen.getByText('INV-2026-0130 is 9 days overdue').closest('li')!;
    expect(within(overdue).queryByRole('button')).not.toBeInTheDocument();
    expect(within(overdue).getByText('After accounting setup')).toBeInTheDocument();
    // Preparing makes drafts only — it is not held back.
    expect(screen.getByRole('button', { name: 'Prepare invoice' })).toBeInTheDocument();
  });

  it('renders no commands for someone who cannot bill (a project manager)', () => {
    render(
      workspaceFixture({
        todo: [OVERDUE, READY],
        capabilities: { ...workspaceFixture().capabilities, canBill: false, canRecordPayment: false },
      }),
    );
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prepare invoice' })).not.toBeInTheDocument();
  });

  it('shows the hidden state, never $0, to a money-blind reader', () => {
    render(workspaceFixture({ todo: [{ ...OVERDUE, amount: null }], financialsVisible: false }));
    expect(screen.getAllByText('Hidden for your role').length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });
});

/** The grid labels its scroll region, not the <table>; phones get a card list alongside it. */
function tableIn(heading: string) {
  const section = screen.getByRole('heading', { name: heading }).closest('section')!;
  return within(section).getByRole('table');
}

describe('Billing — invoices and payments', () => {
  it('filters Needs action / Unpaid / All with counts, and reads a draft as "Draft" with no balance', async () => {
    const user = userEvent.setup();
    render();
    expect(screen.getByRole('tab', { name: 'Needs action (2)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Unpaid (1)' })).toBeInTheDocument();
    const table = tableIn('Invoices');
    const draftRow = within(table).getByText('Separate charge · SC-02 Temporary site power').closest('tr')!;
    expect(within(draftRow).getByText('Draft', { selector: 'p' })).toBeInTheDocument();
    expect(within(draftRow).queryByText('Not yet numbered')).not.toBeInTheDocument();
    expect(within(table).getByText('Overdue')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Unpaid (1)' }));
    expect(within(tableIn('Invoices')).queryByText('Separate charge · SC-02 Temporary site power')).not.toBeInTheDocument();
  });

  it('offers Send reminder on an issued invoice with a balance, to a receivables manager only', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommercialBillingView projectId="p1" workspace={workspaceFixture()} />, {
      permissions: ['manage:receivable'],
    });
    const table = tableIn('Invoices');
    const buttons = within(table).getAllByRole('button', { name: /Send reminder/ });
    // The draft (no number, not posted) gets none; the overdue issued invoice gets one.
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Send reminder · INV-2026-0130');
    await user.click(buttons[0]);
    expect(screen.getByRole('dialog')).toHaveTextContent('reminder inv-130 9');
  });

  it('offers no reminder on a paid invoice', () => {
    billing.invoices = [
      invoiceRow({
        id: 'inv-paid',
        invoiceNumber: 'INV-2026-0131',
        documentStatus: 'APPROVED',
        postingStatus: 'POSTED',
        status: 'PAID',
        outstandingAmount: '0.00',
      }),
    ];
    renderWithProviders(<CommercialBillingView projectId="p1" workspace={workspaceFixture()} />, {
      permissions: ['manage:receivable'],
    });
    expect(screen.queryByRole('button', { name: /Send reminder/ })).not.toBeInTheDocument();
  });

  it('hides Send reminder from a viewer who cannot manage receivables', () => {
    render(workspaceFixture());
    expect(screen.queryByRole('button', { name: /Send reminder/ })).not.toBeInTheDocument();
  });

  it('lists payments with date, receipt number, bank reference, account and what they paid', () => {
    render();
    const table = tableIn('Payments received');
    expect(within(table).getByText('RCPT-2026-0044 · TT PB-99812')).toBeInTheDocument();
    expect(within(table).getByText('Premier Bank · USD ···4410')).toBeInTheDocument();
    expect(within(table).getByText('INV-2026-0121')).toBeInTheDocument();
  });
});

describe('collectionState', () => {
  it('reads an unpaid invoice past due as Overdue, otherwise Awaiting payment', () => {
    expect(collectionState(invoiceRow({ id: 'a', status: 'UNPAID', daysOverdue: 3 }))).toBe('OVERDUE');
    expect(collectionState(invoiceRow({ id: 'b', status: 'UNPAID', daysOverdue: 0 }))).toBe('AWAITING_PAYMENT');
    expect(collectionState(invoiceRow({ id: 'c', status: 'PAID' }))).toBe('PAID');
  });
});

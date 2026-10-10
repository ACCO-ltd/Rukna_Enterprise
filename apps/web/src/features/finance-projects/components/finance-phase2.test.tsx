import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PurchaseOrderBillPaymentsResponse, SupplierBillEligibility } from '@erp/types';

import { chooseOption } from '@/test/choose-option';
import { renderWithProviders } from '@/test/render';

/**
 * ADR-043 Phase 2 (web): the Payables / Payments tabs, the "Why can't I pay this?" panel, the
 * purchase-order bill-payments section and the project filter on the finance lists.
 */

const nav = vi.hoisted(() => ({ pathname: '/finance/projects/p1', search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const financeApi = vi.hoisted(() => ({ getFinancePortfolio: vi.fn(), getFinanceProject: vi.fn() }));
vi.mock('../api', () => financeApi);

const procApi = vi.hoisted(() => ({
  getSupplierBillEligibility: vi.fn(),
  getPurchaseOrderBillPayments: vi.fn(),
  listSupplierBills: vi.fn(),
  listSupplierPayments: vi.fn(),
  listSuppliers: vi.fn(),
}));
vi.mock('@/features/procurement/api/procurement-api', async (original) => ({
  ...(await original<object>()),
  ...procApi,
}));

const receiptsApi = vi.hoisted(() => ({ listReceipts: vi.fn() }));
vi.mock('@/features/receipts/api/receipts-api', async (original) => ({
  ...(await original<object>()),
  ...receiptsApi,
}));

const accountingApi = vi.hoisted(() => ({ listJournals: vi.fn() }));
vi.mock('@/features/accounting/api/accounting-api', async (original) => ({
  ...(await original<object>()),
  ...accountingApi,
}));

vi.mock('@/features/projects/hooks/use-project-filter', () => ({
  useProjectFilter: () => ({
    initialProjectId: undefined,
    options: [
      { value: 'p1', label: 'ACC-01 · Mogadishu clinic' },
      { value: 'p2', label: 'ACC-02 · School' },
    ],
  }),
}));
vi.mock('@/features/clients/hooks/use-clients', () => ({ useClients: () => ({ data: [] }) }));

import { BillEligibilityPanel } from '@/features/procurement/components/bill-eligibility-panel';
import { PoBillPaymentsSection } from '@/features/procurement/components/po-bill-payments';
import { SupplierBillsList } from '@/features/procurement/components/bill-screens';
import { ReceiptsList } from '@/features/receipts/components/receipts-list';
import { FinanceProjectPayments } from './finance-project-payments';
import { FinanceProjectPayables } from './finance-project-payables';
import { FinanceProjectWorkspace } from './finance-project-workspace';

const FINANCE = 'view:financial-position';

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = '/finance/projects/p1';
  nav.search = '';
  procApi.listSupplierBills.mockResolvedValue([]);
  procApi.listSupplierPayments.mockResolvedValue([]);
  procApi.listSuppliers.mockResolvedValue([]);
  receiptsApi.listReceipts.mockResolvedValue([]);
  accountingApi.listJournals.mockResolvedValue([]);
});

function eligibility(over: Partial<SupplierBillEligibility> = {}): SupplierBillEligibility {
  return {
    billId: 'b1',
    canPost: false,
    canPay: false,
    blockedReason: 'MATCH_EXCEPTION',
    outstandingAmount: '1200.00',
    paymentsInFlight: 0,
    signaturesRequired: 2,
    steps: [
      { key: 'SUBMITTED', status: 'DONE', owner: 'FINANCE', code: null, detail: null },
      { key: 'MATCHED', status: 'BLOCKED', owner: 'PROCUREMENT', code: 'MATCH_EXCEPTION', detail: 'Quantity over receipt' },
      { key: 'APPROVED', status: 'PENDING', owner: 'APPROVER', code: 'BILL_AWAITING_APPROVAL', detail: null },
      { key: 'PERIOD_OPEN', status: 'NOT_APPLICABLE', owner: 'FINANCE', code: null, detail: null },
      { key: 'PAYMENT_RELEASED', status: 'PENDING', owner: 'SIGNATORIES', code: 'SOMETHING_NEW', detail: '1 of 2 signatures' },
    ],
    ...over,
  };
}

describe('BillEligibilityPanel — "Why can\'t I pay this?"', () => {
  it('lists every step with its status, owner and plain-words reason, and the server verdict', async () => {
    procApi.getSupplierBillEligibility.mockResolvedValue(eligibility());
    renderWithProviders(<BillEligibilityPanel billId="b1" currencyCode="USD" />, { permissions: ['manage:payable'] });

    const list = await screen.findByRole('list', { name: 'Steps' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-status'))).toEqual(['DONE', 'BLOCKED', 'PENDING', 'NOT_APPLICABLE', 'PENDING']);

    expect(items[0]).toHaveTextContent('Submitted for approval — Done · Owner: Finance');
    expect(items[1]).toHaveTextContent('Matched to the purchase order — Blocked · Owner: Procurement');
    expect(items[1]).toHaveTextContent('3-way match exception — Procurement must resolve it or an approver must accept it (Quantity over receipt)');
    expect(items[2]).toHaveTextContent('Waiting for an approver');
    expect(items[2]).toHaveTextContent('Owner: Approver');
    expect(items[3]).toHaveTextContent('Accounting period open — Not applicable');
    // An unknown code falls back to the server's detail, shown as-is.
    expect(items[4]).toHaveTextContent('Owner: Bank signatories');
    expect(items[4]).toHaveTextContent('1 of 2 signatures');

    expect(
      screen.getByText('3-way match exception — Procurement must resolve it or an approver must accept it — owner: Procurement'),
    ).toBeInTheDocument();
    expect(screen.getByText('A payment needs 2 bank signatures to be released.')).toBeInTheDocument();
    expect(procApi.getSupplierBillEligibility).toHaveBeenCalledWith('b1');
  });

  it('says a payable bill is ready to pay, with what is outstanding', async () => {
    procApi.getSupplierBillEligibility.mockResolvedValue(eligibility({ canPay: true, blockedReason: null, steps: [] }));
    renderWithProviders(<BillEligibilityPanel billId="b1" currencyCode="USD" />, { permissions: ['manage:payable'] });
    expect(await screen.findByText(/^Ready to pay — .*1,200\.00 not yet covered by a payment\.$/)).toBeInTheDocument();
  });

  it('renders nothing and never calls the API without manage:payable', () => {
    const { container } = renderWithProviders(<BillEligibilityPanel billId="b1" />, { permissions: ['view:accounting'] });
    expect(container).toBeEmptyDOMElement();
    expect(procApi.getSupplierBillEligibility).not.toHaveBeenCalled();
  });
});

describe('Finance project workspace — Payables and Payments tabs', () => {
  const header = {
    item: {
      projectId: 'p1',
      code: 'ACC-01',
      name: 'Mogadishu clinic',
      clientName: null,
      status: 'ACTIVE',
      currency: 'USD',
      contractValue: null,
      readyToBill: { count: 0, draftCount: 0, amount: '0.00' },
      overdueInvoices: { count: 0, oldestDaysPastDue: null },
      billsToPay: { count: 0, amount: '0.00' },
    },
  };

  function renderWorkspace(permissions: string[]) {
    financeApi.getFinanceProject.mockResolvedValue({ ...header, moneyVisible: true, marginVisible: true, asOf: '2026-10-03T00:00:00.000Z' });
    return renderWithProviders(
      <FinanceProjectWorkspace projectId="p1">
        <div>tab body</div>
      </FinanceProjectWorkspace>,
      { permissions },
    );
  }

  it('hides Payables and Payments from a viewer without the lists’ permissions', async () => {
    renderWorkspace([FINANCE]);
    const tabs = await screen.findByRole('navigation', { name: 'Project finance' });
    expect(within(tabs).queryByRole('link', { name: 'Payables' })).toBeNull();
    expect(within(tabs).queryByRole('link', { name: 'Payments' })).toBeNull();
  });

  it('shows Payables to a manage:payable holder', async () => {
    renderWorkspace([FINANCE, 'manage:payable']);
    const tabs = await screen.findByRole('navigation', { name: 'Project finance' });
    expect(within(tabs).getByRole('link', { name: 'Payables' })).toHaveAttribute('href', '/finance/projects/p1/payables');
    expect(within(tabs).getByRole('link', { name: 'Payments' })).toHaveAttribute('href', '/finance/projects/p1/payments');
  });

  it('Payables refuses without manage:payable and never lists bills', () => {
    renderWithProviders(<FinanceProjectPayables projectId="p1" />, { permissions: [FINANCE] });
    expect(screen.getByText("You don't have access to supplier bills")).toBeInTheDocument();
    expect(procApi.listSupplierBills).not.toHaveBeenCalled();
  });

  it('Payables lists the project’s bills (server-side filter) with an Outstanding column and no project filter', async () => {
    renderWithProviders(<FinanceProjectPayables projectId="p1" />, { permissions: [FINANCE, 'manage:payable'] });
    await waitFor(() => expect(procApi.listSupplierBills).toHaveBeenCalledWith({ projectId: 'p1' }));
    expect(await screen.findByRole('heading', { name: 'Supplier bills' })).toBeInTheDocument();
  });

  it('Payments shows only the sections the viewer may read, each fixed to the project', async () => {
    renderWithProviders(<FinanceProjectPayments projectId="p1" />, { permissions: [FINANCE, 'manage:receivable'] });
    expect(await screen.findByRole('heading', { name: 'Client receipts' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Supplier payments' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Manual journals' })).toBeNull();
    await waitFor(() => expect(receiptsApi.listReceipts).toHaveBeenCalledWith(undefined, 'p1'));
    expect(procApi.listSupplierPayments).not.toHaveBeenCalled();
    expect(accountingApi.listJournals).not.toHaveBeenCalled();
  });

  it('Payments passes the project to supplier payments and journals', async () => {
    renderWithProviders(<FinanceProjectPayments projectId="p1" />, {
      permissions: [FINANCE, 'manage:payable', 'manage:journal'],
    });
    await waitFor(() => expect(procApi.listSupplierPayments).toHaveBeenCalledWith({ projectId: 'p1' }));
    await waitFor(() => expect(accountingApi.listJournals).toHaveBeenCalledWith('p1'));
    expect(receiptsApi.listReceipts).not.toHaveBeenCalled();
  });
});

describe('Finance lists — project filter', () => {
  it('the receipts list sends the chosen project to the API', async () => {
    // One row, so the grid shows its toolbar (an empty list shows the empty state instead).
    receiptsApi.listReceipts.mockResolvedValue([
      { id: 'r1', receiptDate: '2026-09-30', reference: 'RCPT-1', clientId: 'c1', postingStatus: 'POSTED', totalAmount: '100.00', currencyCode: 'USD' },
    ]);
    renderWithProviders(<ReceiptsList />, { permissions: ['manage:receivable'] });
    await waitFor(() => expect(receiptsApi.listReceipts).toHaveBeenCalledWith(undefined, undefined));
    await chooseOption(userEvent.setup(), await screen.findByLabelText('Project'), 'p2');
    await waitFor(() => expect(receiptsApi.listReceipts).toHaveBeenCalledWith(undefined, 'p2'));
  });

  it('a project-fixed bills list offers no project filter', async () => {
    renderWithProviders(<SupplierBillsList projectId="p1" />, { permissions: ['manage:payable'] });
    await waitFor(() => expect(procApi.listSupplierBills).toHaveBeenCalledWith({ projectId: 'p1' }));
    expect(screen.queryByLabelText('Project')).toBeNull();
  });
});

describe('PoBillPaymentsSection', () => {
  const response: PurchaseOrderBillPaymentsResponse = {
    purchaseOrderId: 'po1',
    bills: [
      {
        billId: 'b1',
        billNumber: 'BILL-0007',
        supplierInvoiceNumber: 'INV-55',
        billDate: '2026-09-01',
        dueDate: '2026-10-01',
        currencyCode: 'USD',
        documentStatus: 'APPROVED',
        postingStatus: 'POSTED',
        totalAmount: '1000.00',
        paidAmount: '400.00',
        pendingAmount: '100.00',
        outstandingAmount: '500.00',
        lastPaymentDate: '2026-09-20',
        paymentStatus: 'PARTIALLY_PAID',
      },
    ],
  };

  it('is not rendered, and the API is not called, without view:commitment-ledger', () => {
    const { container } = renderWithProviders(<PoBillPaymentsSection purchaseOrderId="po1" />, {
      permissions: ['view:procurement'],
    });
    expect(container).toBeEmptyDOMElement();
    expect(procApi.getPurchaseOrderBillPayments).not.toHaveBeenCalled();
  });

  it('shows each bill with paid, in progress, outstanding, last payment and status', async () => {
    procApi.getPurchaseOrderBillPayments.mockResolvedValue(response);
    renderWithProviders(<PoBillPaymentsSection purchaseOrderId="po1" />, {
      permissions: ['view:procurement', 'view:commitment-ledger'],
    });
    expect(await screen.findAllByText('BILL-0007')).not.toHaveLength(0);
    expect(procApi.getPurchaseOrderBillPayments).toHaveBeenCalledWith('po1');
    const section = screen.getByRole('heading', { name: 'Supplier bills & payments' }).closest('section')!;
    expect(within(section).getAllByText('Partly paid').length).toBeGreaterThan(0);
    for (const header of ['Total', 'Paid', 'In progress', 'Outstanding', 'Last payment']) {
      expect(within(section).getAllByRole('columnheader', { name: new RegExp(`^${header}`) }).length).toBeGreaterThan(0);
    }
    expect(within(section).getAllByText(/400\.00/).length).toBeGreaterThan(0);
    expect(within(section).getAllByText(/500\.00/).length).toBeGreaterThan(0);
  });
});

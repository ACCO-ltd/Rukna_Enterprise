import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type {
  CommercialBillingResponse,
  CommercialInvoiceRow,
  CommercialReceiptRow,
  CommercialSummaryResponse,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';
import * as commercialHooks from '../hooks/use-commercial';

import { BillingCollectionTab } from './billing-collection-tab';

vi.mock('../hooks/use-commercial', () => ({
  useCommercialBilling: vi.fn(),
  useProjectDepositAccounts: vi.fn(() => ({ data: [], isPending: false, isError: false })),
  useRecordProjectPayment: vi.fn(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null })),
}));

vi.mock('@/features/accounting/hooks/use-invoices', () => ({
  useOpenInvoiceDocument: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

// ─── Factories ───────────────────────────────────────────────────────────────

const TODAY = '2026-09-17';

function makeInvoice(overrides: Partial<CommercialInvoiceRow> = {}): CommercialInvoiceRow {
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-0001',
    source: { kind: 'INSTALLMENT', label: null, id: 'inst-1' },
    invoiceDate: '2026-08-01',
    dueDate: '2026-10-01',
    currency: 'USD',
    subtotal: '100000.00',
    vatAmount: '5000.00',
    totalAmount: '105000.00',
    paidAmount: '0.00',
    outstandingAmount: '105000.00',
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    status: 'UNPAID',
    daysOverdue: 0,
    ...overrides,
  } as CommercialInvoiceRow;
}

function makeReceipt(overrides: Partial<CommercialReceiptRow> = {}): CommercialReceiptRow {
  return {
    id: 'rcpt-1',
    receiptDate: '2026-09-01',
    currency: 'USD',
    totalAmount: '60000.00',
    allocatedAmount: '60000.00',
    unallocatedAmount: '0.00',
    allocatedToThisContract: '60000.00',
    paymentMethod: 'Bank transfer',
    reference: 'TT-001',
    postingStatus: 'POSTED',
    allocations: [
      {
        id: 'alloc-1',
        invoiceId: 'inv-1',
        invoiceNumber: 'INV-0001',
        allocatedAmount: '60000.00',
        allocationDate: '2026-09-01',
      },
    ],
    ...overrides,
  } as unknown as CommercialReceiptRow;
}

function makeBilling(overrides: Partial<CommercialBillingResponse> = {}): CommercialBillingResponse {
  return {
    projectId: 'p-1',
    contractId: 'c-1',
    currency: 'USD',
    billingModel: 'PAYMENT_INSTALLMENTS',
    financialsVisible: true,
    position: {
      invoiced: '105000.00',
      collected: '60000.00',
      outstanding: '45000.00',
      overdue: '0.00',
      postedInvoiceCount: 1,
      overdueInvoiceCount: 0,
      collectionRate: 57,
    },
    invoices: [makeInvoice()],
    receipts: [makeReceipt()],
    clientUnappliedTotal: '0.00',
    aging: [],
    capabilities: {
      canViewFinancials: true,
      canEditContract: false,
      canAdvanceContract: false,
      canReopenContract: false,
      canCreateApplication: false,
      canManageApplication: false,
      canReviewApplication: false,
      canIssueCertificate: false,
      canGenerateInvoice: false,
      canPostInvoice: false,
      canManageGuarantee: false,
      canRecordSignedDate: false,
      canRecordReceipt: true,
      canAllocateReceipt: false,
      canReverseVariation: false,
    },
    asOf: TODAY + 'T00:00:00.000Z',
    ...overrides,
  } as unknown as CommercialBillingResponse;
}

function makeSummary(overrides: Partial<CommercialSummaryResponse> = {}): CommercialSummaryResponse {
  return {
    projectId: 'p-1',
    currency: 'USD',
    financialsVisible: true,
    attention: [],
    mainContract: {
      id: 'c-1',
      contractNumber: 'CT-01',
      status: 'ACTIVE',
      clientName: 'Client A',
      contractValue: '1000000.00',
      totalClientRevenue: '1000000.00',
      currency: 'USD',
      billingModel: 'PAYMENT_INSTALLMENTS',
    },
    contractValue: {
      originalContractValue: '1000000.00',
      approvedVariationsTotal: '0.00',
      governingContractValue: '1000000.00',
      pendingVariations: '0.00',
    },
    ...overrides,
  } as unknown as CommercialSummaryResponse;
}

function stubBilling(data: CommercialBillingResponse) {
  vi.mocked(commercialHooks.useCommercialBilling).mockReturnValue({
    isPending: false,
    isError: false,
    data,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof commercialHooks.useCommercialBilling>);
}

function renderTab(
  billingData: CommercialBillingResponse = makeBilling(),
  summaryData: CommercialSummaryResponse = makeSummary(),
) {
  stubBilling(billingData);
  return renderWithProviders(
    <BillingCollectionTab projectId="p-1" summary={summaryData} />,
    { permissions: [] },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── T-BC-1: no accounting internals in rendered output ──────────────────────

describe('BillingCollectionTab — no accounting internals (spec §15 test 11)', () => {
  it('never renders raw posting/document status strings or journal terminology', () => {
    renderTab();

    // Raw enum values must never reach the DOM
    expect(screen.queryByText('POSTED')).not.toBeInTheDocument();
    expect(screen.queryByText('NOT_POSTED')).not.toBeInTheDocument();
    expect(screen.queryByText('APPROVED')).not.toBeInTheDocument();
    expect(screen.queryByText('journalEntry')).not.toBeInTheDocument();
  });
});

// ─── T-BC-2: no unbuilt CTA buttons ──────────────────────────────────────────

describe('BillingCollectionTab — no unbuilt CTAs (spec §15 test 12)', () => {
  it('does not render Promise to Pay, Dispute, or Write-off buttons', () => {
    renderTab();

    expect(screen.queryByRole('button', { name: /promise to pay/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dispute/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /write.?off/i })).not.toBeInTheDocument();
  });
});

// ─── T-BC-3: receivables summary strip ───────────────────────────────────────

describe('BillingCollectionTab — receivables summary strip', () => {
  it('shows billed, collected, outstanding, and overdue labels from position data', () => {
    renderTab();

    expect(screen.getByText('Billed')).toBeInTheDocument();
    expect(screen.getByText('Collected')).toBeInTheDocument();
    expect(screen.getByText('Outstanding')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('renders money values from the billing position', () => {
    renderTab();

    // Values appear in the summary strip (and possibly also in the invoices table).
    expect(screen.getAllByText('$105,000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$60,000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$45,000.00').length).toBeGreaterThanOrEqual(1);
  });
});

// ─── T-BC-4: overdue invoice in Needs Attention ───────────────────────────────

describe('BillingCollectionTab — Needs Attention panel', () => {
  it('shows overdue invoice in Needs Attention section', () => {
    renderTab(
      makeBilling({
        invoices: [
          makeInvoice({
            dueDate: '2026-09-01',
            outstandingAmount: '45000.00',
            status: 'UNPAID',
            daysOverdue: 16,
          }),
        ],
      }),
    );

    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    // INV-0001 appears in Needs Attention and Open Invoices — assert at least one
    expect(screen.getAllByText('INV-0001').length).toBeGreaterThanOrEqual(1);
  });

  it('hides the Needs Attention section when no invoices are overdue', () => {
    renderTab(
      makeBilling({
        invoices: [makeInvoice({ dueDate: '2026-10-01', status: 'UNPAID', daysOverdue: 0 })],
      }),
    );

    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
  });
});

// ─── T-BC-5: DRAFT invoice has no Record Payment button ──────────────────────

describe('BillingCollectionTab — CTA visibility for DRAFT invoice', () => {
  it('does not render Record payment for a DRAFT invoice', () => {
    renderTab(
      makeBilling({
        invoices: [
          makeInvoice({
            status: 'DRAFT',
            documentStatus: 'DRAFT',
            postingStatus: 'NOT_POSTED',
          }),
        ],
      }),
    );

    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });

  it('does not render Record payment for an AWAITING_POSTING invoice', () => {
    renderTab(
      makeBilling({
        invoices: [
          makeInvoice({
            status: 'AWAITING_POSTING',
            documentStatus: 'APPROVED',
            postingStatus: 'NOT_POSTED',
          }),
        ],
      }),
    );

    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });
});

// ─── T-BC-6: PAID invoice has no Record Payment button ───────────────────────

describe('BillingCollectionTab — CTA visibility for PAID invoice', () => {
  it('does not render Record payment for a fully paid invoice', () => {
    renderTab(
      makeBilling({
        invoices: [
          makeInvoice({
            status: 'PAID',
            outstandingAmount: '0.00',
            paidAmount: '105000.00',
          }),
        ],
      }),
    );

    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });
});

// ─── T-BC-7: canRecordReceipt: false hides all Record Payment buttons ─────────

describe('BillingCollectionTab — canRecordReceipt capability gate', () => {
  it('hides all Record payment buttons when canRecordReceipt is false', () => {
    renderTab(
      makeBilling({
        invoices: [
          makeInvoice({ status: 'UNPAID', dueDate: '2026-10-01' }),
          makeInvoice({
            id: 'inv-2',
            invoiceNumber: 'INV-0002',
            status: 'PARTIALLY_PAID',
            dueDate: '2026-10-01',
          }),
        ],
        capabilities: {
          canViewFinancials: true,
          canEditContract: false,
          canAdvanceContract: false,
          canReopenContract: false,
          canCreateApplication: false,
          canManageApplication: false,
          canReviewApplication: false,
          canIssueCertificate: false,
          canGenerateInvoice: false,
          canPostInvoice: false,
          canManageGuarantee: false,
          canRecordSignedDate: false,
          canRecordReceipt: false,
          canAllocateReceipt: false,
          canReverseVariation: false,
        },
      }),
    );

    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });

  it('shows Record payment button when canRecordReceipt is true and invoice is payable', () => {
    renderTab(
      makeBilling({
        invoices: [makeInvoice({ status: 'UNPAID', dueDate: '2026-10-01' })],
      }),
    );

    expect(screen.getByRole('button', { name: 'Record payment' })).toBeInTheDocument();
  });
});

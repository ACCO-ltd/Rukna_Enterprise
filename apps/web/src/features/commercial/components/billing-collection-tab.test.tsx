import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type {
  CommercialAgingBucket,
  CommercialBillingPackagesResponse,
  CommercialBillingResponse,
  CommercialInvoiceRow,
  CommercialReceiptRow,
  CommercialSummaryResponse,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';
import * as commercialHooks from '../hooks/use-commercial';

import { BillingCollectionTab } from './billing-collection-tab';
import { toCumulativeSeries } from './cashflow-chart';

vi.mock('../hooks/use-commercial', () => ({
  useCommercialBilling: vi.fn(),
  useBillingPackages: vi.fn(),
}));

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

// ─── Fixtures ───────────────────────────────────────────────────────────────────

function invoice(overrides: Partial<CommercialInvoiceRow> = {}): CommercialInvoiceRow {
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-0001',
    source: { kind: 'IPC', label: null },
    invoiceDate: '2026-01-10',
    dueDate: '2026-02-10',
    currency: 'USD',
    subtotal: '100000.00',
    vatAmount: '5000.00',
    totalAmount: '105000.00',
    paidAmount: '0.00',
    outstandingAmount: '105000.00',
    documentStatus: 'ISSUED',
    postingStatus: 'POSTED',
    status: 'UNPAID',
    daysOverdue: 0,
    ...overrides,
  } as unknown as CommercialInvoiceRow;
}

function receipt(overrides: Partial<CommercialReceiptRow> = {}): CommercialReceiptRow {
  return {
    id: 'rcpt-1',
    receiptDate: '2026-01-20',
    currency: 'USD',
    totalAmount: '60000.00',
    allocatedAmount: '60000.00',
    unallocatedAmount: '0.00',
    allocatedToThisContract: '60000.00',
    paymentMethod: 'Bank transfer',
    reference: 'TT-991',
    postingStatus: 'POSTED',
    allocations: [
      {
        id: 'alloc-1',
        invoiceId: 'inv-1',
        invoiceNumber: 'INV-0001',
        allocatedAmount: '60000.00',
        allocationDate: '2026-01-20',
      },
    ],
    ...overrides,
  } as unknown as CommercialReceiptRow;
}

function aging(
  buckets: Array<{ bucket: CommercialAgingBucket['bucket']; amount: string | null; invoiceCount?: number }>,
): CommercialAgingBucket[] {
  return buckets.map((b) => ({ bucket: b.bucket, amount: b.amount, invoiceCount: b.invoiceCount ?? 1 }));
}

function billing(overrides: Partial<CommercialBillingResponse> = {}): CommercialBillingResponse {
  return {
    projectId: 'p-1',
    contractId: 'c-1',
    currency: 'USD',
    billingModel: 'MEASURED_IPC',
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
    invoices: [invoice()],
    receipts: [receipt()],
    clientUnappliedTotal: '0.00',
    aging: aging([{ bucket: 'DAYS_1_30', amount: '45000.00' }]),
    capabilities: {
      canViewFinancials: true,
      canAllocateReceipt: false,
    },
    asOf: '2026-01-31T00:00:00.000Z',
    ...overrides,
  } as unknown as CommercialBillingResponse;
}

function summary(overrides: Partial<CommercialSummaryResponse> = {}): CommercialSummaryResponse {
  return {
    projectId: 'p-1',
    currency: 'USD',
    financialsVisible: true,
    mainContract: {
      id: 'c-1',
      contractNumber: 'CT-01',
      status: 'ACTIVE',
      clientName: 'Client A',
      contractValue: '1000000.00',
      totalClientRevenue: '1000000.00',
      currency: 'USD',
      billingModel: 'MEASURED_IPC',
    },
    contractValue: {
      originalContractValue: '1000000.00',
      approvedVariationsTotal: '150000.00',
      governingContractValue: '1150000.00',
      pendingVariations: '0.00',
    },
    ...overrides,
  } as unknown as CommercialSummaryResponse;
}

function stub(data: CommercialBillingResponse) {
  vi.mocked(commercialHooks.useCommercialBilling).mockReturnValue({
    isPending: false,
    isError: false,
    data,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof commercialHooks.useCommercialBilling>);
}

/** Stub the S-VB-7 billing-packages read; defaults to no packages (panel absent). */
function stubPackages(data?: CommercialBillingPackagesResponse) {
  vi.mocked(commercialHooks.useBillingPackages).mockReturnValue({
    isPending: false,
    isError: false,
    data,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof commercialHooks.useBillingPackages>);
}

function renderTab(
  billingData: CommercialBillingResponse,
  summaryData: CommercialSummaryResponse = summary(),
  packagesData?: CommercialBillingPackagesResponse,
) {
  stub(billingData);
  if (packagesData !== undefined) stubPackages(packagesData);
  return renderWithProviders(
    <BillingCollectionTab projectId="p-1" summary={summaryData} />,
    { permissions: [] },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no billing packages, so the Stage-billing panel is absent unless a test provides one.
  stubPackages(undefined);
});

// ─── S-BL-1 money story ─────────────────────────────────────────────────────────

describe('BillingCollectionTab — money story (S-BL-1)', () => {
  it('renders the Contract value → Invoiced → Collected → Outstanding chain', () => {
    renderTab(billing());

    const story = screen.getByRole('heading', { name: 'Money story' }).closest('section')!;
    const scope = within(story);
    // The governing contract value from the summary, composed with billing's settlement figures.
    expect(scope.getByText('$1,150,000.00')).toBeInTheDocument();
    expect(scope.getByText('$105,000.00')).toBeInTheDocument(); // invoiced
    expect(scope.getByText('$60,000.00')).toBeInTheDocument(); // collected
    expect(scope.getByText('$45,000.00')).toBeInTheDocument(); // outstanding
  });

  it('shows the approved-variations entitlement as a distinct figure, not folded into invoiced', () => {
    renderTab(billing());

    expect(screen.getByText('Approved variations')).toBeInTheDocument();
    expect(screen.getByText('$150,000.00')).toBeInTheDocument();
  });

  it('omits the approved-variations line when there are no approved variations (not a $0 leak)', () => {
    renderTab(
      billing(),
      summary({
        contractValue: {
          originalContractValue: '1000000.00',
          approvedVariationsTotal: '0.00',
          governingContractValue: '1000000.00',
          pendingVariations: '0.00',
        },
      }),
    );

    expect(screen.queryByText('Approved variations')).not.toBeInTheDocument();
  });

  it('a withheld-money user sees RESTRICTED, never $0, across the chain and the variations line', () => {
    renderTab(
      billing({
        // A withheld-money role: the server nulls every money field and drops financialsVisible.
        financialsVisible: false,
        position: {
          invoiced: null,
          collected: null,
          outstanding: null,
          overdue: null,
          postedInvoiceCount: 1,
          overdueInvoiceCount: 0,
          collectionRate: null,
        },
      }),
      summary({
        financialsVisible: false,
        contractValue: {
          originalContractValue: null,
          approvedVariationsTotal: null,
          governingContractValue: null,
          pendingVariations: null,
        },
      }),
    );

    const story = screen.getByRole('heading', { name: 'Money story' }).closest('section')!;
    // The four-link chain renders RESTRICTED (one per figure), and no $0 appears in the chain.
    expect(within(story).getAllByText('Restricted').length).toBe(4);
    expect(within(story).queryByText('$0.00')).not.toBeInTheDocument();

    // The approved-variations line is present (restricted posture) and shows RESTRICTED, not $0.
    const variationsLine = screen.getByText('Approved variations').closest('p')!;
    expect(within(variationsLine).getByText('Restricted')).toBeInTheDocument();
    expect(within(variationsLine).queryByText('$0.00')).not.toBeInTheDocument();
  });
});

// ─── S-BL-2 cashflow chart ──────────────────────────────────────────────────────

describe('cashflow chart cumulative series (S-BL-2)', () => {
  it('computes a cumulative running total that matches the ledger at each point', () => {
    const series = toCumulativeSeries([
      { date: '2026-01-10', amount: '105000.00' },
      { date: '2026-03-10', amount: '95000.00' },
      { date: '2026-02-10', amount: '50000.00' },
    ]);

    // Sorted by date, then a running sum: 105k → 155k → 250k.
    expect(series.map((p) => p.date)).toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
    expect(series.map((p) => p.cumulative)).toEqual([105000, 155000, 250000]);
  });

  it('treats a null amount as a zero contribution rather than breaking the series', () => {
    const series = toCumulativeSeries([
      { date: '2026-01-10', amount: '100.00' },
      { date: '2026-01-11', amount: null },
      { date: '2026-01-12', amount: '50.00' },
    ]);
    expect(series.map((p) => p.cumulative)).toEqual([100, 100, 150]);
  });

  it('renders the chart when invoices exist', () => {
    renderTab(billing());
    // The chart is an img with an aria summary carrying the final cumulative figures.
    expect(
      screen.getByRole('img', { name: /Cumulative invoiced vs collected/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Cumulative invoiced')).toBeInTheDocument();
    expect(screen.getByText('Cumulative collected')).toBeInTheDocument();
  });

  it('shows the empty-state instead of a broken axis when there are no invoices', () => {
    renderTab(
      billing({
        invoices: [],
        receipts: [],
        position: {
          invoiced: '0.00',
          collected: '0.00',
          outstanding: '0.00',
          overdue: '0.00',
          postedInvoiceCount: 0,
          overdueInvoiceCount: 0,
          collectionRate: null,
        },
        aging: [],
      }),
    );

    expect(
      screen.getByText('The cashflow curve begins once the first client invoice is posted.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Cumulative invoiced vs collected/i })).not.toBeInTheDocument();
  });
});

// ─── S-BL-3 aging ───────────────────────────────────────────────────────────────

describe('BillingCollectionTab — aging (S-BL-3)', () => {
  it('renders aging buckets whose amounts sum to the outstanding balance', () => {
    const data = billing({
      position: {
        invoiced: '105000.00',
        collected: '5000.00',
        outstanding: '100000.00',
        overdue: '40000.00',
        postedInvoiceCount: 1,
        overdueInvoiceCount: 1,
        collectionRate: 5,
      },
      aging: aging([
        { bucket: 'NOT_DUE', amount: '60000.00' },
        { bucket: 'DAYS_1_30', amount: '40000.00' },
      ]),
    });
    renderTab(data);

    const agingSection = screen.getByRole('heading', { name: 'Aging analysis' }).closest('section')!;
    const scope = within(agingSection);
    expect(scope.getByText('$60,000.00')).toBeInTheDocument();
    expect(scope.getByText('$40,000.00')).toBeInTheDocument();

    // The buckets sum to the server's outstanding figure — the invariant the aging view must hold.
    const bucketSum = data.aging.reduce((total, b) => total + Number(b.amount ?? 0), 0);
    expect(bucketSum).toBe(Number(data.position.outstanding));
  });
});

// ─── S-VB-7 billing packages ──────────────────────────────────────────────────────

function packages(
  overrides: Partial<CommercialBillingPackagesResponse> = {},
): CommercialBillingPackagesResponse {
  return {
    contractId: 'c-1',
    financialsVisible: true,
    packages: [
      {
        installmentId: 'inst-1',
        installmentName: 'Structure payment',
        milestoneInvoice: {
          id: 'inv-1',
          invoiceNumber: 'INV-0001',
          subtotal: '400000.00',
          totalAmount: '420000.00',
          documentStatus: 'APPROVED',
          postingStatus: 'POSTED',
        },
        variationLines: [
          {
            variationId: 'vo-1',
            reference: 'VO-001',
            title: 'Extra piling',
            allocationAmount: '50000.00',
            treatment: 'INVOICE',
            invoice: {
              id: 'inv-2',
              invoiceNumber: 'INV-0002',
              subtotal: '50000.00',
              totalAmount: '52500.00',
              documentStatus: 'APPROVED',
              postingStatus: 'POSTED',
            },
          },
        ],
        presentedTotal: '472500.00',
      },
    ],
    ...overrides,
  };
}

describe('BillingCollectionTab — stage billing packages (S-VB-7)', () => {
  it('renders a package with its milestone line, VO line and presented total', () => {
    renderTab(billing(), summary(), packages());

    const panel = screen.getByRole('heading', { name: 'Stage billing' }).closest('section')!;
    const scope = within(panel);
    expect(scope.getByText('Structure payment — billing')).toBeInTheDocument();
    // Milestone line: label, its invoice number (a link) and its total.
    expect(scope.getByText('Milestone')).toBeInTheDocument();
    expect(scope.getByRole('link', { name: 'INV-0001' })).toHaveAttribute(
      'href',
      '/finance/accounting/invoices/inv-1',
    );
    expect(scope.getByText('$420,000.00')).toBeInTheDocument();
    // The addition VO line: its own invoice link + allocation.
    expect(scope.getByText('VO-001 — Extra piling')).toBeInTheDocument();
    expect(scope.getByRole('link', { name: 'INV-0002' })).toBeInTheDocument();
    // Presented total.
    expect(scope.getByText('Presented total')).toBeInTheDocument();
    expect(scope.getByText('$472,500.00')).toBeInTheDocument();
  });

  it('redacts money (RESTRICTED, never $0) when financials are withheld', () => {
    renderTab(
      billing({ financialsVisible: false }),
      summary({ financialsVisible: false }),
      packages({
        financialsVisible: false,
        packages: [
          {
            installmentId: 'inst-1',
            installmentName: 'Structure payment',
            milestoneInvoice: {
              id: 'inv-1',
              invoiceNumber: 'INV-0001',
              subtotal: null,
              totalAmount: null,
              documentStatus: 'APPROVED',
              postingStatus: 'POSTED',
            },
            variationLines: [],
            presentedTotal: null,
          },
        ],
      }),
    );

    const panel = screen.getByRole('heading', { name: 'Stage billing' }).closest('section')!;
    const scope = within(panel);
    expect(scope.getAllByText('Restricted').length).toBeGreaterThan(0);
    expect(scope.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('omits the Stage-billing panel entirely when there are no packages', () => {
    renderTab(billing(), summary(), packages({ packages: [] }));

    expect(screen.queryByRole('heading', { name: 'Stage billing' })).not.toBeInTheDocument();
  });
});

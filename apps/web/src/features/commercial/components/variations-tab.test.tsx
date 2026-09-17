import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type {
  CommercialBillingPackage,
  CommercialContractValue,
  CommercialSummaryResponse,
  VariationOrderListItem,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';
import * as hooks from '../hooks/use-commercial';

import { VariationsTab } from './variations-tab';

// Mock the hooks module: query hooks return canned data, mutation hooks return a spyable mutate.
vi.mock('../hooks/use-commercial', () => ({
  useVariations: vi.fn(),
  useVariation: vi.fn(),
  useBillingPackages: vi.fn(),
  useExtensionsOfTime: vi.fn(),
  useCertifiedInvoicedByVariation: vi.fn(),
  useReverseVariation: vi.fn(),
  useGrantExtensionOfTime: vi.fn(),
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

const MANAGE = ['view:contract', 'manage:contract', 'approve:contract', 'view:financial-position'];

function listItem(overrides: Partial<VariationOrderListItem> = {}): VariationOrderListItem {
  return {
    id: 'vo-1',
    contractId: 'c-1',
    reference: 'VO-001',
    status: 'DRAFT',
    title: 'Additional foundations',
    description: null,
    proposedTimeImpactDays: 14,
    netPrice: '25000.00',
    lineCount: 2,
    atRiskAuthorisationCount: 0,
    atRiskExposure: '0.00',
    createdBy: 'u-1',
    submittedBy: null,
    submittedAt: null,
    internalApprovedBy: null,
    internalApprovedAt: null,
    clientApprovedBy: null,
    clientApprovedAt: null,
    clientApprovalReference: null,
    rejectedBy: null,
    rejectedAt: null,
    reason: null,
    appliedToBoq: false,
    boqNodeCount: 0,
    boqAppliedAt: null,
    boqAppliedVersionId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function contractValue(overrides: Partial<CommercialContractValue> = {}): CommercialContractValue {
  return {
    originalContractValue: '1000000.00',
    approvedVariationsTotal: '25000.00',
    governingContractValue: '1025000.00',
    pendingVariations: '5000.00',
    ...overrides,
  };
}

function summary(overrides: Partial<CommercialSummaryResponse> = {}): CommercialSummaryResponse {
  return {
    projectId: 'p-1',
    currency: 'USD',
    financialsVisible: true,
    contractValue: contractValue(),
    mainContract: {
      id: 'c-1',
      contractNumber: 'CT-001',
      status: 'ACTIVE',
      clientName: 'Acme',
      startDate: null,
      expectedEndDate: '2027-01-01T00:00:00.000Z',
      contractValue: '1000000.00',
      totalClientRevenue: '1000000.00',
      currency: 'USD',
      billingModel: 'MEASURED_IPC',
      boqVersionNumber: 1,
    },
    metrics: {} as CommercialSummaryResponse['metrics'],
    certification: { applicationsSubmitted: 0, effectiveCertificates: 0, postedInvoices: 0 },
    receivables: { collectionRate: 0, outstandingInvoices: [] },
    retention: null,
    advances: [],
    securityPosition: {
      applicable: true,
      retentionHeld: null,
      advanceRecovered: null,
      advanceOutstanding: null,
    },
    guarantees: [],
    attention: [],
    capabilities: {} as CommercialSummaryResponse['capabilities'],
    recentActivity: [],
    asOf: '2026-08-26T00:00:00.000Z',
    ...overrides,
  };
}

/** Default all hooks to a benign resolved/idle shape; individual tests override what they need. */
function stubHooks(options: {
  variations?: VariationOrderListItem[];
  packages?: CommercialBillingPackage[];
  financialsVisible?: boolean;
} = {}) {
  vi.mocked(hooks.useVariations).mockReturnValue({
    isPending: false,
    isError: false,
    data: { contractId: 'c-1', variations: options.variations ?? [listItem()] },
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof hooks.useVariations>);

  // The billing-packages read feeds the per-VO "invoiced?" chip (S-VB-12).
  vi.mocked(hooks.useBillingPackages).mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      contractId: 'c-1',
      financialsVisible: options.financialsVisible ?? true,
      packages: options.packages ?? [],
    },
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof hooks.useBillingPackages>);

  vi.mocked(hooks.useExtensionsOfTime).mockReturnValue({
    isPending: false,
    isError: false,
    data: { contractId: 'c-1', currentEndDate: '2027-01-01T00:00:00.000Z', extensions: [] },
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof hooks.useExtensionsOfTime>);

  vi.mocked(hooks.useVariation).mockReturnValue({
    isPending: true,
    isError: false,
    data: undefined,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof hooks.useVariation>);

  // P3 trace section — a benign populated read so the tab renders without hitting the network.
  vi.mocked(hooks.useCertifiedInvoicedByVariation).mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      contractId: 'c-1',
      canViewFinancials: true,
      baseScope: { certifiedToDate: '0.00', invoicedToDate: '0.00' },
      byVariation: [],
      totalCertifiedToDate: '0.00',
      totalInvoicedToDate: '0.00',
    },
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof hooks.useCertifiedInvoicedByVariation>);

  // A bare idle mutation; each mock casts it to its own hook's exact return type.
  const idle = () => ({ mutate: vi.fn(), isPending: false });

  vi.mocked(hooks.useReverseVariation).mockReturnValue(
    idle() as unknown as ReturnType<typeof hooks.useReverseVariation>,
  );
  vi.mocked(hooks.useGrantExtensionOfTime).mockReturnValue(
    idle() as unknown as ReturnType<typeof hooks.useGrantExtensionOfTime>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VariationsTab — the position band renders backend figures only', () => {
  it('shows the approved variations figure and never invents a summed total', () => {
    stubHooks();
    renderWithProviders(<VariationsTab projectId="p-1" summary={summary()} />, {
      permissions: MANAGE,
      withToast: true,
    });

    expect(screen.getByText('Approved variations')).toBeInTheDocument();
    // `getAllByText` because the approved total also appears as the VO's own net price in the
    // list below — the same figure, correctly, in two places.
    expect(screen.getAllByText(/25,000/).length).toBeGreaterThan(0);

    // variation-collapse prune: a raised variation is client-approved immediately, so the band no
    // longer carries a "pending" or "at-risk" bucket, and it never shows a summed total.
    expect(screen.queryByText('Pending client approval')).not.toBeInTheDocument();
    expect(screen.queryByText('At-risk exposure')).not.toBeInTheDocument();
    expect(screen.queryByText(/30,000/)).not.toBeInTheDocument();
  });

  it('renders the no-contract empty state when there is no main contract', () => {
    stubHooks();
    renderWithProviders(
      <VariationsTab projectId="p-1" summary={summary({ mainContract: null, contractValue: null })} />,
      { permissions: MANAGE, withToast: true },
    );
    expect(screen.getByText('No main contract')).toBeInTheDocument();
  });
});

describe('VariationsTab — list + status mapping', () => {
  it('renders each VO with its reference, signed net price and a status badge', () => {
    stubHooks({
      variations: [
        listItem({ id: 'vo-1', reference: 'VO-001', status: 'CLIENT_APPROVED', netPrice: '25000.00' }),
        listItem({
          id: 'vo-2',
          reference: 'VO-002',
          status: 'DRAFT',
          title: 'Omit landscaping',
          netPrice: '-8000.00',
        }),
      ],
    });
    renderWithProviders(<VariationsTab projectId="p-1" summary={summary()} />, {
      permissions: MANAGE,
      withToast: true,
    });

    expect(screen.getByText('VO-001')).toBeInTheDocument();
    expect(screen.getByText('Client approved')).toBeInTheDocument();
    expect(screen.getByText('VO-002')).toBeInTheDocument();
    // An omission reads negative in a neutral tabular cell (not heat-mapped).
    expect(screen.getByText(/-\$?8,000/)).toBeInTheDocument();
  });

  it('shows the empty state when there are no variations', () => {
    stubHooks({ variations: [] });
    renderWithProviders(<VariationsTab projectId="p-1" summary={summary()} />, {
      permissions: MANAGE,
      withToast: true,
    });
    expect(screen.getByText('No variations yet')).toBeInTheDocument();
  });
});

// ─── S-VB-12 "invoiced?" chip ─────────────────────────────────────────────────────

/** A Billing Package carrying a single VO allocation line, for driving the chip. */
function packageWithLine(
  line: CommercialBillingPackage['variationLines'][number],
): CommercialBillingPackage {
  return {
    installmentId: 'inst-1',
    installmentName: 'Structure payment',
    milestoneInvoice: null,
    variationLines: [line],
    presentedTotal: null,
  };
}

describe('VariationsTab — the "invoiced?" chip (S-VB-12)', () => {
  it('shows ✓ Invoiced with the invoice number for a billed addition', () => {
    stubHooks({
      variations: [listItem({ id: 'vo-1', reference: 'VO-001', status: 'CLIENT_APPROVED' })],
      packages: [
        packageWithLine({
          variationId: 'vo-1',
          reference: 'VO-001',
          title: 'Additional foundations',
          allocationAmount: '25000.00',
          treatment: 'INVOICE',
          invoice: {
            id: 'inv-9',
            invoiceNumber: 'INV-0007',
            subtotal: '25000.00',
            totalAmount: '26250.00',
            documentStatus: 'APPROVED',
            postingStatus: 'POSTED',
          },
        }),
      ],
    });
    renderWithProviders(<VariationsTab projectId="p-1" summary={summary()} />, {
      permissions: MANAGE,
      withToast: true,
    });

    expect(screen.getByText('✓ Invoiced (INV-0007)')).toBeInTheDocument();
  });

  it('shows "Omission billed" for a stage-reduction allocation', () => {
    stubHooks({
      variations: [
        listItem({ id: 'vo-2', reference: 'VO-002', status: 'CLIENT_APPROVED', netPrice: '-8000.00' }),
      ],
      packages: [
        packageWithLine({
          variationId: 'vo-2',
          reference: 'VO-002',
          title: 'Omit landscaping',
          allocationAmount: '-8000.00',
          treatment: 'STAGE_REDUCTION',
          invoice: null,
        }),
      ],
    });
    renderWithProviders(<VariationsTab projectId="p-1" summary={summary()} />, {
      permissions: MANAGE,
      withToast: true,
    });

    expect(screen.getByText('Omission billed')).toBeInTheDocument();
  });

  it('shows "Approved · not billed" for a client-approved VO with no allocation yet', () => {
    stubHooks({
      variations: [listItem({ id: 'vo-3', reference: 'VO-003', status: 'CLIENT_APPROVED' })],
      packages: [],
    });
    renderWithProviders(<VariationsTab projectId="p-1" summary={summary()} />, {
      permissions: MANAGE,
      withToast: true,
    });

    expect(screen.getByText('Approved · not billed')).toBeInTheDocument();
  });

  it('renders no chip (an em dash) for a variation that is not yet client-approved', () => {
    stubHooks({
      variations: [listItem({ id: 'vo-4', reference: 'VO-004', status: 'DRAFT' })],
      packages: [],
    });
    renderWithProviders(<VariationsTab projectId="p-1" summary={summary()} />, {
      permissions: MANAGE,
      withToast: true,
    });

    expect(screen.queryByText('Approved · not billed')).not.toBeInTheDocument();
    // No billing chip renders for a not-yet-approved VO (the chip texts, not the trace header).
    expect(screen.queryByText(/✓ Invoiced/)).not.toBeInTheDocument();
    expect(screen.queryByText('Invoiced (draft)')).not.toBeInTheDocument();
    expect(screen.queryByText('Omission billed')).not.toBeInTheDocument();
    // The billing cell renders an em dash for a not-yet-approved VO.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('VariationsTab — creation is drawer-only (variation-collapse)', () => {
  it('offers no "New variation" entry point — variations are raised from the BOQ drawer', () => {
    stubHooks();
    renderWithProviders(<VariationsTab projectId="p-1" summary={summary()} />, {
      permissions: MANAGE,
      withToast: true,
    });
    expect(screen.queryByRole('button', { name: 'New variation' })).not.toBeInTheDocument();
  });

  it('offers no create entry point even on the empty state', () => {
    stubHooks({ variations: [] });
    renderWithProviders(<VariationsTab projectId="p-1" summary={summary()} />, {
      permissions: MANAGE,
      withToast: true,
    });
    expect(screen.getByText('No variations yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New variation' })).not.toBeInTheDocument();
  });
});

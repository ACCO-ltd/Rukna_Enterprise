import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { CommercialSummaryResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { ContractMilestonesTab } from './contract-milestones-tab';

// ─── Stubs ────────────────────────────────────────────────────────────────────

vi.mock('./milestone-journey', () => ({
  MilestoneJourney: ({ viewModel }: { viewModel: { milestones: unknown[] } }) => (
    <div
      data-testid="milestone-journey"
      data-milestone-count={viewModel.milestones.length}
      data-first-state={(viewModel.milestones[0] as { userState?: string } | undefined)?.userState}
    />
  ),
}));

vi.mock('./payment-schedule-tab', () => ({
  ScheduleEditor: () => <div data-testid="schedule-editor" />,
}));

// ContractHeader reads the contract-detail query directly now (for the client-locked notice) —
// stub it idle so the header doesn't fire a real network round-trip in these tests.
vi.mock('@/features/contracts/hooks/use-contracts', () => ({
  useContract: vi.fn(() => ({ data: null, isPending: false, isError: false })),
  useRecordSignedDate: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  })),
}));

const cycleData = vi.hoisted(() => ({ value: null as unknown }));
const packageData = vi.hoisted(() => ({ value: { packages: [] } as unknown }));
vi.mock('../hooks/use-commercial', () => ({
  useCommercialCurrentCycle: () => ({
    data: cycleData.value,
    isPending: cycleData.value == null,
    isError: false,
    isSuccess: cycleData.value != null,
    refetch: vi.fn(),
  }),
  useBillingPackages: () => ({
    data: packageData.value,
    isPending: false,
    isError: false,
  }),
  useProjectSeparateCharges: () => ({
    data: { projectId: 'proj-1', items: [] },
    isPending: false,
    isError: false,
  }),
  useCreateSeparateChargeInvoice: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  useExtensionsOfTime: () => ({
    data: { contractId: 'contract-1', currentEndDate: null, extensions: [] },
    isPending: false,
    isError: false,
  }),
}));

vi.mock('./commercial-activity', () => ({
  CommercialActivity: () => <div data-testid="commercial-activity" />,
}));

// Stub the folded-in sections so their own hooks don't need mocking here.
vi.mock('./contract-security-tab', () => ({
  ContractSecurityBody: () => <div data-testid="contract-security-body" />,
  // ContractHeader reads the lifecycle stage list directly (its compact status rail moved there
  // from the now-actions-only Contract Status panel), so the mock must still provide it.
  LIFECYCLE: ['DRAFT', 'ACTIVE', 'FINAL_ACCOUNT_PENDING', 'CLOSED'],
}));

vi.mock('./variations-tab', () => ({
  VariationsTab: () => <div data-testid="variations-tab" />,
}));

// ─── Factories ────────────────────────────────────────────────────────────────

function makeSummary(
  opts: {
    originalContractValue?: string | null;
    approvedVariationsTotal?: string | null;
    governingContractValue?: string | null;
    financialsVisible?: boolean;
    outstandingInvoiceCount?: number;
  } = {},
): CommercialSummaryResponse {
  return {
    projectId: 'p-1',
    currency: 'USD',
    financialsVisible: opts.financialsVisible ?? true,
    mainContract: {
      id: 'c-1',
      contractNumber: 'ACCO-2026-014',
      status: 'ACTIVE',
      clientName: 'ACME Corp',
      startDate: '2026-09-01',
      expectedEndDate: null,
      contractValue: opts.originalContractValue ?? '500000.00',
      totalClientRevenue: null,
      currency: 'USD',
      billingModel: 'MILESTONE',
      boqVersionNumber: 1,
    },
    contractValue: {
      originalContractValue: opts.originalContractValue ?? '500000.00',
      approvedVariationsTotal: opts.approvedVariationsTotal ?? '0.00',
      governingContractValue: opts.governingContractValue ?? '500000.00',
      pendingVariations: null,
    },
    metrics: {
      contractValue: { value: null, state: 'RESTRICTED' },
      certifiedGross: { value: null, state: 'RESTRICTED' },
      certifiedNet: { value: null, state: 'RESTRICTED' },
      invoiced: { value: null, state: 'RESTRICTED' },
      received: { value: null, state: 'RESTRICTED' },
      outstanding: { value: null, state: 'RESTRICTED' },
      uninvoicedCertified: { value: null, state: 'RESTRICTED' },
    },
    certification: {
      applicationsSubmitted: 0,
      effectiveCertificates: 0,
      postedInvoices: 0,
    },
    receivables: {
      collectionRate: null,
      outstandingInvoices: Array.from(
        { length: opts.outstandingInvoiceCount ?? 0 },
        (_, i) => ({
          id: `inv-${i}`,
          invoiceNumber: null,
          invoiceDate: '2026-09-01',
          dueDate: '2026-09-08',
          outstandingAmount: '1000.00',
          currency: 'USD',
          daysOverdue: 0,
        }),
      ),
    },
    securityPosition: { applicable: false, retentionHeld: null, advanceRecovered: null, advanceOutstanding: null },
    retention: null,
    advances: [],
    guarantees: [],
    attention: [],
    capabilities: {
      canInvoice: false,
      canManageContract: true,
    } as unknown as CommercialSummaryResponse['capabilities'],
    recentActivity: [],
    asOf: '2026-09-17T00:00:00Z',
  } as unknown as CommercialSummaryResponse;
}

function makeCycle(
  installments: {
    id?: string;
    sortOrder?: number;
    name?: string;
    percentage?: string;
    status?: string;
    dueDate?: string | null;
  }[] = [],
) {
  return {
    paymentSchedule: {
      currency: 'USD',
      contractValue: '500000.00',
      totalCollected: null,
      installments: installments.map((i, idx) => ({
        id: i.id ?? `inst-${idx + 1}`,
        sortOrder: i.sortOrder ?? idx + 1,
        name: i.name ?? `Stage ${idx + 1}`,
        percentage: i.percentage ?? '0.2500',
        amount: null,
        amountPaid: null,
        triggerType: 'MILESTONE',
        milestoneLabel: null,
        dueOffsetDays: null,
        dueDate: i.dueDate ?? null,
        status: i.status ?? 'UPCOMING',
        programmeMilestone: null,
      })),
      variationLines: [],
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  cycleData.value = null;
  packageData.value = { packages: [] };
});

describe('ContractMilestonesTab', () => {
  it('renders empty state when no contract', () => {
    const summary = { ...makeSummary(), mainContract: null };
    renderWithProviders(
      <ContractMilestonesTab projectId="p-1" summary={summary as CommercialSummaryResponse} />,
    );
    expect(screen.getByText(/no contract/i)).toBeInTheDocument();
  });

  it('shows the current (governing) contract value in the header', () => {
    // Header shows only the current value — the approved/pending-variations breakdown lives on
    // the Variations section instead (it already has its own Approved/Omissions summary band,
    // sourced from the same figures), so a contract with no variations doesn't leave an empty
    // grid cell in the header.
    cycleData.value = makeCycle([{ status: 'NEXT' }]);
    renderWithProviders(
      <ContractMilestonesTab
        projectId="p-1"
        summary={makeSummary({
          originalContractValue: '500000.00',
          approvedVariationsTotal: '25000.00',
          governingContractValue: '525000.00',
        })}
      />,
    );
    expect(screen.getByText(/525,000/)).toBeInTheDocument();
  });

  it('renders schedule editor below the journey', () => {
    cycleData.value = makeCycle([{ status: 'NEXT' }]);
    renderWithProviders(
      <ContractMilestonesTab projectId="p-1" summary={makeSummary()} />,
    );
    expect(screen.getByTestId('schedule-editor')).toBeInTheDocument();
  });

  it('renders milestone journey when schedule is available', () => {
    cycleData.value = makeCycle([
      { id: 'inst-1', status: 'PAID', name: 'Advance' },
      { id: 'inst-2', status: 'NEXT', name: 'Structure' },
      { id: 'inst-3', status: 'UPCOMING', name: 'Partition' },
    ]);
    renderWithProviders(
      <ContractMilestonesTab projectId="p-1" summary={makeSummary()} />,
    );
    const journey = screen.getByTestId('milestone-journey');
    expect(journey).toBeInTheDocument();
    expect(journey.getAttribute('data-milestone-count')).toBe('3');
  });

  it('restores an issued invoice journey from billing packages after refresh', () => {
    cycleData.value = makeCycle([{ id: 'inst-1', status: 'BILLED', name: 'Structure' }]);
    packageData.value = {
      packages: [
        {
          installmentId: 'inst-1',
          documents: [
            {
              invoiceId: 'invoice-1',
              invoiceNumber: 'INV-0001',
              dueDate: '2026-10-01',
              deliveries: [],
            },
          ],
        },
      ],
    };

    renderWithProviders(
      <ContractMilestonesTab projectId="p-1" summary={makeSummary()} />,
    );

    expect(screen.getByTestId('milestone-journey')).toHaveAttribute(
      'data-first-state',
      'invoice-issued',
    );
  });

  it.each(['PARTIALLY_PAID', 'PAID'])('%s remains authoritative after delivery', (status) => {
    cycleData.value = makeCycle([{ id: 'inst-1', status, name: 'Structure' }]);
    packageData.value = {
      packages: [
        {
          installmentId: 'inst-1',
          documents: [
            {
              invoiceId: 'invoice-1',
              invoiceNumber: 'INV-0001',
              dueDate: '2026-10-01',
              deliveries: [{ method: 'WHATSAPP' }],
            },
          ],
        },
      ],
    };

    renderWithProviders(
      <ContractMilestonesTab projectId="p-1" summary={makeSummary()} />,
    );

    expect(screen.getByTestId('milestone-journey')).toHaveAttribute(
      'data-first-state',
      status === 'PAID' ? 'paid' : 'partially-paid',
    );
  });

  it('has no "Bill Stage" or "Generate Invoice" button', () => {
    cycleData.value = makeCycle([{ status: 'NEXT' }]);
    renderWithProviders(
      <ContractMilestonesTab projectId="p-1" summary={makeSummary()} />,
    );
    expect(screen.queryByRole('button', { name: /bill stage/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /bill this stage/i })).not.toBeInTheDocument();
  });

  it('contains no IPC, IPA or certificate terminology', () => {
    cycleData.value = makeCycle([{ status: 'NEXT' }]);
    renderWithProviders(
      <ContractMilestonesTab projectId="p-1" summary={makeSummary()} />,
    );
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\bIPC\b/);
    expect(text).not.toMatch(/\bIPA\b/);
    expect(text).not.toMatch(/\bcertificate\b/i);
  });

  it('renders the folded contract-security and variations sections', () => {
    cycleData.value = makeCycle([{ status: 'NEXT' }]);
    renderWithProviders(
      <ContractMilestonesTab projectId="p-1" summary={makeSummary()} />,
    );
    expect(screen.getByTestId('contract-security-body')).toBeInTheDocument();
    expect(screen.getByTestId('variations-tab')).toBeInTheDocument();
  });

  describe('signed-date completion (operational exception — allowed on ACTIVE)', () => {
    function summaryMissingSignedDate(canRecordSignedDate: boolean): CommercialSummaryResponse {
      const base = makeSummary();
      return {
        ...base,
        mainContract: { ...base.mainContract!, signedDate: null },
        capabilities: {
          ...base.capabilities,
          canRecordSignedDate,
        } as unknown as CommercialSummaryResponse['capabilities'],
      };
    }

    it('offers "Complete record" when signedDate is missing and the caller may record it', () => {
      cycleData.value = makeCycle([{ status: 'NEXT' }]);
      renderWithProviders(
        <ContractMilestonesTab projectId="p-1" summary={summaryMissingSignedDate(true)} />,
      );
      expect(screen.getByText(/not recorded/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /complete record/i })).toBeInTheDocument();
    });

    it('hides "Complete record" when the caller lacks the capability, even though signedDate is missing', () => {
      cycleData.value = makeCycle([{ status: 'NEXT' }]);
      renderWithProviders(
        <ContractMilestonesTab projectId="p-1" summary={summaryMissingSignedDate(false)} />,
      );
      expect(screen.getByText(/not recorded/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /complete record/i })).not.toBeInTheDocument();
    });
  });
});

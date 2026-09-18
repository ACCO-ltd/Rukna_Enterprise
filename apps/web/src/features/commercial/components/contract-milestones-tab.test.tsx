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
    />
  ),
}));

vi.mock('./payment-schedule-tab', () => ({
  ScheduleEditor: () => <div data-testid="schedule-editor" />,
}));

const cycleData = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../hooks/use-commercial', () => ({
  useCommercialCurrentCycle: () => ({
    data: cycleData.value,
    isPending: cycleData.value == null,
    isError: false,
    isSuccess: cycleData.value != null,
    refetch: vi.fn(),
  }),
}));

vi.mock('./commercial-activity', () => ({
  CommercialActivity: () => <div data-testid="commercial-activity" />,
}));

// Stub the folded-in sections so their own hooks don't need mocking here.
vi.mock('./contract-security-tab', () => ({
  ContractSecurityBody: () => <div data-testid="contract-security-body" />,
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
});

describe('ContractMilestonesTab', () => {
  it('renders empty state when no contract', () => {
    const summary = { ...makeSummary(), mainContract: null };
    renderWithProviders(
      <ContractMilestonesTab projectId="p-1" summary={summary as CommercialSummaryResponse} />,
    );
    expect(screen.getByText(/no contract/i)).toBeInTheDocument();
  });

  it('shows original contract value and current contract value as separate figures', () => {
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
    // Both original and current appear (formatted as USD)
    expect(screen.getByText(/500,000/)).toBeInTheDocument();
    expect(screen.getByText(/525,000/)).toBeInTheDocument();
  });

  it('shows approved variations total in its own row', () => {
    cycleData.value = makeCycle([{ status: 'NEXT' }]);
    renderWithProviders(
      <ContractMilestonesTab
        projectId="p-1"
        summary={makeSummary({
          approvedVariationsTotal: '25000.00',
          governingContractValue: '525000.00',
        })}
      />,
    );
    expect(screen.getByText('Approved variations')).toBeInTheDocument();
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
});

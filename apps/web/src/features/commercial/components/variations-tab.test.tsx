import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
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
  useExtensionsOfTime: vi.fn(),
  useCertifiedInvoicedByVariation: vi.fn(),
  useAtRiskCommencements: vi.fn(),
  useCreateVariation: vi.fn(),
  useSubmitVariation: vi.fn(),
  useInternalApproveVariation: vi.fn(),
  useClientApproveVariation: vi.fn(),
  useRejectVariation: vi.fn(),
  useWithdrawVariation: vi.fn(),
  useRecordAtRiskCommencement: vi.fn(),
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
  createMutate?: ReturnType<typeof vi.fn>;
} = {}) {
  vi.mocked(hooks.useVariations).mockReturnValue({
    isPending: false,
    isError: false,
    data: { contractId: 'c-1', variations: options.variations ?? [listItem()] },
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof hooks.useVariations>);

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

  // At-risk list — only reached via the detail sheet (never opened in these tests), stubbed empty.
  vi.mocked(hooks.useAtRiskCommencements).mockReturnValue({
    isPending: false,
    isError: false,
    data: [],
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof hooks.useAtRiskCommencements>);

  // A bare idle mutation; each mock casts it to its own hook's exact return type.
  const idle = () => ({ mutate: vi.fn(), isPending: false });

  vi.mocked(hooks.useCreateVariation).mockReturnValue({
    mutate: options.createMutate ?? vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof hooks.useCreateVariation>);
  vi.mocked(hooks.useSubmitVariation).mockReturnValue(
    idle() as unknown as ReturnType<typeof hooks.useSubmitVariation>,
  );
  vi.mocked(hooks.useInternalApproveVariation).mockReturnValue(
    idle() as unknown as ReturnType<typeof hooks.useInternalApproveVariation>,
  );
  vi.mocked(hooks.useClientApproveVariation).mockReturnValue(
    idle() as unknown as ReturnType<typeof hooks.useClientApproveVariation>,
  );
  vi.mocked(hooks.useRejectVariation).mockReturnValue(
    idle() as unknown as ReturnType<typeof hooks.useRejectVariation>,
  );
  vi.mocked(hooks.useWithdrawVariation).mockReturnValue(
    idle() as unknown as ReturnType<typeof hooks.useWithdrawVariation>,
  );
  vi.mocked(hooks.useRecordAtRiskCommencement).mockReturnValue(
    idle() as unknown as ReturnType<typeof hooks.useRecordAtRiskCommencement>,
  );
  vi.mocked(hooks.useGrantExtensionOfTime).mockReturnValue(
    idle() as unknown as ReturnType<typeof hooks.useGrantExtensionOfTime>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VariationsTab — the position band renders backend figures only', () => {
  it('reports pending separately from approved and never adds them', () => {
    stubHooks();
    renderWithProviders(<VariationsTab projectId="p-1" summary={summary()} />, {
      permissions: MANAGE,
      withToast: true,
    });

    // CONST-VAR-006a: the two figures are peers, stated apart. Nothing on screen may show
    // approved + pending as a single total — that would be a contract value nobody agreed to.
    expect(screen.getByText('Pending client approval')).toBeInTheDocument();
    expect(screen.getByText('Approved variations')).toBeInTheDocument();
    // `getAllByText` because the approved total also appears as the VO's own net price in the
    // list below — the same figure, correctly, in two places.
    expect(screen.getAllByText(/25,000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/5,000/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/30,000/)).not.toBeInTheDocument();

    // The rule is stated on screen, not left for the reader to infer from the layout.
    expect(
      screen.getByText(/contract value changes only when a variation is client-approved/i),
    ).toBeInTheDocument();
  });

  /**
   * CONST-VAR-011: at-risk work is sanctioned but unapproved. It must be visible as exposure in
   * the band and marked on its own row — never blended into approved scope.
   */
  it('surfaces at-risk exposure in the band and marks the row', () => {
    stubHooks({
      variations: [
        listItem({
          id: 'vo-9',
          reference: 'VO-009',
          title: 'Urgent slab works',
          status: 'INTERNAL_APPROVED',
          atRiskAuthorisationCount: 1,
          atRiskExposure: '20000.00',
        }),
      ],
    });
    renderWithProviders(<VariationsTab projectId="p-1" summary={summary()} />, {
      permissions: MANAGE,
      withToast: true,
    });

    expect(screen.getByText('At-risk exposure')).toBeInTheDocument();
    expect(screen.getByText(/20,000/)).toBeInTheDocument();
    expect(screen.getByText('At risk')).toBeInTheDocument();
    // Internal state and the client's answer stay in different columns.
    expect(screen.getByText('Internally approved')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
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

  it('shows the empty state with a create action when there are no variations', () => {
    stubHooks({ variations: [] });
    renderWithProviders(<VariationsTab projectId="p-1" summary={summary()} />, {
      permissions: MANAGE,
      withToast: true,
    });
    expect(screen.getByText('No variations yet')).toBeInTheDocument();
  });
});

describe('VariationsTab — New variation gated by permission', () => {
  it('offers "New variation" to a user who can manage the contract', () => {
    stubHooks();
    renderWithProviders(<VariationsTab projectId="p-1" summary={summary()} />, {
      permissions: MANAGE,
      withToast: true,
    });
    expect(screen.getAllByRole('button', { name: 'New variation' }).length).toBeGreaterThan(0);
  });

  it('hides "New variation" from a read-only user', () => {
    stubHooks();
    renderWithProviders(<VariationsTab projectId="p-1" summary={summary()} />, {
      permissions: ['view:contract', 'view:financial-position'],
      withToast: true,
    });
    expect(screen.queryByRole('button', { name: 'New variation' })).not.toBeInTheDocument();
  });
});

describe('VariationsTab — create draft flow (additions + omission)', () => {
  it('sends the drafted lines with the omission quantity signed negative', async () => {
    const user = userEvent.setup();
    const createMutate = vi.fn();
    stubHooks({ createMutate });

    renderWithProviders(<VariationsTab projectId="p-1" summary={summary()} />, {
      permissions: MANAGE,
      withToast: true,
    });

    await user.click(screen.getAllByRole('button', { name: 'New variation' })[0]!);

    const dialog = screen.getByRole('dialog');

    // Title (required)
    await user.type(within(dialog).getByLabelText('Title'), 'Scope change');

    // Line 1 — addition (default). Only one line exists at this point.
    await user.type(within(dialog).getByLabelText('Item'), 'Extra works');
    await user.type(within(dialog).getByLabelText('Quantity'), '10');
    await user.type(within(dialog).getByLabelText('Unit rate'), '100');

    // Add a second line; fields are now indexed in DOM order (line 1, line 2).
    await user.click(within(dialog).getByRole('button', { name: 'Add line' }));

    // Line 2 — switch to omission, then fill the newly-added (second) set of inputs.
    const omissionTabs = within(dialog).getAllByRole('tab', { name: 'Omission' });
    await user.click(omissionTabs[1]!);
    await user.type(within(dialog).getAllByLabelText('Item')[1]!, 'Removed fence');
    await user.type(within(dialog).getAllByLabelText('Quantity')[1]!, '5');
    await user.type(within(dialog).getAllByLabelText('Unit rate')[1]!, '40');

    await user.click(within(dialog).getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    const payload = createMutate.mock.calls[0]![0];
    expect(payload.title).toBe('Scope change');
    expect(payload.lines).toEqual([
      { description: 'Extra works', quantity: 10, unitRate: 100 },
      // The omission is signed negative in the payload — the one place the sign is applied.
      { description: 'Removed fence', quantity: -5, unitRate: 40 },
    ]);
  });
});

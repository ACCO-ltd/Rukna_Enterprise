import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  CommercialBillingPackagesResponse,
  CommercialCurrentCycleResponse,
  CommercialPaymentScheduleInstallment,
  CommercialPaymentScheduleVariationLine,
  CommercialSummaryResponse,
  VariationOrderListItem,
  VariationOrderListResponse,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';
import { getInvoiceDocument } from '@/features/accounting/api/invoices-api';
import { ApiError } from '@/lib/api-client';
import * as commercialHooks from '../hooks/use-commercial';
import * as scheduleHooks from '../hooks/use-payment-schedule';
import * as programmeHooks from '@/features/programme/hooks/use-programme';

import { PaymentSchedulePanel } from './payment-schedule-panel';

vi.mock('../hooks/use-commercial', () => ({
  useCommercialCurrentCycle: vi.fn(),
  useVariations: vi.fn(),
  useBillingPackages: vi.fn(),
}));
vi.mock('../hooks/use-payment-schedule', () => ({
  useBillStage: vi.fn(),
  useSetInstallmentMilestone: vi.fn(),
}));
vi.mock('@/features/programme/hooks/use-programme', () => ({
  useMilestones: vi.fn(),
}));
// Successful billing opens the generated document immediately (Commercial round-3) — stub the
// fetch so that path resolves deterministically instead of relying on a real, unmocked apiClient
// call failing at the network layer under jsdom.
vi.mock('@/features/accounting/api/invoices-api', () => ({
  getInvoiceDocument: vi.fn(),
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

function installment(
  overrides: Partial<CommercialPaymentScheduleInstallment> = {},
): CommercialPaymentScheduleInstallment {
  return {
    id: 'inst-1',
    sortOrder: 0,
    name: 'Structure payment',
    percentage: '0.4000',
    amount: '300000.00',
    amountPaid: '0.00',
    triggerType: 'MILESTONE',
    milestoneLabel: null,
    dueOffsetDays: null,
    dueDate: null,
    status: 'UPCOMING',
    programmeMilestone: null,
    ...overrides,
  };
}

/** A UTC calendar date `days` from today — for deterministic due-date cue assertions. */
function isoInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function summary(overrides: Partial<CommercialSummaryResponse> = {}): CommercialSummaryResponse {
  return {
    currency: 'USD',
    financialsVisible: true,
    capabilities: {
      canViewFinancials: true,
      canEditContract: false,
      canAdvanceContract: false,
      canReopenContract: false,
      canCreateApplication: false,
      canManageApplication: false,
      canReviewApplication: false,
      canIssueCertificate: false,
      canGenerateInvoice: true,
      canPostInvoice: false,
      canManageGuarantee: false,
      canRecordReceipt: false,
      canAllocateReceipt: false,
    },
    ...overrides,
  } as unknown as CommercialSummaryResponse;
}

function stubCycle(
  installments: CommercialPaymentScheduleInstallment[],
  variationLines: CommercialPaymentScheduleVariationLine[] = [],
) {
  vi.mocked(commercialHooks.useCommercialCurrentCycle).mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      paymentSchedule: {
        currency: 'USD',
        contractValue: '750000.00',
        totalCollected: '0.00',
        installments,
        variationLines,
      },
    } as unknown as CommercialCurrentCycleResponse,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof commercialHooks.useCommercialCurrentCycle>);
}

function variation(overrides: Partial<VariationOrderListItem> = {}): VariationOrderListItem {
  return {
    id: 'vo-1',
    contractId: 'c-1',
    reference: 'VO-001',
    status: 'CLIENT_APPROVED',
    title: 'Additional foundations',
    description: null,
    proposedTimeImpactDays: null,
    netPrice: '50000.00',
    lineCount: 1,
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

/** Stub the two dialog reads: eligible variations come from the list minus anything already packaged. */
function stubBillStageReads(
  variations: VariationOrderListItem[] = [],
  packages: CommercialBillingPackagesResponse['packages'] = [],
) {
  vi.mocked(commercialHooks.useVariations).mockReturnValue({
    isPending: false,
    isError: false,
    data: { contractId: 'c-1', variations } as VariationOrderListResponse,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof commercialHooks.useVariations>);
  vi.mocked(commercialHooks.useBillingPackages).mockReturnValue({
    isPending: false,
    isError: false,
    data: { contractId: 'c-1', financialsVisible: true, packages },
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof commercialHooks.useBillingPackages>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(programmeHooks.useMilestones).mockReturnValue({
    isPending: false,
    data: [],
  } as unknown as ReturnType<typeof programmeHooks.useMilestones>);
  vi.mocked(scheduleHooks.useBillStage).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof scheduleHooks.useBillStage>);
  vi.mocked(scheduleHooks.useSetInstallmentMilestone).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof scheduleHooks.useSetInstallmentMilestone>);
  vi.mocked(getInvoiceDocument).mockResolvedValue({
    url: 'https://signed.example/invoice.pdf',
    originalName: 'invoice.pdf',
    mimeType: 'application/pdf',
  });
  // jsdom does not implement window.open; the component already tolerates a null return.
  vi.spyOn(window, 'open').mockReturnValue(null);
  // Default: no eligible variations, no prior packages — the dialog degrades to date fields only.
  stubBillStageReads([], []);
});

function renderPanel(
  installments: CommercialPaymentScheduleInstallment[],
  permissions = ['manage:contract'],
) {
  stubCycle(installments);
  return renderWithProviders(
    <PaymentSchedulePanel projectId="p-1" contractId="c-1" summary={summary()} />,
    { permissions },
  );
}

function variationLine(
  overrides: Partial<CommercialPaymentScheduleVariationLine> = {},
): CommercialPaymentScheduleVariationLine {
  return {
    variationId: 'vo-1',
    reference: 'VO-001',
    title: 'Extra lift shaft',
    amount: '2000.00',
    stageInstallmentId: 'inst-1',
    ...overrides,
  };
}

describe('PaymentSchedulePanel — variation nesting (R7)', () => {
  it('nests a billed variation under its stage with a "stage now" subtotal', () => {
    stubCycle(
      [installment({ id: 'inst-1', name: 'Structure payment', amount: '150000.00' })],
      [variationLine({ stageInstallmentId: 'inst-1', amount: '2000.00' })],
    );
    renderWithProviders(
      <PaymentSchedulePanel projectId="p-1" contractId="c-1" summary={summary()} />,
      { permissions: ['manage:contract'] },
    );

    // The variation appears as a nested child line under its stage...
    expect(screen.getByText('VO-001')).toBeInTheDocument();
    expect(screen.getByText('Extra lift shaft')).toBeInTheDocument();
    // ...and the "stage now" subtotal is the frozen 150k plus the 2k addition (visual only).
    expect(screen.getByText('Stage now (incl. variations)')).toBeInTheDocument();
    expect(screen.getByText('$152,000.00')).toBeInTheDocument();
  });

  it('subtracts an omission from its stage subtotal', () => {
    stubCycle(
      [installment({ id: 'inst-1', amount: '150000.00' })],
      [variationLine({ reference: 'VO-002', title: 'Reduced cladding', amount: '-20000.00' })],
    );
    renderWithProviders(
      <PaymentSchedulePanel projectId="p-1" contractId="c-1" summary={summary()} />,
      { permissions: ['manage:contract'] },
    );

    expect(screen.getByText('Omission')).toBeInTheDocument();
    // 150k − 20k = 130k.
    expect(screen.getByText('$130,000.00')).toBeInTheDocument();
  });

  it('lists an approved-but-unbilled variation under "Unassigned variations"', () => {
    stubCycle(
      [installment({ id: 'inst-1', amount: '150000.00' })],
      [variationLine({ variationId: 'vo-9', reference: 'VO-009', stageInstallmentId: null })],
    );
    renderWithProviders(
      <PaymentSchedulePanel projectId="p-1" contractId="c-1" summary={summary()} />,
      { permissions: ['manage:contract'] },
    );

    expect(screen.getByText('Unassigned variations')).toBeInTheDocument();
    expect(screen.getByText('VO-009')).toBeInTheDocument();
    // Nothing is billed on the stage, so there is no stage subtotal.
    expect(screen.queryByText('Stage now (incl. variations)')).not.toBeInTheDocument();
  });
});

describe('PaymentSchedulePanel — MilestoneCell (P2 payment-schedule side)', () => {
  it('renders an ungated pill for an ADVANCE installment instead of a link affordance', () => {
    renderPanel([
      installment({ id: 'adv', name: 'Advance', triggerType: 'ADVANCE', percentage: '0.4000' }),
    ]);

    expect(screen.getByText('Paid on mobilization — no milestone required')).toBeInTheDocument();
    // The ADVANCE row must NOT offer to link a milestone — that would imply a forgotten link.
    expect(screen.queryByRole('button', { name: 'Link milestone' })).not.toBeInTheDocument();
  });

  it('offers the link affordance for an unlinked MILESTONE installment (unchanged)', () => {
    renderPanel([installment({ triggerType: 'MILESTONE', programmeMilestone: null })]);

    expect(screen.getByRole('button', { name: 'Link milestone' })).toBeInTheDocument();
    expect(
      screen.queryByText('Paid on mobilization — no milestone required'),
    ).not.toBeInTheDocument();
  });

  it('shows the milestone code + verification badge for a linked MILESTONE installment (unchanged)', () => {
    renderPanel([
      installment({
        triggerType: 'MILESTONE',
        programmeMilestone: { id: 'ms-1', code: 'MS-01', name: 'Substructure', status: 'VERIFIED' },
      }),
    ]);

    expect(screen.getByText('MS-01')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(
      screen.queryByText('Paid on mobilization — no milestone required'),
    ).not.toBeInTheDocument();
  });

  it('does not turn a TIME_BASED installment into the advance pill', () => {
    renderPanel([installment({ triggerType: 'TIME_BASED', programmeMilestone: null })]);

    expect(
      screen.queryByText('Paid on mobilization — no milestone required'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link milestone' })).toBeInTheDocument();
  });
});

describe('PaymentSchedulePanel — row-level milestone gate (S-PS-1 / CONST-COM-025)', () => {
  it('shows the reason + a working verify link on a NEXT row gated by an unverified milestone', () => {
    renderPanel([
      installment({
        id: 'gated',
        status: 'NEXT',
        triggerType: 'MILESTONE',
        programmeMilestone: { id: 'ms-2', code: 'MS-02', name: 'Partition complete', status: 'PLANNED' },
      }),
    ]);

    // The reason names the gating milestone and links straight into Programme & Progress.
    const verify = screen.getByRole('link', { name: /Verify “Partition complete”/i });
    expect(verify).toHaveAttribute('href', '/projects/p-1/progress');
  });

  it('disables the Generate control on a gated row — never a bare disabled button', () => {
    renderPanel([
      installment({
        id: 'gated',
        status: 'NEXT',
        triggerType: 'MILESTONE',
        programmeMilestone: { id: 'ms-2', code: 'MS-02', name: 'Partition complete', status: 'PLANNED' },
      }),
    ]);

    const generate = screen.getByRole('button', { name: 'Bill this stage' });
    expect(generate).toBeDisabled();
    // The disabled control is not bare: the reason (with its remediation link) sits on the same row.
    expect(screen.getByRole('link', { name: /Verify “Partition complete”/i })).toBeInTheDocument();
  });

  it('leaves a NEXT row whose milestone is VERIFIED fully actionable (no block, no reason)', () => {
    renderPanel([
      installment({
        id: 'clear',
        status: 'NEXT',
        triggerType: 'MILESTONE',
        programmeMilestone: { id: 'ms-1', code: 'MS-01', name: 'Substructure', status: 'VERIFIED' },
      }),
    ]);

    expect(screen.getByRole('button', { name: 'Bill this stage' })).toBeEnabled();
    expect(screen.queryByRole('link', { name: /^Verify/i })).not.toBeInTheDocument();
  });

  it('leaves an unlinked NEXT row unaffected (no milestone to gate on)', () => {
    renderPanel([
      installment({ id: 'unlinked', status: 'NEXT', triggerType: 'MILESTONE', programmeMilestone: null }),
    ]);

    expect(screen.getByRole('button', { name: 'Bill this stage' })).toBeEnabled();
    expect(screen.queryByRole('link', { name: /^Verify/i })).not.toBeInTheDocument();
  });
});

describe('PaymentSchedulePanel — BillStageDialog (S-VB-11)', () => {
  /** A NEXT, ungated installment whose "Bill this stage" button opens the dialog. */
  function nextInstallment() {
    return installment({
      id: 'next',
      name: 'Structure payment',
      status: 'NEXT',
      triggerType: 'MILESTONE',
      amount: '300000.00',
      programmeMilestone: null,
    });
  }

  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Bill this stage' }));
    return within(await screen.findByRole('dialog'));
  }

  it('degrades to just the date fields when the contract has no eligible variations', async () => {
    const user = userEvent.setup();
    stubBillStageReads([], []);
    renderPanel([nextInstallment()]);

    const dialog = await openDialog(user);
    expect(dialog.getByLabelText('Invoice date')).toBeInTheDocument();
    expect(dialog.getByLabelText('Due date')).toBeInTheDocument();
    // No variations section, so no indicative summary either.
    expect(
      dialog.queryByText('Approved variations to bill with this stage'),
    ).not.toBeInTheDocument();
    expect(dialog.queryByText(/indicative/i)).not.toBeInTheDocument();
  });

  it('excludes a variation already allocated on a prior stage from the eligible list', async () => {
    const user = userEvent.setup();
    stubBillStageReads(
      [
        variation({ id: 'vo-1', reference: 'VO-001', title: 'Extra piling' }),
        variation({ id: 'vo-2', reference: 'VO-002', title: 'Already billed' }),
      ],
      // VO-002 appears in a prior package → it is done and must not be offered again.
      [
        {
          installmentId: 'inst-0',
          installmentName: 'Advance',
          milestoneInvoice: null,
          variationLines: [
            {
              variationId: 'vo-2',
              reference: 'VO-002',
              title: 'Already billed',
              allocationAmount: '10000.00',
              treatment: 'INVOICE',
              invoice: null,
            },
          ],
          presentedTotal: null,
        },
      ],
    );
    renderPanel([nextInstallment()]);

    const dialog = await openDialog(user);
    expect(dialog.getByText('VO-001')).toBeInTheDocument();
    expect(dialog.queryByText('VO-002')).not.toBeInTheDocument();
  });

  it('updates the indicative total as a VO is toggled off, and defers it', async () => {
    const user = userEvent.setup();
    stubBillStageReads([variation({ id: 'vo-1', reference: 'VO-001', netPrice: '50000.00' })], []);
    renderPanel([nextInstallment()]);

    const dialog = await openDialog(user);
    // Default INCLUDE: 300,000 stage + 50,000 VO = 350,000.
    expect(dialog.getByText('$350,000.00')).toBeInTheDocument();

    // Toggle the VO off → back to the bare stage amount, and one variation deferred.
    await user.click(dialog.getByRole('checkbox'));
    expect(dialog.getByText('$300,000.00')).toBeInTheDocument();
    expect(dialog.getByText(/1 variation deferred/i)).toBeInTheDocument();
  });

  it('bills the stage with the right per-VO include flags', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn();
    vi.mocked(scheduleHooks.useBillStage).mockReturnValue({
      mutate,
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof scheduleHooks.useBillStage>);
    stubBillStageReads(
      [
        variation({ id: 'vo-1', reference: 'VO-001', netPrice: '50000.00' }),
        variation({ id: 'vo-2', reference: 'VO-002', netPrice: '20000.00' }),
      ],
      [],
    );
    renderPanel([nextInstallment()]);

    const dialog = await openDialog(user);
    // Defer VO-001 (first checkbox), keep VO-002 included.
    await user.click(dialog.getAllByRole('checkbox')[0]!);
    await user.click(dialog.getByRole('button', { name: 'Bill this stage' }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const payload = mutate.mock.calls[0]![0];
    expect(payload.installmentId).toBe('next');
    expect(payload.variations).toEqual([
      { variationId: 'vo-1', include: false },
      { variationId: 'vo-2', include: true },
    ]);
  });

  it('surfaces the already-invoiced 400 message verbatim', async () => {
    const user = userEvent.setup();
    vi.mocked(scheduleHooks.useBillStage).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new ApiError(
        400,
        'This stage is already invoiced — an omission against it requires a credit note.',
      ),
    } as unknown as ReturnType<typeof scheduleHooks.useBillStage>);
    stubBillStageReads([], []);
    renderPanel([nextInstallment()]);

    const dialog = await openDialog(user);
    expect(
      dialog.getByText(
        'This stage is already invoiced — an omission against it requires a credit note.',
      ),
    ).toBeInTheDocument();
  });
});

describe('PaymentSchedulePanel — due-date cue on the row', () => {
  it('shows a "due in Nd" chip on an un-billed stage that is due within the week', () => {
    renderPanel([installment({ status: 'NEXT', programmeMilestone: null, dueDate: isoInDays(3) })]);
    expect(screen.getByText('Due in 3d')).toBeInTheDocument();
  });

  it('shows an overdue chip on an un-billed stage past its due date', () => {
    renderPanel([installment({ status: 'NEXT', programmeMilestone: null, dueDate: isoInDays(-4) })]);
    expect(screen.getByText('Overdue by 4d')).toBeInTheDocument();
  });

  it('shows no due chip once the stage is billed — an overdue date on a paid stage is noise', () => {
    renderPanel([installment({ status: 'BILLED', dueDate: isoInDays(-4) })]);
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
  });

  it('shows no chip for a due date more than a week out (the date column already states it)', () => {
    renderPanel([installment({ status: 'NEXT', programmeMilestone: null, dueDate: isoInDays(20) })]);
    expect(screen.queryByText(/Due in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
  });
});

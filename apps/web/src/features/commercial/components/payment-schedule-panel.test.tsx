import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type {
  CommercialCurrentCycleResponse,
  CommercialPaymentScheduleInstallment,
  CommercialSummaryResponse,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';
import * as commercialHooks from '../hooks/use-commercial';
import * as scheduleHooks from '../hooks/use-payment-schedule';
import * as programmeHooks from '@/features/programme/hooks/use-programme';

import { PaymentSchedulePanel } from './payment-schedule-panel';

vi.mock('../hooks/use-commercial', () => ({
  useCommercialCurrentCycle: vi.fn(),
}));
vi.mock('../hooks/use-payment-schedule', () => ({
  useGenerateInvoiceFromInstallment: vi.fn(),
  useSetInstallmentMilestone: vi.fn(),
}));
vi.mock('@/features/programme/hooks/use-programme', () => ({
  useMilestones: vi.fn(),
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

function summary(overrides: Partial<CommercialSummaryResponse> = {}): CommercialSummaryResponse {
  return {
    currency: 'USD',
    financialsVisible: true,
    capabilities: {
      canViewFinancials: true,
      canEditContract: false,
      canAdvanceContract: false,
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

function stubCycle(installments: CommercialPaymentScheduleInstallment[]) {
  vi.mocked(commercialHooks.useCommercialCurrentCycle).mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      paymentSchedule: {
        currency: 'USD',
        contractValue: '750000.00',
        totalCollected: '0.00',
        installments,
      },
    } as unknown as CommercialCurrentCycleResponse,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof commercialHooks.useCommercialCurrentCycle>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(programmeHooks.useMilestones).mockReturnValue({
    isPending: false,
    data: [],
  } as unknown as ReturnType<typeof programmeHooks.useMilestones>);
  vi.mocked(scheduleHooks.useGenerateInvoiceFromInstallment).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof scheduleHooks.useGenerateInvoiceFromInstallment>);
  vi.mocked(scheduleHooks.useSetInstallmentMilestone).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof scheduleHooks.useSetInstallmentMilestone>);
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

    const generate = screen.getByRole('button', { name: 'Generate invoice' });
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

    expect(screen.getByRole('button', { name: 'Generate invoice' })).toBeEnabled();
    expect(screen.queryByRole('link', { name: /^Verify/i })).not.toBeInTheDocument();
  });

  it('leaves an unlinked NEXT row unaffected (no milestone to gate on)', () => {
    renderPanel([
      installment({ id: 'unlinked', status: 'NEXT', triggerType: 'MILESTONE', programmeMilestone: null }),
    ]);

    expect(screen.getByRole('button', { name: 'Generate invoice' })).toBeEnabled();
    expect(screen.queryByRole('link', { name: /^Verify/i })).not.toBeInTheDocument();
  });
});

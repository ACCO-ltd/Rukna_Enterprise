import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  CommercialCurrentCycleResponse,
  CommercialPaymentScheduleInstallment,
  CommercialSummaryResponse,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';
import * as commercialHooks from '../hooks/use-commercial';

import { PaymentScheduleTab } from './payment-schedule-tab';

// The reused ledger panel drags in the programme + payment-schedule mutation graph; the tab's own
// behaviour (summary strip, reconcile footer, editor gating) is what these tests cover, so the panel
// is stubbed to a marker. Its own behaviour is tested in payment-schedule-panel.test.tsx.
vi.mock('./payment-schedule-panel', () => ({
  PaymentSchedulePanel: () => <div data-testid="schedule-panel" />,
}));

vi.mock('../hooks/use-commercial', () => ({
  useCommercialCurrentCycle: vi.fn(),
}));

const replaceMutate = vi.fn();
vi.mock('../hooks/use-replace-payment-plan', () => ({
  useReplacePaymentPlan: () => ({ mutate: replaceMutate, isPending: false, isError: false, error: null }),
}));

function installment(
  overrides: Partial<CommercialPaymentScheduleInstallment> = {},
): CommercialPaymentScheduleInstallment {
  return {
    id: 'inst-1',
    sortOrder: 0,
    name: 'Structure',
    percentage: '0.4000',
    amount: '300000.00',
    amountPaid: '0.00',
    triggerType: 'ADVANCE',
    milestoneLabel: null,
    dueOffsetDays: null,
    dueDate: null,
    status: 'NEXT',
    programmeMilestone: null,
    ...overrides,
  };
}

function summary(
  overrides: Partial<CommercialSummaryResponse> = {},
  contract: Partial<CommercialSummaryResponse['mainContract']> = {},
): CommercialSummaryResponse {
  return {
    projectId: 'p-1',
    currency: 'USD',
    financialsVisible: true,
    contractValue: {
      originalContractValue: '750000.00',
      approvedVariationsTotal: null,
      governingContractValue: '750000.00',
      pendingVariations: null,
    },
    mainContract: {
      id: 'c-1',
      contractNumber: 'CT-001',
      status: 'DRAFT',
      clientName: 'Acme',
      startDate: null,
      expectedEndDate: null,
      contractValue: '750000.00',
      currency: 'USD',
      billingModel: 'MILESTONE',
      boqVersionNumber: 1,
      ...contract,
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
});

describe('PaymentScheduleTab — a MILESTONE contract lands on its schedule (§4.1/§5 P2)', () => {
  it('renders the summary strip and the reused ledger panel', () => {
    stubCycle([
      installment({ id: 'a', percentage: '0.4000' }),
      installment({ id: 'b', percentage: '0.3000', triggerType: 'MILESTONE' }),
      installment({ id: 'c', percentage: '0.2000', triggerType: 'MILESTONE' }),
      installment({ id: 'd', percentage: '0.1000', triggerType: 'MILESTONE' }),
    ]);
    renderWithProviders(<PaymentScheduleTab projectId="p-1" summary={summary()} />, {
      permissions: ['manage:contract'],
    });

    // Summary strip heading and the reconciled 100% total.
    expect(screen.getByRole('heading', { name: 'Payment schedule' })).toBeInTheDocument();
    expect(screen.getByText('Plan total')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    // The ledger is mounted (behaviour tested in its own spec).
    expect(screen.getByTestId('schedule-panel')).toBeInTheDocument();
  });

  it('degrades to a no-contract empty state on a force-navigation with no contract', () => {
    stubCycle([]);
    renderWithProviders(
      <PaymentScheduleTab projectId="p-1" summary={summary({ mainContract: null })} />,
      { permissions: ['manage:contract'] },
    );

    expect(screen.queryByRole('heading', { name: 'Payment schedule' })).not.toBeInTheDocument();
  });
});

describe('PaymentScheduleTab — reconcile footer (§5 P2)', () => {
  it('flags a plan that does not total 100%', () => {
    // 40% + 30% = 70% — the server would refuse it; a legacy plan predates that rule, so surface it.
    stubCycle([
      installment({ id: 'a', percentage: '0.4000' }),
      installment({ id: 'b', percentage: '0.3000', triggerType: 'MILESTONE' }),
    ]);
    renderWithProviders(<PaymentScheduleTab projectId="p-1" summary={summary()} />, {
      permissions: ['manage:contract'],
    });

    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(
      screen.getByText(/does not total 100%/i),
    ).toBeInTheDocument();
  });

  it('does not flag a plan that totals exactly 100%', () => {
    stubCycle([
      installment({ id: 'a', percentage: '0.4000' }),
      installment({ id: 'b', percentage: '0.3000', triggerType: 'MILESTONE' }),
      installment({ id: 'c', percentage: '0.2000', triggerType: 'MILESTONE' }),
      installment({ id: 'd', percentage: '0.1000', triggerType: 'MILESTONE' }),
    ]);
    renderWithProviders(<PaymentScheduleTab projectId="p-1" summary={summary()} />, {
      permissions: ['manage:contract'],
    });

    expect(screen.queryByText(/does not total 100%/i)).not.toBeInTheDocument();
  });
});

describe('PaymentScheduleTab — editor gating (DRAFT vs committed, §5 P2)', () => {
  it('offers the editor on a DRAFT contract with manage permission', () => {
    stubCycle([installment()]);
    renderWithProviders(
      <PaymentScheduleTab projectId="p-1" summary={summary({}, { status: 'DRAFT' })} />,
      { permissions: ['manage:contract'] },
    );

    expect(screen.getByRole('button', { name: 'Edit schedule' })).toBeInTheDocument();
    expect(screen.queryByText(/Re-profile a committed schedule through a Variation/i)).not.toBeInTheDocument();
  });

  it('shows the read-only Variation note (no editor) on a committed contract', () => {
    stubCycle([installment()]);
    renderWithProviders(
      <PaymentScheduleTab projectId="p-1" summary={summary({}, { status: 'ACTIVE' })} />,
      { permissions: ['manage:contract'] },
    );

    expect(
      screen.getByText(/Re-profile a committed schedule through a Variation/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit schedule' })).not.toBeInTheDocument();
  });

  it('shows a no-permission note instead of the editor when the user cannot manage the contract', () => {
    stubCycle([installment()]);
    renderWithProviders(
      <PaymentScheduleTab projectId="p-1" summary={summary({}, { status: 'DRAFT' })} />,
      { permissions: ['view:contract'] },
    );

    expect(
      screen.getByText(/do not have permission to edit this contract's payment schedule/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit schedule' })).not.toBeInTheDocument();
  });
});

describe('PaymentScheduleTab — ACCO standard template quick-fill (§4.2/§5 P2)', () => {
  it('populates the four ACCO rows and reconciles the editor to 100%', async () => {
    const user = userEvent.setup();
    stubCycle([installment()]);
    renderWithProviders(
      <PaymentScheduleTab projectId="p-1" summary={summary({}, { status: 'DRAFT' })} />,
      { permissions: ['manage:contract'] },
    );

    await user.click(screen.getByRole('button', { name: 'Edit schedule' }));
    await user.click(screen.getByRole('button', { name: 'Use ACCO standard schedule' }));

    // The four house-standard stages, seeded verbatim.
    for (const name of ['Structure', 'Partition & Plastering', 'Installation & Paint', 'Inspection & Handover']) {
      expect(screen.getByDisplayValue(name)).toBeInTheDocument();
    }
    for (const pct of ['40', '30', '20', '10']) {
      expect(screen.getByDisplayValue(pct)).toBeInTheDocument();
    }

    // The editor's live reconciliation reads 100% (the balanced affordance), not a mismatch.
    expect(screen.getByText('Totals 100%')).toBeInTheDocument();
  });

  it('saves the ACCO template through the replace-all route', async () => {
    const user = userEvent.setup();
    stubCycle([installment()]);
    renderWithProviders(
      <PaymentScheduleTab projectId="p-1" summary={summary({}, { status: 'DRAFT' })} />,
      { permissions: ['manage:contract'], withToast: true },
    );

    await user.click(screen.getByRole('button', { name: 'Edit schedule' }));
    await user.click(screen.getByRole('button', { name: 'Use ACCO standard schedule' }));
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));

    expect(replaceMutate).toHaveBeenCalledTimes(1);
    const [installments] = replaceMutate.mock.calls[0]!;
    // Four installments, fractions summing to 1, ADVANCE first (Structure 40%).
    expect(installments).toHaveLength(4);
    expect(installments[0]).toMatchObject({ name: 'Structure', percentage: 0.4, triggerType: 'ADVANCE' });
    const total = (installments as Array<{ percentage: number }>).reduce((s, r) => s + r.percentage, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});

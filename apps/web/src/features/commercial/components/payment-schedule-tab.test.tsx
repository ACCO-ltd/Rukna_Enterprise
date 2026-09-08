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

import {
  PaymentScheduleTab,
  frozenPercentTotal,
  splitScheduleForEditing,
} from './payment-schedule-tab';

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

  it('offers the editor on an ACTIVE contract (Q-B re-profile of the un-invoiced tail)', () => {
    // ACTIVE now gets an editor (invoiced stages frozen, un-invoiced tail editable), not a read-only
    // note. The "whole thing is fixed, use a Variation" note is reserved for terminal/locked contracts.
    stubCycle([installment({ status: 'NEXT' })]);
    renderWithProviders(
      <PaymentScheduleTab projectId="p-1" summary={summary({}, { status: 'ACTIVE' })} />,
      { permissions: ['manage:contract'] },
    );

    expect(screen.getByRole('button', { name: 'Edit schedule' })).toBeInTheDocument();
    expect(
      screen.queryByText(/Re-profile a committed schedule through a Variation/i),
    ).not.toBeInTheDocument();
  });

  it('shows the read-only Variation note (no editor) on a terminal / locked contract', () => {
    stubCycle([installment()]);
    renderWithProviders(
      <PaymentScheduleTab projectId="p-1" summary={summary({}, { status: 'CLOSED' })} />,
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

// ─── Q-B: split frozen (invoiced) from editable (un-invoiced) + the reconcile math ─────────────

describe('splitScheduleForEditing / frozenPercentTotal (Q-B)', () => {
  it('sorts frozen (invoiced) from editable (un-invoiced) by bill status and sums the frozen %', () => {
    const paid = installment({ id: '1', sortOrder: 1, status: 'PAID', percentage: '0.4000' });
    const billed = installment({ id: '2', sortOrder: 2, status: 'BILLED', percentage: '0.3000' });
    const next = installment({ id: '3', sortOrder: 3, status: 'NEXT', percentage: '0.2000' });
    const upcoming = installment({ id: '4', sortOrder: 4, status: 'UPCOMING', percentage: '0.1000' });

    // Pass out of order to prove it re-sorts by sortOrder.
    const { frozen, editable } = splitScheduleForEditing([upcoming, paid, next, billed]);

    expect(frozen.map((i) => i.status)).toEqual(['PAID', 'BILLED']);
    expect(editable.map((i) => i.status)).toEqual(['NEXT', 'UPCOMING']);
    // 40% + 30% invoiced → frozen total 70%, so the editable tail must total 30%.
    expect(frozenPercentTotal(frozen)).toBe(70);
  });

  it('reports 0 frozen for an all-un-invoiced (DRAFT-shaped) plan', () => {
    const { frozen, editable } = splitScheduleForEditing([
      installment({ id: '1', status: 'NEXT' }),
      installment({ id: '2', status: 'UPCOMING' }),
    ]);
    expect(frozen).toHaveLength(0);
    expect(editable).toHaveLength(2);
    expect(frozenPercentTotal(frozen)).toBe(0);
  });
});

// ─── ACTIVE re-profile editor (Q-B) ────────────────────────────────────────────────────────────

describe('PaymentScheduleTab — ACTIVE re-profile editor (Q-B)', () => {
  // 40% invoiced (PAID advance) + 30% invoiced (BILLED) = 70% frozen; 20% + 10% un-invoiced = the
  // 30% editable tail.
  const activeInstallments = () => [
    installment({ id: 'a', sortOrder: 1, name: 'Advance', status: 'PAID', percentage: '0.4000', triggerType: 'ADVANCE' }),
    installment({ id: 'b', sortOrder: 2, name: 'Structure', status: 'BILLED', percentage: '0.3000', triggerType: 'MILESTONE' }),
    installment({ id: 'c', sortOrder: 3, name: 'Fit-out', status: 'NEXT', percentage: '0.2000', triggerType: 'MILESTONE' }),
    installment({ id: 'd', sortOrder: 4, name: 'Handover', status: 'UPCOMING', percentage: '0.1000', triggerType: 'MILESTONE' }),
  ];

  it('shows invoiced stages as locked read-only rows and un-invoiced stages pre-populated as a form', async () => {
    const user = userEvent.setup();
    stubCycle(activeInstallments());
    renderWithProviders(
      <PaymentScheduleTab projectId="p-1" summary={summary({}, { status: 'ACTIVE' })} />,
      { permissions: ['manage:contract'] },
    );

    await user.click(screen.getByRole('button', { name: 'Edit schedule' }));

    // The two invoiced stages render locked — a "Locked" marker each, plus a status badge.
    expect(screen.getAllByText('Locked')).toHaveLength(2);
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Invoiced')).toBeInTheDocument();

    // Only the two un-invoiced stages are editable inputs, pre-populated from the current plan.
    const nameInputs = screen.getAllByLabelText('Installment');
    expect(nameInputs.map((n) => (n as HTMLInputElement).value)).toEqual(['Fit-out', 'Handover']);

    // Percentages arrive as 0..1 fractions and pre-populate as whole percents.
    const percentInputs = screen.getAllByLabelText('Percent (%)');
    expect(percentInputs.map((p) => (p as HTMLInputElement).value)).toEqual(['20', '10']);
  });

  it('requires the editable rows to total 100 − frozen% (30) and flags a mismatch against that target', async () => {
    const user = userEvent.setup();
    stubCycle(activeInstallments());
    renderWithProviders(
      <PaymentScheduleTab projectId="p-1" summary={summary({}, { status: 'ACTIVE' })} />,
      { permissions: ['manage:contract'] },
    );

    await user.click(screen.getByRole('button', { name: 'Edit schedule' }));

    // The pre-populated 20 + 10 already reconciles to the 30% remainder.
    expect(screen.getByText('Totals 30%')).toBeInTheDocument();

    // Push a row off target → the live footer measures against 30, not 100.
    const percentInputs = screen.getAllByLabelText('Percent (%)');
    await user.clear(percentInputs[0]!);
    await user.type(percentInputs[0]!, '25');
    expect(await screen.findByText(/must equal 30%/i)).toBeInTheDocument();
  });

  it('submits ONLY the editable un-invoiced rows on save (the server keeps the frozen ones)', async () => {
    const user = userEvent.setup();
    stubCycle(activeInstallments());
    renderWithProviders(
      <PaymentScheduleTab projectId="p-1" summary={summary({}, { status: 'ACTIVE' })} />,
      { permissions: ['manage:contract'], withToast: true },
    );

    await user.click(screen.getByRole('button', { name: 'Edit schedule' }));
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));

    expect(replaceMutate).toHaveBeenCalledTimes(1);
    const [installments] = replaceMutate.mock.calls[0]!;
    const rows = installments as Array<{ name: string; percentage: number }>;
    // Only the two un-invoiced stages; the frozen 70% is never resubmitted.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name)).toEqual(['Fit-out', 'Handover']);
    // Fractions on the wire: 0.2 + 0.1 = 0.3 = the 30% remainder.
    expect(rows.map((r) => r.percentage)).toEqual([0.2, 0.1]);
  });
});

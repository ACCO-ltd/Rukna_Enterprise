import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';

import {
  toMilestoneJourneyViewModel,
  type MilestoneItemViewModel,
  type MilestoneJourneyViewModel,
} from '../milestone-journey.adapter';
import { MilestoneJourney } from './milestone-journey';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeSchedule(
  installments: Parameters<typeof makeInstallment>[0][] = [],
  variationLines: {
    variationId?: string;
    reference?: string;
    title?: string;
    amount?: string | null;
    stageInstallmentId?: string | null;
  }[] = [],
) {
  return {
    currency: 'USD',
    contractValue: '500000.00',
    totalCollected: null,
    installments: installments.map(makeInstallment),
    variationLines: variationLines.map((l) => ({
      variationId: l.variationId ?? 'vo-1',
      reference: l.reference ?? 'VO-001',
      title: l.title ?? 'Boundary Wall',
      amount: l.amount ?? '2000.00',
      stageInstallmentId: l.stageInstallmentId ?? null,
    })),
  };
}

function makeInstallment(opts: {
  id?: string;
  sortOrder?: number;
  name?: string;
  percentage?: string;
  amount?: string | null;
  amountPaid?: string | null;
  triggerType?: string;
  milestoneLabel?: string | null;
  dueOffsetDays?: number | null;
  dueDate?: string | null;
  status?: string;
  programmeMilestone?: {
    id?: string;
    code?: string;
    name?: string;
    status?: string;
  } | null;
}) {
  return {
    id: opts.id ?? 'inst-1',
    sortOrder: opts.sortOrder ?? 1,
    name: opts.name ?? 'Structure',
    percentage: opts.percentage ?? '0.4000',
    amount: opts.amount ?? '200000.00',
    amountPaid: opts.amountPaid ?? null,
    triggerType: opts.triggerType ?? 'MILESTONE',
    milestoneLabel: opts.milestoneLabel ?? null,
    dueOffsetDays: opts.dueOffsetDays ?? null,
    dueDate: opts.dueDate ?? null,
    status: opts.status ?? 'UPCOMING',
    programmeMilestone: opts.programmeMilestone !== undefined
      ? opts.programmeMilestone === null
        ? null
        : {
            id: opts.programmeMilestone.id ?? 'm-1',
            code: opts.programmeMilestone.code ?? 'M-001',
            name: opts.programmeMilestone.name ?? 'Foundation',
            status: opts.programmeMilestone.status ?? 'PLANNED',
          }
      : null,
  };
}

// ─── A. Adapter unit tests (pure, no render) ──────────────────────────────────

describe('toMilestoneJourneyViewModel — state composition', () => {
  it('base amount = percentage × schedule.contractValue, not governing', () => {
    const schedule = makeSchedule([
      { id: 'inst-1', percentage: '0.4000', status: 'NEXT', sortOrder: 1 },
    ]);
    const vm = toMilestoneJourneyViewModel(schedule as never, true);
    // 40% × 500,000 = 200,000
    expect(vm.milestones[0]!.baseAmount).toBe('200000.00');
  });

  it('NEXT + VERIFIED milestone → review-for-billing, never ready-to-bill', () => {
    const schedule = makeSchedule([
      {
        id: 'inst-1',
        status: 'NEXT',
        sortOrder: 1,
        programmeMilestone: { status: 'VERIFIED' },
      },
    ]);
    const vm = toMilestoneJourneyViewModel(schedule as never, true);
    expect(vm.milestones[0]!.userState).toBe('review-for-billing');
    expect(vm.milestones[0]!.readyToBill).toBe(false);
  });

  it('NEXT + PLANNED milestone → in-progress', () => {
    const schedule = makeSchedule([
      {
        id: 'inst-1',
        status: 'NEXT',
        sortOrder: 1,
        programmeMilestone: { status: 'PLANNED' },
      },
    ]);
    const vm = toMilestoneJourneyViewModel(schedule as never, true);
    expect(vm.milestones[0]!.userState).toBe('in-progress');
  });

  it('NEXT + no milestone → in-progress', () => {
    const schedule = makeSchedule([
      { id: 'inst-1', status: 'NEXT', sortOrder: 1, programmeMilestone: null },
    ]);
    const vm = toMilestoneJourneyViewModel(schedule as never, true);
    expect(vm.milestones[0]!.userState).toBe('in-progress');
  });

  it('BILLED installment attaches its variation lines, amounts NOT in baseAmount', () => {
    const schedule = makeSchedule(
      [{ id: 'inst-1', status: 'BILLED', sortOrder: 1 }],
      [{ variationId: 'vo-1', reference: 'VO-001', title: 'Wall', amount: '2000.00', stageInstallmentId: 'inst-1' }],
    );
    const vm = toMilestoneJourneyViewModel(schedule as never, true);
    expect(vm.milestones[0]!.baseAmount).toBe('200000.00'); // unchanged
    expect(vm.milestones[0]!.variationAllocations).toHaveLength(1);
    expect(vm.milestones[0]!.variationAllocations[0]!.amount).toBe('2000.00');
  });

  it('UPCOMING installment has no variation allocations', () => {
    const schedule = makeSchedule(
      [
        { id: 'inst-1', status: 'NEXT', sortOrder: 1 },
        { id: 'inst-2', status: 'UPCOMING', sortOrder: 2 },
      ],
      [{ variationId: 'vo-1', stageInstallmentId: 'inst-2' }],
    );
    const vm = toMilestoneJourneyViewModel(schedule as never, true);
    expect(vm.milestones[1]!.variationAllocations).toHaveLength(0);
  });

  it('unassigned VOs (stageInstallmentId null) appear on NEXT, not UPCOMING', () => {
    const schedule = makeSchedule(
      [
        { id: 'inst-1', status: 'NEXT', sortOrder: 1 },
        { id: 'inst-2', status: 'UPCOMING', sortOrder: 2 },
      ],
      [{ variationId: 'vo-1', stageInstallmentId: null }],
    );
    const vm = toMilestoneJourneyViewModel(schedule as never, true);
    expect(vm.milestones[0]!.variationAllocations).toHaveLength(1); // NEXT gets it
    expect(vm.milestones[1]!.variationAllocations).toHaveLength(0); // UPCOMING does not
  });

  it('dateLabel is "expected" for NEXT installment with dueDate', () => {
    const schedule = makeSchedule([
      { id: 'inst-1', status: 'NEXT', sortOrder: 1, dueDate: '2026-09-30' },
    ]);
    const vm = toMilestoneJourneyViewModel(schedule as never, true);
    expect(vm.milestones[0]!.dateLabel).toBe('expected');
    expect(vm.milestones[0]!.expectedDate).toBe('2026-09-30');
  });

  it('dateLabel is null when no dueDate', () => {
    const schedule = makeSchedule([
      { id: 'inst-1', status: 'NEXT', sortOrder: 1, dueDate: null },
    ]);
    const vm = toMilestoneJourneyViewModel(schedule as never, true);
    expect(vm.milestones[0]!.dateLabel).toBe(null);
  });

  it('dateLabel is "due" for a BILLED installment', () => {
    const schedule = makeSchedule([
      { id: 'inst-1', status: 'BILLED', sortOrder: 1, dueDate: '2026-09-30' },
    ]);
    const vm = toMilestoneJourneyViewModel(schedule as never, true);
    expect(vm.milestones[0]!.dateLabel).toBe('due');
  });

  it('approvedVariationsTotal = sum of all variation line amounts', () => {
    const schedule = makeSchedule(
      [{ id: 'inst-1', status: 'NEXT', sortOrder: 1 }],
      [
        { variationId: 'vo-1', amount: '2000.00', stageInstallmentId: null },
        { variationId: 'vo-2', amount: '1000.00', stageInstallmentId: null },
      ],
    );
    const vm = toMilestoneJourneyViewModel(schedule as never, true);
    expect(vm.approvedVariationsTotal).toBe('3000.00');
  });

  it('approvedVariationsTotal is null when !financialsVisible', () => {
    const schedule = makeSchedule(
      [{ id: 'inst-1', status: 'NEXT', sortOrder: 1 }],
      [{ variationId: 'vo-1', amount: '2000.00' }],
    );
    const vm = toMilestoneJourneyViewModel(schedule as never, false);
    expect(vm.approvedVariationsTotal).toBe(null);
    expect(vm.milestones[0]!.baseAmount).toBe(null);
  });
});

// ─── B. MilestoneJourney render tests ────────────────────────────────────────

function renderJourney(
  milestones: Partial<MilestoneItemViewModel>[] = [],
  opts?: {
    financialsVisible?: boolean;
    onSendInvoice?: (milestone: MilestoneItemViewModel) => void;
  },
) {
  const vm: MilestoneJourneyViewModel = {
    currency: 'USD',
    originalContractValue: '500000.00',
    approvedVariationsTotal: null,
    governingContractValue: null,
    financialsVisible: opts?.financialsVisible ?? true,
    currentIndex: milestones.findIndex((m) => m.userState === 'in-progress' || m.userState === 'review-for-billing'),
    milestones: milestones.map(
      (m, i) =>
        ({
          id: `inst-${i + 1}`,
          sortOrder: i + 1,
          name: m.name ?? `Stage ${i + 1}`,
          percentage: m.percentage ?? '0.2500',
          baseAmount: m.baseAmount ?? '125000.00',
          triggerType: m.triggerType ?? 'MILESTONE',
          userState: m.userState ?? 'upcoming',
          expectedDate: m.expectedDate ?? null,
          dateLabel: m.dateLabel ?? null,
          programmeMilestone: m.programmeMilestone ?? null,
          variationAllocations: m.variationAllocations ?? [],
          readyToBill: m.readyToBill ?? false,
          invoiceReference: m.invoiceReference ?? null,
          invoiceJourney: m.invoiceJourney ?? null,
        }) satisfies MilestoneItemViewModel,
    ),
  };
  return renderWithProviders(
    <MilestoneJourney
      viewModel={vm}
      onMilestoneClick={vi.fn()}
      onReviewForBilling={vi.fn()}
      onPrepareInvoice={vi.fn()}
      onSendInvoice={opts?.onSendInvoice ?? vi.fn()}
    />,
  );
}

describe('MilestoneJourney — rendering', () => {
  it('current (in-progress) milestone has data-current attribute', () => {
    renderJourney([
      { userState: 'paid', name: 'Mobilisation' },
      { userState: 'in-progress', name: 'Structure' },
      { userState: 'upcoming', name: 'Partition' },
    ]);
    const items = document.querySelectorAll('[data-current]');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('Structure');
  });

  it('paid milestone has data-done attribute', () => {
    renderJourney([{ userState: 'paid', name: 'Mobilisation' }]);
    expect(document.querySelector('[data-done]')).toBeTruthy();
  });

  it('review-for-billing state renders "Review for billing" button, not "Ready to bill"', () => {
    renderJourney([{ userState: 'review-for-billing', name: 'Stage 2' }]);
    expect(screen.getByRole('button', { name: /review for billing/i })).toBeInTheDocument();
    expect(screen.queryByText(/ready to bill/i)).not.toBeInTheDocument();
  });

  it('ready-to-bill state (mock) renders "Ready to bill" indicator and note', () => {
    renderJourney([{ userState: 'ready-to-bill', name: 'Stage 2' }]);
    // Both the state badge and the CTA badge show "Ready to bill"
    expect(screen.getAllByText(/ready to bill/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/milestone cleared.*prepare the invoice/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /review for billing/i })).not.toBeInTheDocument();
  });

  it('routes an issued invoice to the send step instead of preparing it again', async () => {
    const user = userEvent.setup();
    const onSendInvoice = vi.fn();
    renderJourney(
      [{ userState: 'invoice-issued', name: 'Stage 2' }],
      { onSendInvoice },
    );

    await user.click(screen.getByRole('button', { name: /send to client/i }));

    expect(onSendInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inst-1', userState: 'invoice-issued' }),
    );
  });

  it('contains no "Bill Stage" text anywhere', () => {
    renderJourney([{ userState: 'in-progress', name: 'Stage 1' }]);
    expect(screen.queryByText(/bill stage/i)).not.toBeInTheDocument();
  });

  it('upcoming milestone shows "Upcoming" state label', () => {
    renderJourney([{ userState: 'upcoming', name: 'Inspection' }]);
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
  });

  it('shows base amount and VO on separate lines (not merged)', () => {
    renderJourney([
      {
        userState: 'review-for-billing',
        name: 'Stage 2',
        baseAmount: '150000.00',
        variationAllocations: [
          {
            variationId: 'vo-1',
            reference: 'VO-001',
            title: 'Boundary Wall',
            amount: '2000.00',
            isOmission: false,
          },
        ],
      },
    ]);
    // "Base amount" label must be present
    expect(screen.getByText('Base amount')).toBeInTheDocument();
    // VO reference must be present as a separate element
    expect(screen.getByText('VO-001')).toBeInTheDocument();
  });

  it('shows "Expected" date label for non-billed milestones, never "Due"', () => {
    renderJourney([
      {
        userState: 'in-progress',
        name: 'Stage 1',
        expectedDate: '2026-09-30',
        dateLabel: 'expected',
      },
    ]);
    expect(screen.getByText(/expected/i)).toBeInTheDocument();
    // "Due" should not appear as a date prefix
    expect(screen.queryByText(/^Due/)).not.toBeInTheDocument();
  });

  it('empty milestones renders empty state, not a crash', () => {
    renderJourney([]);
    expect(screen.getByText(/no milestones set/i)).toBeInTheDocument();
  });
});

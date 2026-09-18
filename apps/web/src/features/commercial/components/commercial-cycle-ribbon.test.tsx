import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type {
  CommercialCurrentCycleResponse,
  CommercialCycleBlocker,
  CommercialPaymentScheduleInstallment,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';
import * as commercialHooks from '../hooks/use-commercial';

import { CommercialCycleRibbon } from './commercial-cycle-ribbon';

vi.mock('../hooks/use-commercial', () => ({
  useCommercialCurrentCycle: vi.fn(),
}));

function installment(
  overrides: Partial<CommercialPaymentScheduleInstallment> = {},
): CommercialPaymentScheduleInstallment {
  return {
    id: 'inst-1',
    sortOrder: 0,
    name: 'Structural frame',
    percentage: '0.4000',
    amount: '300000.00',
    amountPaid: '0.00',
    triggerType: 'MILESTONE',
    milestoneLabel: null,
    dueOffsetDays: null,
    dueDate: null,
    status: 'UPCOMING',
    programmeMilestone: null,
    readyToBill: false,
    readyToBillAt: null,
    canMarkReadyToBill: false,
    canPrepareInvoice: false,
    ...overrides,
  };
}

/** A UTC calendar date `days` from today — for deterministic due-date cue assertions. */
function isoInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** A resolved (loaded, not-error) cycle query the ribbon reads. */
function stubCycle(cycle: Partial<CommercialCurrentCycleResponse>) {
  vi.mocked(commercialHooks.useCommercialCurrentCycle).mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      projectId: 'p-1',
      contract: null,
      stage: 'MILESTONE_SCHEDULE',
      application: null,
      paymentSchedule: null,
      nextAction: null,
      blockers: [],
      capabilities: {},
      responsibleRole: null,
      asOf: '2026-09-15',
      ...cycle,
    } as unknown as CommercialCurrentCycleResponse,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof commercialHooks.useCommercialCurrentCycle>);
}

function stubLoading() {
  vi.mocked(commercialHooks.useCommercialCurrentCycle).mockReturnValue({
    isPending: true,
    isError: false,
    data: undefined,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof commercialHooks.useCommercialCurrentCycle>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CommercialCycleRibbon — stage label (S-SH-2)', () => {
  it('renders a plain-language stage label for a non-milestone stage', () => {
    stubCycle({
      stage: 'AWAITING_CERTIFICATION',
      nextAction: null,
    });
    renderWithProviders(<CommercialCycleRibbon projectId="p-1" />);

    // The ribbon reuses the existing stageTitle vocabulary.
    expect(screen.getByText('Awaiting certification')).toBeInTheDocument();
  });

  it('enriches a MILESTONE stage with "Milestone N of M · name" from the NEXT installment', () => {
    stubCycle({
      stage: 'MILESTONE_SCHEDULE',
      nextAction: { kind: 'GENERATE_INVOICE', href: '/projects/p-1/commercial/payment-schedule' },
      paymentSchedule: {
        currency: 'USD',
        contractValue: '750000.00',
        totalCollected: '0.00',
        variationLines: [],
        installments: [
          installment({ id: 'a', status: 'PAID', name: 'Advance' }),
          installment({ id: 'b', status: 'NEXT', name: 'Partition & Plastering' }),
          installment({ id: 'c', status: 'UPCOMING', name: 'Installation & Paint' }),
        ],
      },
    } as Partial<CommercialCurrentCycleResponse>);
    renderWithProviders(<CommercialCycleRibbon projectId="p-1" />);

    // NEXT is the 2nd of 3 installments — position and name are surfaced.
    expect(screen.getByText('Milestone 2 of 3 · Partition & Plastering')).toBeInTheDocument();
  });
});

describe('CommercialCycleRibbon — MILESTONE_NOT_VERIFIED blocker (CONST-COM-025)', () => {
  function stubBlocked() {
    stubCycle({
      stage: 'MILESTONE_SCHEDULE',
      // The backend withholds the action while the gate is unmet.
      nextAction: null,
      blockers: ['MILESTONE_NOT_VERIFIED'] as CommercialCycleBlocker[],
      paymentSchedule: {
        currency: 'USD',
        contractValue: '750000.00',
        totalCollected: '0.00',
        variationLines: [],
        installments: [
          installment({
            id: 'b',
            status: 'NEXT',
            name: 'Partition & Plastering',
            programmeMilestone: {
              id: 'm-1',
              code: 'MS-02',
              name: 'Partition complete',
              status: 'PLANNED',
            },
          }),
        ],
      },
    } as Partial<CommercialCurrentCycleResponse>);
  }

  it('states the reason naming the milestone and offers a verify link into Progress', () => {
    stubBlocked();
    renderWithProviders(<CommercialCycleRibbon projectId="p-1" />);

    // The reason names the gating milestone (derived from the NEXT installment).
    expect(screen.getByText('Blocked: verify “Partition complete”')).toBeInTheDocument();

    // "Go verify" links to the project's Progress/milestones view.
    const verify = screen.getByRole('link', { name: /Go verify/i });
    expect(verify).toHaveAttribute('href', '/projects/p-1/progress');
  });

  it('shows the action disabled (never bare) — the reason sits alongside it', () => {
    stubBlocked();
    renderWithProviders(<CommercialCycleRibbon projectId="p-1" />);

    // Verification is the current step, so no billing CTA is rendered.
    expect(screen.queryByRole('button', { name: 'Generate invoice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Generate invoice' })).not.toBeInTheDocument();
    // The disabled control is not bare — the blocker reason is rendered in the same band.
    expect(screen.getByText('Blocked: verify “Partition complete”')).toBeInTheDocument();
  });
});

describe('CommercialCycleRibbon — a clear cycle', () => {
  it('renders the next action as an enabled link when there is no blocker', () => {
    stubCycle({
      stage: 'AWAITING_INVOICE',
      nextAction: { kind: 'GENERATE_INVOICE', href: '/projects/p-1/commercial/billing-collection' },
      blockers: [],
    });
    renderWithProviders(<CommercialCycleRibbon projectId="p-1" />);

    const action = screen.getByRole('link', { name: 'Generate invoice' });
    expect(action).toHaveAttribute('href', '/projects/p-1/commercial/billing-collection');
    // A clear cycle shows no blocker reason.
    expect(screen.queryByText(/^Blocked:/)).not.toBeInTheDocument();
  });

  it('shows the create-contract next action at NO_CONTRACT', () => {
    stubCycle({
      stage: 'NO_CONTRACT',
      nextAction: { kind: 'CREATE_CONTRACT', href: '/projects/p-1/commercial/contract-security/new' },
      blockers: ['MAIN_CONTRACT_MISSING'] as CommercialCycleBlocker[],
    });
    renderWithProviders(<CommercialCycleRibbon projectId="p-1" />);

    const action = screen.getByRole('link', { name: 'Create contract' });
    expect(action).toHaveAttribute('href', '/projects/p-1/commercial/contract-security/new');
  });
});

describe('CommercialCycleRibbon — restricted money is withheld', () => {
  it('renders no money content on the ribbon regardless of financial visibility', () => {
    // A NEXT installment carries an amount, but the ribbon is a cue, not a money surface — it
    // must never render the figure (and so can never leak a withheld one as $0).
    stubCycle({
      stage: 'MILESTONE_SCHEDULE',
      nextAction: { kind: 'GENERATE_INVOICE', href: '/projects/p-1/commercial/payment-schedule' },
      blockers: [],
      paymentSchedule: {
        currency: 'USD',
        contractValue: null,
        totalCollected: null,
        variationLines: [],
        installments: [
          installment({ id: 'b', status: 'NEXT', name: 'Partition & Plastering', amount: null }),
        ],
      },
    } as Partial<CommercialCurrentCycleResponse>);
    renderWithProviders(<CommercialCycleRibbon projectId="p-1" />);

    // Stage label and action render; no currency figure and no "$0" appears anywhere.
    expect(screen.getByText('Milestone 1 of 1 · Partition & Plastering')).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument();
  });
});

describe('CommercialCycleRibbon — due-date cue for the NEXT stage', () => {
  function stubDue(dueDate: string) {
    stubCycle({
      stage: 'MILESTONE_SCHEDULE',
      nextAction: { kind: 'GENERATE_INVOICE', href: '/projects/p-1/commercial/payment-schedule' },
      blockers: [],
      paymentSchedule: {
        currency: 'USD',
        contractValue: '750000.00',
        totalCollected: '0.00',
        variationLines: [],
        installments: [
          installment({ id: 'b', status: 'NEXT', name: 'Partition & Plastering', dueDate }),
        ],
      },
    } as Partial<CommercialCurrentCycleResponse>);
  }

  it('shows a "due in Nd" cue when the NEXT stage is due within the week', () => {
    stubDue(isoInDays(5));
    renderWithProviders(<CommercialCycleRibbon projectId="p-1" />);
    expect(screen.getByText('Due in 5d')).toBeInTheDocument();
  });

  it('shows an overdue cue when the NEXT stage is past due', () => {
    stubDue(isoInDays(-2));
    renderWithProviders(<CommercialCycleRibbon projectId="p-1" />);
    expect(screen.getByText('Overdue by 2d')).toBeInTheDocument();
  });

  it('shows no due cue for a stage more than a week out', () => {
    stubDue(isoInDays(20));
    renderWithProviders(<CommercialCycleRibbon projectId="p-1" />);
    expect(screen.queryByText(/Due in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
  });
});

describe('CommercialCycleRibbon — loading', () => {
  it('renders a slim skeleton band while the cycle loads', () => {
    stubLoading();
    const { container } = renderWithProviders(<CommercialCycleRibbon projectId="p-1" />);

    // No stage label, no action — just the skeleton placeholder.
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

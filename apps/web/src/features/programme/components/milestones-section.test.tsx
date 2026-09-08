import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MilestoneReleaseLine, ProgrammeMilestoneResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import * as hooks from '../hooks/use-programme';

import { MilestonesSection } from './milestones-section';

vi.mock('../hooks/use-programme', () => ({
  useMilestones: vi.fn(),
  useCreateMilestone: vi.fn(),
  useVerifyMilestone: vi.fn(),
}));

function release(overrides: Partial<MilestoneReleaseLine> = {}): MilestoneReleaseLine {
  return {
    installmentId: 'inst-1',
    name: 'Structure',
    percentage: '0.4000',
    triggerType: 'MILESTONE',
    amount: '300000.00',
    currency: 'USD',
    invoiced: false,
    ...overrides,
  };
}

function milestone(overrides: Partial<ProgrammeMilestoneResponse> = {}): ProgrammeMilestoneResponse {
  return {
    id: 'ms-1',
    projectId: 'p-1',
    code: 'MS-01',
    name: 'Substructure complete',
    status: 'PLANNED',
    baselineDate: '2026-03-01T00:00:00.000Z',
    forecastDate: null,
    actualDate: null,
    sortOrder: 0,
    contractMilestoneId: null,
    verifiedBy: null,
    verifiedAt: null,
    releases: [],
    ...overrides,
  };
}

function stubList(data: ProgrammeMilestoneResponse[]) {
  vi.mocked(hooks.useMilestones).mockReturnValue({
    isPending: false,
    isError: false,
    isFetching: false,
    data,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof hooks.useMilestones>);
}

function stubCreate() {
  vi.mocked(hooks.useCreateMilestone).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof hooks.useCreateMilestone>);
}

function stubVerify(mutate = vi.fn()) {
  vi.mocked(hooks.useVerifyMilestone).mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof hooks.useVerifyMilestone>);
  return mutate;
}

beforeEach(() => {
  vi.clearAllMocks();
  stubCreate();
  stubVerify();
});

describe('MilestonesSection — Releases affordance (P2 milestone → payment bridge)', () => {
  it('renders a release chip with percentage, installment name and money for a gated milestone', () => {
    stubList([milestone({ releases: [release()] })]);
    renderWithProviders(<MilestonesSection projectId="p-1" />);

    // "Releases 40% · Structure · $300,000.00" — % from the fraction, money from the line currency.
    // Match on the middot so we hit the release chip, not the "Releases" column header.
    const line = screen.getByText(/Releases 40% · Structure/);
    expect(line).toHaveTextContent('40%');
    expect(line).toHaveTextContent('Structure');
    expect(line).toHaveTextContent(/\$300,000\.00/);
  });

  it('marks an already-invoiced release with a subtle tag', () => {
    stubList([milestone({ releases: [release({ invoiced: true })] })]);
    renderWithProviders(<MilestonesSection projectId="p-1" />);

    expect(screen.getByText('invoiced')).toBeInTheDocument();
  });

  it('does not mark a release that has not been invoiced', () => {
    stubList([milestone({ releases: [release({ invoiced: false })] })]);
    renderWithProviders(<MilestonesSection projectId="p-1" />);

    expect(screen.queryByText('invoiced')).not.toBeInTheDocument();
  });

  it('shows a muted em dash when a milestone releases nothing', () => {
    stubList([milestone({ releases: [] })]);
    renderWithProviders(<MilestonesSection projectId="p-1" />);

    // The em dash appears for the (empty) actual date and for releases; both are muted placeholders.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    // No release chip rendered (the "Releases" column header still exists).
    expect(screen.queryByText(/Releases \d/)).not.toBeInTheDocument();
  });

  it('lists every release for a milestone that gates more than one installment', () => {
    stubList([
      milestone({
        releases: [
          release({ installmentId: 'i1', name: 'Structure', percentage: '0.4000', amount: '300000.00' }),
          release({ installmentId: 'i2', name: 'Fit-out', percentage: '0.2000', amount: '150000.00' }),
        ],
      }),
    ]);
    renderWithProviders(<MilestonesSection projectId="p-1" />);

    expect(screen.getByText(/Structure/)).toHaveTextContent('40%');
    expect(screen.getByText(/Fit-out/)).toHaveTextContent('20%');
  });
});

describe('MilestonesSection — Verify note names the consequence (P2)', () => {
  it('keeps the generic hint when the milestone releases nothing', async () => {
    const user = userEvent.setup();
    stubList([milestone({ releases: [] })]);
    renderWithProviders(<MilestonesSection projectId="p-1" />);

    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(
      screen.getByText(/This becomes billing evidence for any linked payment installment\./i),
    ).toBeInTheDocument();
  });

  it('names the single release it will free for invoicing', async () => {
    const user = userEvent.setup();
    stubList([milestone({ releases: [release()] })]);
    renderWithProviders(<MilestonesSection projectId="p-1" />);

    await user.click(screen.getByRole('button', { name: 'Verify' }));
    const note = screen.getByText(/Verifying this releases the/i);
    expect(note).toHaveTextContent('40%');
    expect(note).toHaveTextContent('Structure');
    expect(note).toHaveTextContent(/\$300,000\.00/);
    expect(note).toHaveTextContent(/for invoicing/i);
  });

  it('names the count and each release when a milestone gates several installments', async () => {
    const user = userEvent.setup();
    stubList([
      milestone({
        releases: [
          release({ installmentId: 'i1', name: 'Structure', percentage: '0.4000', amount: '300000.00' }),
          release({ installmentId: 'i2', name: 'Fit-out', percentage: '0.2000', amount: '150000.00' }),
        ],
      }),
    ]);
    renderWithProviders(<MilestonesSection projectId="p-1" />);

    await user.click(screen.getByRole('button', { name: 'Verify' }));
    const note = screen.getByText(/Verifying this releases 2 payment installments/i);
    expect(note).toHaveTextContent('Structure');
    expect(note).toHaveTextContent('Fit-out');
  });
});

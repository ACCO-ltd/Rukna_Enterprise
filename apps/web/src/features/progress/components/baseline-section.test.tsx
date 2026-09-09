import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgrammeBaselineResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  useProgressTargets: vi.fn(),
  useProgrammeBaseline: vi.fn(),
  useSetProgressTargets: vi.fn(),
  useApproveBaseline: vi.fn(),
  useRebaseline: vi.fn(),
  useProject: vi.fn(),
  useMilestones: vi.fn(),
  useCommercialSummary: vi.fn(),
  useVariations: vi.fn(),
}));

vi.mock('../hooks/use-progress', () => ({
  useProgressTargets: mocks.useProgressTargets,
  useProgrammeBaseline: mocks.useProgrammeBaseline,
  useSetProgressTargets: mocks.useSetProgressTargets,
  useApproveBaseline: mocks.useApproveBaseline,
  useRebaseline: mocks.useRebaseline,
}));
vi.mock('@/features/projects/hooks/use-project', () => ({ useProject: mocks.useProject }));
vi.mock('@/features/programme/hooks/use-programme', () => ({ useMilestones: mocks.useMilestones }));
vi.mock('@/features/commercial/hooks/use-commercial', () => ({
  useCommercialSummary: mocks.useCommercialSummary,
  useVariations: mocks.useVariations,
}));

import { BaselineSection } from './baseline-section';

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false, isFetching: false });
const mutation = () => ({ mutate: vi.fn(), isPending: false });

const TARGET_ROWS = [
  { targetDate: '2026-07-31', cumulativePercent: 40 },
  { targetDate: '2026-08-31', cumulativePercent: 70 },
];

const BASELINE_V1: ProgrammeBaselineResponse = {
  id: 'bl-1',
  projectId: 'proj-1',
  version: 1,
  status: 'APPROVED',
  approvedBy: 'Amina PM',
  approvedAt: '2026-08-01',
  variationOrderId: null,
  note: null,
  createdAt: '2026-08-01',
  points: [
    { targetDate: '2026-07-31', cumulativePercent: 40 },
    { targetDate: '2026-08-31', cumulativePercent: 70 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useProgressTargets.mockReturnValue(loaded(TARGET_ROWS));
  mocks.useProgrammeBaseline.mockReturnValue(loaded(null));
  mocks.useSetProgressTargets.mockReturnValue(mutation());
  mocks.useApproveBaseline.mockReturnValue(mutation());
  mocks.useRebaseline.mockReturnValue(mutation());
  mocks.useProject.mockReturnValue(
    loaded({ startDate: '2026-07-01', expectedEndDate: '2026-12-31' }),
  );
  mocks.useMilestones.mockReturnValue(loaded([]));
  mocks.useCommercialSummary.mockReturnValue(loaded({ mainContract: { id: 'contract-1' } }));
  mocks.useVariations.mockReturnValue(loaded({ contractId: 'contract-1', variations: [] }));
});

describe('BaselineSection — governing baseline', () => {
  it('shows "Approve baseline" (gated manage:project) and no re-baseline when no baseline exists', () => {
    renderWithProviders(<BaselineSection projectId="proj-1" />, {
      permissions: ['manage:project'],
      withToast: true,
    });

    expect(screen.getByRole('button', { name: 'Approve baseline' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Re-baseline' })).not.toBeInTheDocument();
    // The "no governing baseline yet" copy is shown.
    expect(screen.getByText(/No baseline is governing yet/i)).toBeInTheDocument();
  });

  it('hides the approve button from a user without manage:project', () => {
    renderWithProviders(<BaselineSection projectId="proj-1" />, {
      permissions: ['view:project'],
      withToast: true,
    });

    expect(screen.queryByRole('button', { name: 'Approve baseline' })).not.toBeInTheDocument();
  });

  it('disables approve until a working curve is entered', () => {
    mocks.useProgressTargets.mockReturnValue(loaded([]));
    renderWithProviders(<BaselineSection projectId="proj-1" />, {
      permissions: ['manage:project'],
      withToast: true,
    });

    expect(screen.getByRole('button', { name: 'Approve baseline' })).toBeDisabled();
  });

  it('shows the governing-baseline card and the re-baseline button (gated approve:project) once one exists', () => {
    mocks.useProgrammeBaseline.mockReturnValue(loaded(BASELINE_V1));
    renderWithProviders(<BaselineSection projectId="proj-1" />, {
      permissions: ['approve:project'],
      withToast: true,
    });

    expect(screen.getByText('Baseline v1')).toBeInTheDocument();
    expect(screen.getByText(/Approved by Amina PM/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-baseline' })).toBeInTheDocument();
    // The initial approve is gone once a baseline governs.
    expect(screen.queryByRole('button', { name: 'Approve baseline' })).not.toBeInTheDocument();
  });

  it('hides re-baseline from a user without approve:project even when a baseline exists', () => {
    mocks.useProgrammeBaseline.mockReturnValue(loaded(BASELINE_V1));
    renderWithProviders(<BaselineSection projectId="proj-1" />, {
      permissions: ['manage:project'],
      withToast: true,
    });

    expect(screen.getByText('Baseline v1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-baseline' })).not.toBeInTheDocument();
  });

  it('flags unpublished changes when the working curve differs from the frozen baseline', () => {
    mocks.useProgressTargets.mockReturnValue(
      loaded([
        { targetDate: '2026-07-31', cumulativePercent: 40 },
        { targetDate: '2026-08-31', cumulativePercent: 85 }, // drifted from 70
      ]),
    );
    mocks.useProgrammeBaseline.mockReturnValue(loaded(BASELINE_V1));
    renderWithProviders(<BaselineSection projectId="proj-1" />, {
      permissions: ['approve:project'],
      withToast: true,
    });

    expect(screen.getByText('Unpublished changes')).toBeInTheDocument();
  });

  it('does not flag unpublished changes when the working curve matches the baseline', () => {
    mocks.useProgrammeBaseline.mockReturnValue(loaded(BASELINE_V1));
    renderWithProviders(<BaselineSection projectId="proj-1" />, {
      permissions: ['approve:project'],
      withToast: true,
    });

    expect(screen.queryByText('Unpublished changes')).not.toBeInTheDocument();
  });
});

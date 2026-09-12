import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRollupResponse, WorkPackageRollupLine } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import type { ClaimableLine } from '@/features/progress/hooks/use-boq-leaves';

// ── Hook mocks ────────────────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  useProjectRollup: vi.fn(),
  useProject: vi.fn(),
  useBoqLeaves: vi.fn(),
  useAllocateToWorkPackage: vi.fn(),
  useApplyScheduleTemplate: vi.fn(),
  useSuggestWeights: vi.fn(),
  useUpdateWorkPackage: vi.fn(),
  applyMutate: vi.fn(),
  allocateMutate: vi.fn(),
  suggestMutate: vi.fn(),
  updateMutate: vi.fn(),
}));

vi.mock('@/features/progress/hooks/use-progress', () => ({
  useProjectRollup: mocks.useProjectRollup,
  useAllocateToWorkPackage: mocks.useAllocateToWorkPackage,
}));
vi.mock('@/features/projects/hooks/use-project', () => ({
  useProject: mocks.useProject,
}));
vi.mock('@/features/progress/hooks/use-boq-leaves', () => ({
  useBoqLeaves: mocks.useBoqLeaves,
  lineLabel: (l: ClaimableLine) => [...l.path, `${l.code} ${l.description}`].join(' › '),
}));
vi.mock('../hooks/use-programme', () => ({
  useApplyScheduleTemplate: mocks.useApplyScheduleTemplate,
  useSuggestWeights: mocks.useSuggestWeights,
  useUpdateWorkPackage: mocks.useUpdateWorkPackage,
}));

import { ScheduleSetupWizard } from './schedule-setup-wizard';

const loaded = <T,>(data: T) => ({
  data,
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
});

const PROJECT = { startDate: '2026-01-01', expectedEndDate: '2026-12-31' };

function line(overrides: Partial<WorkPackageRollupLine>): WorkPackageRollupLine {
  return {
    id: 'wp-1',
    code: 'WP-01',
    name: 'Foundations',
    responsibleOwner: null,
    weight: '0',
    percentComplete: 0,
    leafCount: 0,
    plannedStart: null,
    plannedEnd: null,
    durationDays: 21,
    forecastEnd: null,
    scheduleOnly: false,
    actualStart: null,
    actualFinish: null,
    scheduleStatus: 'INSUFFICIENT_DATA',
    ...overrides,
  };
}

function rollup(
  packages: WorkPackageRollupLine[],
  extra: Partial<ProjectRollupResponse> = {},
): ProjectRollupResponse {
  return {
    projectId: 'proj-1',
    physicalPercent: 0,
    weightsTotal: '0',
    weightsComplete: false,
    packages,
    ...extra,
  };
}

function leaf(id: string, code: string): ClaimableLine {
  return {
    id,
    code,
    description: `Item ${code}`,
    path: ['Substructure'],
    unit: 'm3',
    quantity: '100',
    unitRate: '50',
    currency: 'USD',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useProject.mockReturnValue(loaded(PROJECT));
  mocks.useBoqLeaves.mockReturnValue({
    leaves: [leaf('leaf-1', '01.01'), leaf('leaf-2', '01.02')],
    hasBaseline: true,
    isPending: false,
  });
  mocks.useProjectRollup.mockReturnValue(loaded(rollup([])));
  mocks.useApplyScheduleTemplate.mockReturnValue({ mutate: mocks.applyMutate, isPending: false });
  mocks.useAllocateToWorkPackage.mockReturnValue({ mutate: mocks.allocateMutate, isPending: false });
  mocks.useSuggestWeights.mockReturnValue({ mutate: mocks.suggestMutate, isPending: false });
  mocks.useUpdateWorkPackage.mockReturnValue({ mutate: mocks.updateMutate, isPending: false });
});

function open() {
  return renderWithProviders(
    <ScheduleSetupWizard projectId="proj-1" open onOpenChange={vi.fn()} />,
  );
}

describe('ScheduleSetupWizard', () => {
  it('opens on step 1 with a template and a blank start', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Set up schedule' })).toBeInTheDocument();
    expect(screen.getByText('ACCO standard building schedule')).toBeInTheDocument();
    expect(screen.getByText('Start blank')).toBeInTheDocument();
  });

  it('warns when the baseline was cleared while open (no broken flow)', () => {
    mocks.useBoqLeaves.mockReturnValue({ leaves: [], hasBaseline: false, isPending: false });
    open();
    expect(screen.getByText(/no longer committed/i)).toBeInTheDocument();
    // No start options are offered without a baseline.
    expect(screen.queryByText('ACCO standard building schedule')).not.toBeInTheDocument();
  });

  it('applies the ACCO template from step 1', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByText('ACCO standard building schedule'));
    expect(mocks.applyMutate).toHaveBeenCalledWith('ACCO_STANDARD_BUILDING', expect.anything());
  });

  it('disables the template when the project already has work packages', () => {
    mocks.useProjectRollup.mockReturnValue(loaded(rollup([line({})])));
    open();
    expect(screen.getByText(/already has work packages/i)).toBeInTheDocument();
  });

  it('walks to step 2 and warns about unassigned BOQ items', async () => {
    const user = userEvent.setup();
    // One phase, no scope assigned; two leaves exist → both unassigned.
    mocks.useProjectRollup.mockReturnValue(loaded(rollup([line({})])));
    open();
    await user.click(screen.getByText('Start blank'));

    // Step 2 shows the unassigned-items warning.
    expect(screen.getByText(/2 BOQ items are not assigned/i)).toBeInTheDocument();
    // And a per-phase assign control.
    expect(screen.getByRole('button', { name: 'Assign' })).toBeInTheDocument();
  });

  it('confirms all-assigned coverage when every leaf has a phase', async () => {
    const user = userEvent.setup();
    // Two leaves, one phase carrying both.
    mocks.useProjectRollup.mockReturnValue(loaded(rollup([line({ leafCount: 2 })])));
    open();
    await user.click(screen.getByText('Start blank'));
    expect(screen.getByText('Every BOQ item is assigned to a phase.')).toBeInTheDocument();
  });

  it('auto-suggests back-to-back dates from the project start using each duration', async () => {
    const user = userEvent.setup();
    mocks.useProjectRollup.mockReturnValue(
      loaded(
        rollup([
          line({ id: 'wp-1', code: 'WP-01', durationDays: 7 }),
          line({ id: 'wp-2', code: 'WP-02', name: 'Excavation', durationDays: 21 }),
        ]),
      ),
    );
    open();
    // step 1 → 2 → 3
    await user.click(screen.getByText('Start blank'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await user.click(screen.getByRole('button', { name: 'Auto-suggest dates' }));

    // Phase 1: 7 days from 2026-01-01 → 2026-01-01 .. 2026-01-07.
    expect(mocks.updateMutate).toHaveBeenCalledWith(
      { workPackageId: 'wp-1', body: { plannedStart: '2026-01-01', plannedEnd: '2026-01-07' } },
      expect.anything(),
    );
    // Phase 2 starts the day after: 2026-01-08, 21 days → 2026-01-28.
    expect(mocks.updateMutate).toHaveBeenCalledWith(
      { workPackageId: 'wp-2', body: { plannedStart: '2026-01-08', plannedEnd: '2026-01-28' } },
      expect.anything(),
    );
  });

  it('distributes weights by BOQ value and writes each suggestion, showing the reconcile check', async () => {
    const user = userEvent.setup();
    mocks.useProjectRollup.mockReturnValue(
      loaded(
        rollup(
          [
            line({ id: 'wp-1', code: 'WP-01', leafCount: 2, weight: '0.6', plannedStart: '2026-01-01', plannedEnd: '2026-01-21' }),
            line({ id: 'wp-2', code: 'WP-02', name: 'Excavation', leafCount: 1, weight: '0.4', plannedStart: '2026-01-22', plannedEnd: '2026-02-10' }),
          ],
          { weightsTotal: '1', weightsComplete: true },
        ),
      ),
    );
    // suggest-weights resolves with two suggestions.
    mocks.suggestMutate.mockImplementation((_arg: unknown, opts: { onSuccess: (r: unknown) => void }) => {
      opts.onSuccess({
        projectId: 'proj-1',
        weights: [
          { workPackageId: 'wp-1', suggestedWeight: 0.6 },
          { workPackageId: 'wp-2', suggestedWeight: 0.4 },
        ],
      });
    });
    open();
    await user.click(screen.getByText('Start blank'));
    await user.click(screen.getByRole('button', { name: 'Continue' })); // → dates
    await user.click(screen.getByRole('button', { name: 'Continue' })); // → weights

    expect(screen.getByText('Weights complete')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Distribute weights by BOQ value' }));

    expect(mocks.updateMutate).toHaveBeenCalledWith(
      { workPackageId: 'wp-1', body: { progressWeight: 0.6 } },
      expect.anything(),
    );
    expect(mocks.updateMutate).toHaveBeenCalledWith(
      { workPackageId: 'wp-2', body: { progressWeight: 0.4 } },
      expect.anything(),
    );
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
  });

  it('flags phases missing scope or dates on the review step', async () => {
    const user = userEvent.setup();
    mocks.useProjectRollup.mockReturnValue(
      loaded(
        rollup([
          // measurable but no scope, and no dates
          line({ id: 'wp-1', code: 'WP-01', leafCount: 0, plannedStart: null, plannedEnd: null }),
        ]),
      ),
    );
    open();
    await user.click(screen.getByText('Start blank'));
    await user.click(screen.getByRole('button', { name: 'Continue' })); // → dates
    // step 3 "Continue" button reads with the undated count
    await user.click(screen.getByRole('button', { name: /Continue \(1 phase still undated\)/i }));

    expect(screen.getByText(/1 measurable phase has no BOQ scope/i)).toBeInTheDocument();
    expect(screen.getByText(/1 phase has no planned dates/i)).toBeInTheDocument();
  });

  it('shows a schedule-only phase with a dates-only hint and no assign picker', async () => {
    const user = userEvent.setup();
    mocks.useProjectRollup.mockReturnValue(
      loaded(rollup([line({ name: 'Mobilization', scheduleOnly: true, percentComplete: null })])),
    );
    open();
    await user.click(screen.getByText('Start blank'));
    expect(screen.getByText('Tracked by dates only — no BOQ scope, no % complete.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make measurable' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
  });
});

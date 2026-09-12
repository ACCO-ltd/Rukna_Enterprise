import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRollupResponse, WorkPackageRollupLine } from '@erp/types';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  useProjectRollup: vi.fn(),
  useProject: vi.fn(),
  useBoqLeaves: vi.fn(),
}));

vi.mock('@/features/progress/hooks/use-progress', () => ({
  useProjectRollup: mocks.useProjectRollup,
}));
vi.mock('@/features/projects/hooks/use-project', () => ({
  useProject: mocks.useProject,
}));
vi.mock('@/features/progress/hooks/use-boq-leaves', () => ({
  useBoqLeaves: mocks.useBoqLeaves,
}));

import { WorkPackageScheduleSection } from './work-package-schedule-section';

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
    weight: '0.25',
    percentComplete: 40,
    leafCount: 3,
    plannedStart: '2026-02-01',
    plannedEnd: '2026-04-30',
    durationDays: 89,
    forecastEnd: null,
    scheduleOnly: false,
    actualStart: '2026-02-05',
    actualFinish: null,
    scheduleStatus: 'ON_TRACK',
    ...overrides,
  };
}

function rollup(packages: WorkPackageRollupLine[]): ProjectRollupResponse {
  return {
    projectId: 'proj-1',
    physicalPercent: 40,
    weightsTotal: '1',
    weightsComplete: true,
    packages,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useProject.mockReturnValue(loaded(PROJECT));
  mocks.useBoqLeaves.mockReturnValue({ leaves: [], isPending: false, hasBaseline: true });
  mocks.useProjectRollup.mockReturnValue(loaded(rollup([line({})])));
});

describe('WorkPackageScheduleSection', () => {
  it('shows the no-baseline hint when the BOQ is not baselined yet', () => {
    mocks.useBoqLeaves.mockReturnValue({ leaves: [], isPending: false, hasBaseline: false });
    renderWithProviders(<WorkPackageScheduleSection projectId="proj-1" />);

    expect(screen.getByText('Commit the BOQ first')).toBeInTheDocument();
    // No timeline is drawn without a baseline.
    expect(screen.queryByText('Planned vs actual')).not.toBeInTheDocument();
  });

  it('shows a set-up empty state (not an empty grid) when no package has planned dates', () => {
    mocks.useProjectRollup.mockReturnValue(
      loaded(rollup([line({ plannedStart: null, plannedEnd: null, actualStart: null })])),
    );
    renderWithProviders(<WorkPackageScheduleSection projectId="proj-1" />);

    expect(screen.getByText('No schedule yet')).toBeInTheDocument();
    expect(screen.getByText(/Set planned start and end dates/i)).toBeInTheDocument();
    expect(screen.queryByText('Planned vs actual')).not.toBeInTheDocument();
  });

  it('directs to create work packages first when there are none at all', () => {
    mocks.useProjectRollup.mockReturnValue(loaded(rollup([])));
    renderWithProviders(<WorkPackageScheduleSection projectId="proj-1" />);

    expect(screen.getByText('No schedule yet')).toBeInTheDocument();
    expect(screen.getByText(/Create work packages/i)).toBeInTheDocument();
  });

  it('warns with a banner when some phases lack dates but others are scheduled', () => {
    mocks.useProjectRollup.mockReturnValue(
      loaded(
        rollup([
          line({ id: 'wp-1', code: 'WP-01' }),
          line({ id: 'wp-2', code: 'WP-02', name: 'Roof', plannedStart: null, plannedEnd: null }),
        ]),
      ),
    );
    renderWithProviders(<WorkPackageScheduleSection projectId="proj-1" />);

    expect(screen.getByText(/1 phase has no planned dates yet/i)).toBeInTheDocument();
    // The timeline still renders for the dated phase.
    expect(screen.getByText('Planned vs actual')).toBeInTheDocument();
  });

  it('renders the plan-vs-actual timeline with % and status for a scheduled phase', () => {
    renderWithProviders(<WorkPackageScheduleSection projectId="proj-1" />);

    expect(screen.getByText('Planned vs actual')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('On track')).toBeInTheDocument();
    // The row's track exposes both planned and derived-actual as an accessible label.
    const track = screen.getByRole('img', { name: /Foundations:/ });
    expect(track).toHaveAccessibleName(/started 2026-02-05 — ongoing/i);
  });

  it('closes the actual bar and labels the finished range once the phase completes', () => {
    mocks.useProjectRollup.mockReturnValue(
      loaded(
        rollup([
          line({
            percentComplete: 100,
            actualStart: '2026-02-05',
            actualFinish: '2026-04-20',
            scheduleStatus: 'AHEAD',
          }),
        ]),
      ),
    );
    renderWithProviders(<WorkPackageScheduleSection projectId="proj-1" />);

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('Ahead of schedule')).toBeInTheDocument();
    const track = screen.getByRole('img', { name: /Foundations:/ });
    expect(track).toHaveAccessibleName(/2026-02-05 → 2026-04-20/);
  });

  it('shows a schedule-only phase with dates but a dash for percent', () => {
    mocks.useProjectRollup.mockReturnValue(
      loaded(
        rollup([
          line({
            name: 'Mobilization',
            scheduleOnly: true,
            percentComplete: null,
            actualStart: null,
            actualFinish: null,
            scheduleStatus: 'ON_TRACK',
          }),
        ]),
      ),
    );
    renderWithProviders(<WorkPackageScheduleSection projectId="proj-1" />);

    expect(screen.getByText('Schedule-only')).toBeInTheDocument();
    // Dash, not a misleading 0%.
    const chip = screen.getByLabelText('Verified progress');
    expect(within(chip).queryByText('%')).not.toBeInTheDocument();
    expect(chip).toHaveTextContent('—');
  });

  it('surfaces a retry when the roll-up fails to load', () => {
    mocks.useProjectRollup.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderWithProviders(<WorkPackageScheduleSection projectId="proj-1" />);

    expect(screen.getByText('Could not load progress')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

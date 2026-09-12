import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRollupResponse, WorkPackageRollupLine } from '@erp/types';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  useProjectRollup: vi.fn(),
  useBoqLeaves: vi.fn(),
}));

vi.mock('@/features/progress/hooks/use-progress', () => ({
  useProjectRollup: mocks.useProjectRollup,
}));
vi.mock('@/features/progress/hooks/use-boq-leaves', () => ({
  useBoqLeaves: mocks.useBoqLeaves,
}));
// The wizard itself is exercised in its own spec; stub it so the card test stays on the entry.
vi.mock('./schedule-setup-wizard', () => ({
  ScheduleSetupWizard: () => null,
}));

import { ScheduleSetupCard } from './schedule-setup-card';

const loaded = <T,>(data: T) => ({
  data,
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
});

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

function rollup(packages: WorkPackageRollupLine[]): ProjectRollupResponse {
  return { projectId: 'proj-1', physicalPercent: 0, weightsTotal: '0', weightsComplete: false, packages };
}

const MANAGE = ['manage:project'];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useBoqLeaves.mockReturnValue({ leaves: [], hasBaseline: true, isPending: false });
  mocks.useProjectRollup.mockReturnValue(loaded(rollup([])));
});

describe('ScheduleSetupCard', () => {
  it('renders nothing for a user who cannot manage the project', () => {
    const { container } = renderWithProviders(<ScheduleSetupCard projectId="proj-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('gates with a disabled CTA and hint when the BOQ is not baselined', () => {
    mocks.useBoqLeaves.mockReturnValue({ leaves: [], hasBaseline: false, isPending: false });
    renderWithProviders(<ScheduleSetupCard projectId="proj-1" />, { permissions: MANAGE });

    expect(screen.getByText('Commit the BOQ first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up schedule' })).toBeDisabled();
  });

  it('leads with the set-up CTA when there is no schedule yet', () => {
    renderWithProviders(<ScheduleSetupCard projectId="proj-1" />, { permissions: MANAGE });

    expect(screen.getByText('No schedule yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up schedule' })).toBeEnabled();
  });

  it('offers a compact edit entry once a phase carries planned dates', () => {
    mocks.useProjectRollup.mockReturnValue(
      loaded(rollup([line({ plannedStart: '2026-01-01', plannedEnd: '2026-01-21' })])),
    );
    renderWithProviders(<ScheduleSetupCard projectId="proj-1" />, { permissions: MANAGE });

    expect(screen.getByText('Master schedule')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit schedule' })).toBeInTheDocument();
    // Not the empty-state CTA.
    expect(screen.queryByText('No schedule yet')).not.toBeInTheDocument();
  });
});

import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PhysicalFinancialSignalResponse,
  ProgressCurveResponse,
  ProjectRollupResponse,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  usePhysicalFinancialSignal: vi.fn(),
  useProjectRollup: vi.fn(),
  useProgressCurve: vi.fn(),
  useCaptureProgressSnapshot: vi.fn(),
}));

vi.mock('../hooks/use-progress', () => mocks);

import { PerformanceSection } from './performance-section';

const SIGNAL: PhysicalFinancialSignalResponse = {
  physicalPercent: 62,
  costConsumedPercent: 70,
  divergence: -8,
  status: 'COST_AHEAD',
} as unknown as PhysicalFinancialSignalResponse;

const ROLLUP: ProjectRollupResponse = {
  physicalPercent: 62,
  weightsComplete: true,
  weightsTotal: '1',
} as unknown as ProjectRollupResponse;

const CURVE: ProgressCurveResponse = {
  projectId: 'proj-1',
  baseline: [
    { periodEndDate: '2026-07-31', plannedPercent: 45 },
    { periodEndDate: '2026-08-31', plannedPercent: 70 },
  ],
  actual: [
    { periodEndDate: '2026-07-31', physicalPercent: 40, verifiedPercent: 36, costPercent: 44 },
    { periodEndDate: '2026-08-31', physicalPercent: 62, verifiedPercent: 58, costPercent: 70 },
  ],
  scheduleVariancePercent: -8,
  status: 'BEHIND',
  baselineProvisional: true,
};

const INSUFFICIENT_CURVE: ProgressCurveResponse = {
  projectId: 'proj-1',
  baseline: [],
  actual: [],
  scheduleVariancePercent: null,
  status: 'INSUFFICIENT_DATA',
  baselineProvisional: true,
};

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false, isFetching: false });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.usePhysicalFinancialSignal.mockReturnValue(loaded(SIGNAL));
  mocks.useProjectRollup.mockReturnValue(loaded(ROLLUP));
  mocks.useProgressCurve.mockReturnValue(loaded(CURVE));
  mocks.useCaptureProgressSnapshot.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

describe('PerformanceSection', () => {
  it('keeps the physical-vs-financial signal strip and shows the schedule-status chip', () => {
    renderWithProviders(<PerformanceSection projectId="proj-1" />, { withToast: true });

    // Existing signal content preserved.
    expect(screen.getByText('Cost ahead of progress')).toBeInTheDocument();
    // New schedule chip, with the variance.
    expect(screen.getByText(/Behind schedule · −8%/)).toBeInTheDocument();
  });

  it('notes when the baseline is provisional', () => {
    renderWithProviders(<PerformanceSection projectId="proj-1" />, { withToast: true });

    expect(screen.getByText(/Planned line is provisional/)).toBeInTheDocument();
  });

  it('shows an honest insufficient-data state instead of a fabricated curve', () => {
    mocks.useProgressCurve.mockReturnValue(loaded(INSUFFICIENT_CURVE));
    renderWithProviders(<PerformanceSection projectId="proj-1" />, {
      permissions: ['manage:project'],
      withToast: true,
    });

    expect(
      screen.getByText('The progress curve begins once progress is recorded.'),
    ).toBeInTheDocument();
    // No chart image is drawn in the empty state.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('hides the capture action from a user who cannot manage progress', () => {
    renderWithProviders(<PerformanceSection projectId="proj-1" />, { withToast: true });
    // No permission → the control is absent (honesty §4), not a disabled stub.
    expect(
      screen.queryByRole('button', { name: 'Record progress snapshot' }),
    ).not.toBeInTheDocument();
  });

  it('shows the capture action when the user holds manage:project', () => {
    renderWithProviders(<PerformanceSection projectId="proj-1" />, {
      permissions: ['manage:project'],
      withToast: true,
    });

    expect(
      screen.getByRole('button', { name: 'Record progress snapshot' }),
    ).toBeInTheDocument();
  });
});

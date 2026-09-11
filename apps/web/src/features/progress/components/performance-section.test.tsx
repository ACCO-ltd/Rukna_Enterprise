import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CollectionProgressSignalResponse,
  PhysicalFinancialSignalResponse,
  ProgressCurveResponse,
  ProjectRollupResponse,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  usePhysicalFinancialSignal: vi.fn(),
  useCollectionProgressSignal: vi.fn(),
  useProjectRollup: vi.fn(),
  useProgressCurve: vi.fn(),
  useCaptureProgressSnapshot: vi.fn(),
  // The attention panel reads these; this suite is about the curve, so they stay empty.
  useDprs: vi.fn(),
  useWorkPackages: vi.fn(),
  useProgressPeriodComparison: vi.fn(),
}));

vi.mock('../hooks/use-progress', () => mocks);
vi.mock('../hooks/use-boq-leaves', () => ({
  useBoqLeaves: () => ({ leaves: [], isPending: false, hasBaseline: false }),
}));

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

const COLLECTION: CollectionProgressSignalResponse = {
  physicalPercent: 62,
  collectedPercent: 70,
  divergence: 8,
  status: 'CASH_AHEAD',
} as unknown as CollectionProgressSignalResponse;

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
  baselineSource: 'provisional',
  baselineVersion: null,
};

const INSUFFICIENT_CURVE: ProgressCurveResponse = {
  projectId: 'proj-1',
  baseline: [],
  actual: [],
  scheduleVariancePercent: null,
  status: 'INSUFFICIENT_DATA',
  baselineProvisional: true,
  baselineSource: 'provisional',
  baselineVersion: null,
};

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false, isFetching: false });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.usePhysicalFinancialSignal.mockReturnValue(loaded(SIGNAL));
  mocks.useCollectionProgressSignal.mockReturnValue(loaded(COLLECTION));
  mocks.useProjectRollup.mockReturnValue(loaded(ROLLUP));
  mocks.useProgressCurve.mockReturnValue(loaded(CURVE));
  mocks.useCaptureProgressSnapshot.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mocks.useDprs.mockReturnValue(loaded([]));
  mocks.useWorkPackages.mockReturnValue(loaded([]));
  mocks.useProgressPeriodComparison.mockReturnValue(loaded(null));
});

describe('PerformanceSection', () => {
  it('keeps the physical-vs-financial signal strip and shows the schedule-status chip', () => {
    renderWithProviders(<PerformanceSection projectId="proj-1" onGoTo={() => {}} />, { withToast: true });

    // Existing signal content preserved.
    expect(screen.getByText('Cost ahead of progress')).toBeInTheDocument();
    // New schedule chip, with the variance.
    expect(screen.getByText(/Behind schedule · −8%/)).toBeInTheDocument();
  });

  it('notes when the baseline is provisional', () => {
    renderWithProviders(<PerformanceSection projectId="proj-1" onGoTo={() => {}} />, { withToast: true });

    expect(screen.getByText(/planned line is an estimate/i)).toBeInTheDocument();
  });

  it('badges the S-curve source as Provisional for a provisional curve', () => {
    renderWithProviders(<PerformanceSection projectId="proj-1" onGoTo={() => {}} />, { withToast: true });

    expect(screen.getByText('Provisional')).toBeInTheDocument();
  });

  it('badges the S-curve source as the draft plan when it comes from targets', () => {
    mocks.useProgressCurve.mockReturnValue(
      loaded({ ...CURVE, baselineSource: 'targets', baselineProvisional: true, baselineVersion: null }),
    );
    renderWithProviders(<PerformanceSection projectId="proj-1" onGoTo={() => {}} />, { withToast: true });

    expect(screen.getByText('Draft plan (not approved)')).toBeInTheDocument();
  });

  it('badges the S-curve source with the governing baseline version', () => {
    mocks.useProgressCurve.mockReturnValue(
      loaded({ ...CURVE, baselineSource: 'baseline', baselineProvisional: false, baselineVersion: 3 }),
    );
    renderWithProviders(<PerformanceSection projectId="proj-1" onGoTo={() => {}} />, { withToast: true });

    expect(screen.getByText('Baseline v3')).toBeInTheDocument();
  });

  it('shows an honest insufficient-data state instead of a fabricated curve', () => {
    mocks.useProgressCurve.mockReturnValue(loaded(INSUFFICIENT_CURVE));
    renderWithProviders(<PerformanceSection projectId="proj-1" onGoTo={() => {}} />, {
      permissions: ['manage:project'],
      withToast: true,
    });

    expect(
      screen.getByText('The progress curve begins once progress is recorded.'),
    ).toBeInTheDocument();
    // No chart image is drawn in the empty state.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  /**
   * The section header and the empty state each carried a capture button, 60px apart and doing
   * the same thing. The empty state keeps its one, because only that copy carries the
   * period-end date — the sole way to record a snapshot for a date that is not today.
   */
  it('offers the capture action once in the empty state, not twice', () => {
    mocks.useProgressCurve.mockReturnValue(loaded(INSUFFICIENT_CURVE));
    renderWithProviders(<PerformanceSection projectId="proj-1" onGoTo={() => {}} />, {
      permissions: ['manage:project'],
      withToast: true,
    });

    expect(screen.getAllByRole('button', { name: 'Record progress snapshot' })).toHaveLength(1);
  });

  it('hides the capture action from a user who cannot manage progress', () => {
    renderWithProviders(<PerformanceSection projectId="proj-1" onGoTo={() => {}} />, { withToast: true });
    // No permission → the control is absent (honesty §4), not a disabled stub.
    expect(
      screen.queryByRole('button', { name: 'Record progress snapshot' }),
    ).not.toBeInTheDocument();
  });

  it('shows the capture action when the user holds manage:project', () => {
    renderWithProviders(<PerformanceSection projectId="proj-1" onGoTo={() => {}} />, {
      permissions: ['manage:project'],
      withToast: true,
    });

    expect(
      screen.getByRole('button', { name: 'Record progress snapshot' }),
    ).toBeInTheDocument();
  });
});

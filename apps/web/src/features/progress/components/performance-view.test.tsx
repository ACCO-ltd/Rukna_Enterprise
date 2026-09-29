import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { localIsoDate } from '../domain/my-reports';

const mocks = vi.hoisted(() => ({
  useProjectRollup: vi.fn(),
  useProgrammeBaseline: vi.fn(),
  useProgressCurve: vi.fn(),
  useDprs: vi.fn(),
  usePhysicalFinancialSignal: vi.fn(),
  useCollectionProgressSignal: vi.fn(),
  useCaptureProgressSnapshot: vi.fn(),
  useMilestones: vi.fn(),
}));

vi.mock('../hooks/use-progress', () => ({
  useProjectRollup: mocks.useProjectRollup,
  useProgrammeBaseline: mocks.useProgrammeBaseline,
  useProgressCurve: mocks.useProgressCurve,
  useDprs: mocks.useDprs,
  usePhysicalFinancialSignal: mocks.usePhysicalFinancialSignal,
  useCollectionProgressSignal: mocks.useCollectionProgressSignal,
  useCaptureProgressSnapshot: mocks.useCaptureProgressSnapshot,
}));
vi.mock('@/features/programme/hooks/use-programme', () => ({ useMilestones: mocks.useMilestones }));

import { PerformanceView } from './performance-view';

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false });

/** Shift today by whole days, as YYYY-MM-DD. */
function daysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localIsoDate(d);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useProjectRollup.mockReturnValue(
    loaded({
      physicalPercent: 30,
      weightsTotal: '1',
      weightsComplete: true,
      packages: [
        {
          id: 'wp1',
          code: 'WP-01',
          name: 'Substructure',
          weight: '0.4',
          percentComplete: 50,
          leafCount: 3,
          scheduleOnly: false,
          // Planned 0 → 100% over the 20 days around today: ~50% planned today, so 50% is on plan.
          plannedStart: daysFromToday(-10),
          plannedEnd: daysFromToday(10),
        },
        {
          id: 'wp2',
          code: 'WP-02',
          name: 'Frame',
          weight: '0.6',
          percentComplete: 10,
          leafCount: 4,
          scheduleOnly: false,
          // Should be finished by now: planned 100%, done 10% — behind.
          plannedStart: daysFromToday(-40),
          plannedEnd: daysFromToday(-5),
        },
      ],
    }),
  );
  mocks.useProgrammeBaseline.mockReturnValue(loaded(null));
  mocks.useProgressCurve.mockReturnValue(
    loaded({ baseline: [], actual: [{ periodEndDate: daysFromToday(-3), physicalPercent: 31, verifiedPercent: 30, costPercent: 22 }] }),
  );
  mocks.useDprs.mockReturnValue(loaded([{ id: 'd1', status: 'APPROVED', reportDate: '2026-09-20' }]));
  mocks.usePhysicalFinancialSignal.mockReturnValue(
    loaded({ physicalPercent: 30, actualCost: null, budgetTotal: null, moneyVisible: false, costConsumedPercent: 42, divergence: -12, status: 'COST_AHEAD', weightsComplete: true }),
  );
  mocks.useCollectionProgressSignal.mockReturnValue(
    loaded({ physicalPercent: 30, contractValue: null, receivedRevenue: null, moneyVisible: false, collectedPercent: 5, divergence: -25, status: 'WORK_AHEAD' }),
  );
  mocks.useCaptureProgressSnapshot.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
  mocks.useMilestones.mockReturnValue(
    loaded([
      { id: 'm1', status: 'VERIFIED' },
      { id: 'm2', status: 'PLANNED' },
      { id: 'm3', status: 'PLANNED' },
    ]),
  );
});

describe('PerformanceView — metrics', () => {
  it('without a locked baseline: dashes for planned and variance, and says so', () => {
    renderWithProviders(<PerformanceView projectId="p1" />, { permissions: ['view:project'] });

    const metrics = within(screen.getByLabelText('Progress against plan'));
    expect(metrics.getByText('30%')).toBeInTheDocument();
    expect(metrics.getByText(/Verified to/)).toBeInTheDocument();
    expect(metrics.getAllByText('—')).toHaveLength(2);
    expect(metrics.getAllByText('No planned baseline')).toHaveLength(2);
    expect(metrics.getByText('1 of 3')).toBeInTheDocument();
    // …and the curve says why there is no planned line.
    expect(screen.getByText(/No planned baseline is locked/)).toBeInTheDocument();
  });

  it('with a locked baseline: planned by today, variance in points, and "Behind plan" in the attention tone', () => {
    mocks.useProgrammeBaseline.mockReturnValue(
      loaded({
        version: 1,
        approvedAt: '2026-06-01T00:00:00.000Z',
        points: [
          { targetDate: daysFromToday(-100), cumulativePercent: 50 },
          { targetDate: daysFromToday(100), cumulativePercent: 50 },
        ],
      }),
    );
    renderWithProviders(<PerformanceView projectId="p1" />, { permissions: ['view:project'] });

    const strip = within(screen.getByLabelText('Progress against plan'));
    expect(strip.getByText('50%')).toBeInTheDocument();
    expect(strip.getByText('−20 pts')).toHaveClass('text-warning');
    expect(strip.getByText('Behind plan')).toHaveClass('text-warning');
    expect(strip.getByText(/Baseline/)).toBeInTheDocument();
  });
});

describe('PerformanceView — weights and plan start', () => {
  const lockedBehind = () =>
    mocks.useProgrammeBaseline.mockReturnValue(
      loaded({
        version: 1,
        approvedAt: '2026-06-01T00:00:00.000Z',
        points: [
          { targetDate: daysFromToday(-100), cumulativePercent: 50 },
          { targetDate: daysFromToday(100), cumulativePercent: 50 },
        ],
      }),
    );

  it('keeps variance neutral while weights are incomplete', () => {
    lockedBehind();
    const current = mocks.useProjectRollup() as { data: Record<string, unknown> };
    mocks.useProjectRollup.mockReturnValue(loaded({ ...current.data, weightsComplete: false }));
    renderWithProviders(<PerformanceView projectId="p1" />, { permissions: ['view:project'] });

    const strip = within(screen.getByLabelText('Progress against plan'));
    expect(strip.getByText('−20 pts')).not.toHaveClass('text-warning');
    expect(strip.getByText('Behind plan')).not.toHaveClass('text-warning');
  });

  it('says "Plan not started" before the baseline\'s first point, not 0%', () => {
    mocks.useProgrammeBaseline.mockReturnValue(
      loaded({
        version: 1,
        approvedAt: '2026-06-01T00:00:00.000Z',
        points: [
          { targetDate: daysFromToday(10), cumulativePercent: 10 },
          { targetDate: daysFromToday(100), cumulativePercent: 100 },
        ],
      }),
    );
    renderWithProviders(<PerformanceView projectId="p1" />, { permissions: ['view:project'] });

    const strip = within(screen.getByLabelText('Progress against plan'));
    expect(strip.getAllByText('Plan not started')).toHaveLength(2);
    expect(strip.queryByText('0%')).not.toBeInTheDocument();
  });
});

describe('PerformanceView — packages and attention', () => {
  it('shows planned %, contribution in points, and lists packages behind plan', () => {
    renderWithProviders(<PerformanceView projectId="p1" />, { permissions: ['view:project'] });

    const table = screen.getByRole('table');
    expect(within(table).getByText('20 pts')).toBeInTheDocument(); // 0.4 × 50
    expect(within(table).getByText('6 pts')).toBeInTheDocument(); // 0.6 × 10
    expect(within(table).getByText('100%')).toHaveClass('text-warning');

    const rail = within(screen.getByRole('complementary'));
    expect(rail.getByText('1 package is behind plan')).toBeInTheDocument();
    expect(rail.getByText('WP-02 Frame: 10% done, 100% planned')).toBeInTheDocument();
  });

  it('never shows a money figure; a visible signal shows its ratios', () => {
    const { container } = renderWithProviders(<PerformanceView projectId="p1" />, {
      permissions: ['view:project'],
    });

    expect(container.textContent).not.toMatch(/\$|USD/);
    expect(screen.getByText('Built 30% · cost consumed 42%')).toBeInTheDocument();
    expect(screen.getByText('Collected 5% · built 30%')).toBeInTheDocument();
  });

  it('omits the money-derived items when the server hides them (HIDDEN) — no 0, no dash', () => {
    mocks.useProjectRollup.mockReturnValue(
      loaded({ physicalPercent: 30, weightsTotal: '1', weightsComplete: true, packages: [] }),
    );
    mocks.usePhysicalFinancialSignal.mockReturnValue(
      loaded({ physicalPercent: 30, actualCost: null, budgetTotal: null, moneyVisible: false, costConsumedPercent: null, divergence: null, status: 'HIDDEN', weightsComplete: true }),
    );
    mocks.useCollectionProgressSignal.mockReturnValue(
      loaded({ physicalPercent: 30, contractValue: null, receivedRevenue: null, moneyVisible: false, collectedPercent: null, divergence: null, status: 'HIDDEN', weightsComplete: true }),
    );
    renderWithProviders(<PerformanceView projectId="p1" />, { permissions: ['view:project'] });

    const rail = within(screen.getByRole('complementary'));
    expect(rail.queryByText('Built vs cost')).not.toBeInTheDocument();
    expect(rail.queryByText('Collected vs built')).not.toBeInTheDocument();
    expect(rail.queryByText(/cost consumed|Collected/)).not.toBeInTheDocument();
    expect(rail.getByText('Nothing needs attention.')).toBeInTheDocument();
  });

  it('leaves aligned or insufficient signals out, so nothing-needs-attention can show', () => {
    mocks.useProjectRollup.mockReturnValue(
      loaded({ physicalPercent: 30, weightsTotal: '1', weightsComplete: true, packages: [] }),
    );
    mocks.usePhysicalFinancialSignal.mockReturnValue(
      loaded({ physicalPercent: 30, actualCost: null, budgetTotal: null, moneyVisible: false, costConsumedPercent: 28, divergence: 2, status: 'ALIGNED', weightsComplete: true }),
    );
    mocks.useCollectionProgressSignal.mockReturnValue(
      loaded({ physicalPercent: 30, contractValue: null, receivedRevenue: null, moneyVisible: false, collectedPercent: null, divergence: null, status: 'INSUFFICIENT_DATA' }),
    );
    renderWithProviders(<PerformanceView projectId="p1" />, { permissions: ['view:project'] });

    const rail = within(screen.getByRole('complementary'));
    expect(rail.getByText('Nothing needs attention.')).toBeInTheDocument();
    expect(rail.queryByText('Built vs cost')).not.toBeInTheDocument();
    expect(rail.queryByText('Collected vs built')).not.toBeInTheDocument();
  });

  it('links the signals only for readers who can open their targets', () => {
    const { unmount } = renderWithProviders(<PerformanceView projectId="p1" />, { permissions: ['view:project'] });
    expect(screen.queryByRole('link', { name: 'Open Finance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Billing & collection' })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<PerformanceView projectId="p1" />, {
      permissions: ['view:project', 'view:financial-position', 'view:contract'],
    });
    expect(screen.getByRole('link', { name: 'Open Finance' })).toHaveAttribute('href', '/projects/p1/finance');
    expect(screen.getByRole('link', { name: 'Open Billing & collection' })).toHaveAttribute(
      'href',
      '/projects/p1/commercial/billing',
    );
  });

  it('offers Record snapshot only to setup managers; Export to everyone', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<PerformanceView projectId="p1" />, { permissions: ['view:project'] });
    await user.click(screen.getByRole('button', { name: 'More curve actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Export CSV' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Record snapshot…' })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<PerformanceView projectId="p1" />, { permissions: ['manage:project'] });
    await user.click(screen.getByRole('button', { name: 'More curve actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Record snapshot…' }));
    expect(await screen.findByRole('dialog', { name: 'Record a progress snapshot' })).toBeInTheDocument();
  });
});

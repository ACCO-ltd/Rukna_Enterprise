import { ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { ProgressService } from './progress.service.js';

/**
 * Round-2 Progress-over-time (BE-1) — captureSnapshot / getCurve / getPeriodComparison. The snapshot
 * freezes the live ADR-021 computations; the curve/status/variance math is the pure progress-curve
 * module (tested separately). These specs mock the repo to prove orchestration + tenancy + the
 * unique-per-period guard.
 */
const identity = { userId: 'u1', activeOrganizationId: 'o1' } as never;

interface SnapshotRow {
  id: string;
  projectId: string;
  periodEndDate: Date;
  accountingPeriodId: string | null;
  physicalPercent: Decimal;
  verifiedPercent: Decimal;
  costConsumedPercent: Decimal | null;
  source: string;
  capturedAt: Date;
  capturedById: string;
}

function build(
  over: {
    snapshots?: SnapshotRow[];
    existingForPeriod?: { id: string } | null;
    projectDates?: { startDate: Date | null; expectedEndDate: Date | null } | null;
    // The approved planned-progress curve (CONST-PROG-011). Empty ⇒ provisional Option-C baseline.
    targets?: Array<{ targetDate: Date; cumulativePercent: Decimal }>;
    // Drives getRollup (weighted physical) + getProjectProgress (verified per leaf).
    workPackages?: unknown[];
    approvedMeasurements?: unknown[];
    // Drives getPhysicalFinancialSignal cost read.
    financialPosition?: { actualCost: string; forecastCost: string };
  } = {},
) {
  const created: SnapshotRow[] = [];
  const repo = {
    findWorkPackages: jest.fn().mockResolvedValue(over.workPackages ?? []),
    approvedMeasurementsForProject: jest.fn().mockResolvedValue(over.approvedMeasurements ?? []),
    findSnapshotForPeriod: jest.fn().mockResolvedValue(over.existingForPeriod ?? null),
    findSnapshotsForProject: jest.fn().mockResolvedValue(over.snapshots ?? []),
    findTargets: jest.fn().mockResolvedValue(over.targets ?? []),
    findProjectDates: jest
      .fn()
      .mockResolvedValue(over.projectDates === undefined ? null : over.projectDates),
    createSnapshot: jest.fn().mockImplementation((_p, data) => {
      const row: SnapshotRow = {
        id: 'snap1',
        projectId: data.projectId,
        periodEndDate: data.periodEndDate,
        accountingPeriodId: data.accountingPeriodId ?? null,
        physicalPercent: data.physicalPercent,
        verifiedPercent: data.verifiedPercent,
        costConsumedPercent: data.costConsumedPercent ?? null,
        source: data.source,
        capturedAt: new Date('2026-08-26T10:00:00.000Z'),
        capturedById: data.capturedById,
      };
      created.push(row);
      return Promise.resolve(row);
    }),
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  const financialPosition = {
    getForProject: jest
      .fn()
      .mockResolvedValue(over.financialPosition ?? { actualCost: '0', forecastCost: '0' }),
  };
  const svc = new ProgressService(
    { getClient: () => ({}) } as never,
    repo as never,
    projectAccess as never,
    financialPosition as never,
    {} as never,
  );
  return { svc, repo, projectAccess, created };
}

const snap = (
  id: string,
  periodEndDate: string,
  physical: number,
  verified: number,
  cost: number | null = null,
): SnapshotRow => ({
  id,
  projectId: 'p1',
  periodEndDate: new Date(`${periodEndDate}T00:00:00.000Z`),
  accountingPeriodId: null,
  physicalPercent: new Decimal(physical),
  verifiedPercent: new Decimal(verified),
  costConsumedPercent: cost === null ? null : new Decimal(cost),
  source: 'MANUAL',
  capturedAt: new Date('2026-08-26T10:00:00.000Z'),
  capturedById: 'u1',
});

describe('ProgressService.captureSnapshot (BE-1)', () => {
  it('persists a MANUAL snapshot at the supplied period-end date (never the clock)', async () => {
    const { svc, repo, created } = build({
      financialPosition: { actualCost: '0', forecastCost: '0' },
    });
    const res = await svc.captureSnapshot(identity, 'p1', '2026-08-31');

    expect(repo.createSnapshot).toHaveBeenCalledTimes(1);
    expect(created[0].source).toBe('MANUAL');
    expect(created[0].capturedById).toBe('u1');
    // The stored date is the supplied "as of", normalised to the calendar date.
    expect(created[0].periodEndDate.toISOString().slice(0, 10)).toBe('2026-08-31');
    expect(res.periodEndDate).toBe('2026-08-31');
    expect(res.source).toBe('MANUAL');
    // No cost data (forecast 0) → costConsumedPercent null.
    expect(res.costConsumedPercent).toBeNull();
  });

  it('carries the tenant org id into the write', async () => {
    const { svc, repo } = build();
    await svc.captureSnapshot(identity, 'p1', '2026-08-31');
    expect(repo.createSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'o1', projectId: 'p1' }),
    );
  });

  it('rejects a second snapshot for the same period (409)', async () => {
    const { svc } = build({ existingForPeriod: { id: 'snap0' } });
    await expect(svc.captureSnapshot(identity, 'p1', '2026-08-31')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('freezes the live cost-consumed % from the physical-financial signal', async () => {
    const { svc } = build({ financialPosition: { actualCost: '40', forecastCost: '100' } });
    const res = await svc.captureSnapshot(identity, 'p1', '2026-08-31');
    expect(res.costConsumedPercent).toBe(40);
  });
});

describe('ProgressService.getCurve (BE-1)', () => {
  it('returns baseline + actual + status when the project has dates and snapshots', async () => {
    const { svc } = build({
      snapshots: [snap('s1', '2026-04-01', 10, 8), snap('s2', '2026-07-02', 20, 18)],
      projectDates: { startDate: new Date('2026-01-01'), expectedEndDate: new Date('2026-12-31') },
    });
    const curve = await svc.getCurve(identity, 'p1');
    expect(curve.actual).toHaveLength(2);
    expect(curve.baseline).toHaveLength(2); // sampled at the two snapshot dates
    expect(curve.baselineProvisional).toBe(true);
    // Mid-year planned ≈ 50, actual 20 → BEHIND.
    expect(curve.status).toBe('BEHIND');
    expect(curve.scheduleVariancePercent).toBeLessThan(0);
  });

  it('uses the entered target curve (un-provisional) when a baseline is set', async () => {
    const { svc } = build({
      snapshots: [snap('s1', '2026-06-30', 20, 18)],
      projectDates: { startDate: new Date('2026-01-01'), expectedEndDate: new Date('2026-12-31') },
      targets: [
        { targetDate: new Date('2026-03-31'), cumulativePercent: new Decimal(10) },
        { targetDate: new Date('2026-09-30'), cumulativePercent: new Decimal(60) },
      ],
    });
    const curve = await svc.getCurve(identity, 'p1');
    // Planned line is the entered plan, not the snapshot-sampled ramp.
    expect(curve.baselineProvisional).toBe(false);
    expect(curve.baseline).toEqual([
      { periodEndDate: '2026-03-31', plannedPercent: 10 },
      { periodEndDate: '2026-09-30', plannedPercent: 60 },
    ]);
    // Planned at 2026-06-30 interpolates to ≈ 34.9; actual physical 20 → BEHIND.
    expect(curve.status).toBe('BEHIND');
    expect(curve.scheduleVariancePercent).toBeLessThan(0);
  });

  it('INSUFFICIENT_DATA with an empty baseline when the project has no dates', async () => {
    const { svc } = build({
      snapshots: [snap('s1', '2026-07-02', 20, 18)],
      projectDates: { startDate: null, expectedEndDate: null },
    });
    const curve = await svc.getCurve(identity, 'p1');
    expect(curve.baseline).toEqual([]);
    expect(curve.status).toBe('INSUFFICIENT_DATA');
    expect(curve.scheduleVariancePercent).toBeNull();
  });

  it('INSUFFICIENT_DATA when there are no snapshots', async () => {
    const { svc } = build({
      snapshots: [],
      projectDates: { startDate: new Date('2026-01-01'), expectedEndDate: new Date('2026-12-31') },
    });
    const curve = await svc.getCurve(identity, 'p1');
    expect(curve.actual).toEqual([]);
    expect(curve.status).toBe('INSUFFICIENT_DATA');
  });
});

describe('ProgressService.getPeriodComparison (BE-1)', () => {
  it('null/insufficient when fewer than two snapshots', async () => {
    const { svc } = build({ snapshots: [snap('s1', '2026-07-02', 20, 18)] });
    const cmp = await svc.getPeriodComparison(identity, 'p1');
    expect(cmp.physical).toBeNull();
    expect(cmp.verified).toBeNull();
    expect(cmp.previousPeriodEndDate).toBe('2026-07-02');
    expect(cmp.currentPeriodEndDate).toBeNull();
  });

  it('computes deltas from the two most-recent snapshots', async () => {
    const { svc } = build({
      snapshots: [
        snap('s1', '2026-05-31', 10, 8),
        snap('s2', '2026-06-30', 22, 20),
        snap('s3', '2026-07-31', 35, 30),
      ],
    });
    const cmp = await svc.getPeriodComparison(identity, 'p1');
    expect(cmp.previousPeriodEndDate).toBe('2026-06-30');
    expect(cmp.currentPeriodEndDate).toBe('2026-07-31');
    expect(cmp.physical).toEqual({ previous: 22, current: 35, delta: 13 });
    expect(cmp.verified).toEqual({ previous: 20, current: 30, delta: 10 });
  });
});

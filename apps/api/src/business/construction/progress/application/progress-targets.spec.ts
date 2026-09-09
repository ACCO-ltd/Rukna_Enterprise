import { BadRequestException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { ProgressService } from './progress.service.js';

/**
 * ADR-021 CONST-PROG-011 — the planned baseline curve + schedule variance. setTargets validates the
 * curve (0–100, unique dates, non-decreasing); getScheduleVariance compares the interpolated
 * planned-today % against the verified physical roll-up.
 *
 * Master Schedule P3 (ADR-029): the planned side now resolves through resolvePlannedCurve — the
 * governing frozen ProgrammeBaseline first, then the live targets, then the provisional ramp — and
 * setTargets is locked once a baseline is approved (the plan then moves by re-baseline).
 */
const identity = { userId: 'u1', activeOrganizationId: 'o1' } as never;

/** The file lifecycle seam: attaching evidence binds it, approving the report freezes it. */
function files() {
  return {
    bind: jest.fn().mockResolvedValue(undefined),
    markImmutable: jest.fn().mockResolvedValue(undefined),
    markManyImmutable: jest.fn().mockResolvedValue(0),
  };
}

function build(
  over: {
    targets?: { targetDate: Date; cumulativePercent: unknown }[];
    projectDates?: { startDate: Date | null; expectedEndDate: Date | null } | null;
    // The governing (APPROVED) ProgrammeBaseline, if one exists (P3). Its `points` are the frozen curve.
    governingBaseline?: {
      version: number;
      points: { targetDate: Date; cumulativePercent: Decimal }[];
    } | null;
  } = {},
) {
  const captured: { created?: unknown[] } = {};
  const prisma = {
    $transaction: async (cb: (tx: unknown) => unknown) => cb(prisma),
  };
  const repo = {
    findTargets: jest.fn().mockResolvedValue(over.targets ?? []),
    deleteTargetsForProject: jest.fn().mockResolvedValue({ count: 0 }),
    createTargets: jest.fn().mockImplementation((_p, rows) => {
      captured.created = rows;
      return Promise.resolve({ count: rows.length });
    }),
    // getRollup path — no work packages ⇒ physicalPercent 0
    findWorkPackages: jest.fn().mockResolvedValue([]),
    findLeafValues: jest.fn().mockResolvedValue([]),
    approvedMeasurementsForProject: jest.fn().mockResolvedValue([]),
    approvedReportDatesForLeaves: jest.fn().mockResolvedValue([]),
    // P3: the provisional-ramp fallback reads the project's start/end dates.
    findProjectDates: jest
      .fn()
      .mockResolvedValue(over.projectDates === undefined ? null : over.projectDates),
  };
  // P3: the governing frozen baseline lives behind its own repo; null ⇒ the live targets govern.
  const baselineRepo = {
    findApproved: jest.fn().mockResolvedValue(over.governingBaseline ?? null),
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  const svc = new ProgressService(
    { getClient: () => prisma } as never,
    repo as never,
    projectAccess as never,
    {} as never, // financialPosition — not used here
    {} as never, // commandGovernance — not used here
    files() as never,
    baselineRepo as never,
  );
  return { svc, repo, baselineRepo, captured };
}

const T = (date: string, pct: number) => ({ targetDate: new Date(date), cumulativePercent: new Decimal(pct) });

describe('ProgressService — planned targets (ADR-021 CONST-PROG-011)', () => {
  it('setTargets rejects a decreasing curve', async () => {
    const { svc } = build();
    await expect(
      svc.setTargets(identity, 'p1', [
        { targetDate: '2026-09-30', cumulativePercent: 40 },
        { targetDate: '2026-10-31', cumulativePercent: 30 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('setTargets rejects a percent outside 0–100', async () => {
    const { svc } = build();
    await expect(
      svc.setTargets(identity, 'p1', [{ targetDate: '2026-09-30', cumulativePercent: 120 }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('setTargets rejects duplicate dates', async () => {
    const { svc } = build();
    await expect(
      svc.setTargets(identity, 'p1', [
        { targetDate: '2026-09-30', cumulativePercent: 10 },
        { targetDate: '2026-09-30', cumulativePercent: 20 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('setTargets replaces the curve, sorted by date', async () => {
    const { svc, repo, captured } = build();
    await svc.setTargets(identity, 'p1', [
      { targetDate: '2026-10-31', cumulativePercent: 50 },
      { targetDate: '2026-09-30', cumulativePercent: 25 },
    ]);
    expect(repo.deleteTargetsForProject).toHaveBeenCalledWith(expect.anything(), 'p1');
    const rows = captured.created as Array<{ cumulativePercent: Decimal }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].cumulativePercent.equals(new Decimal(25))).toBe(true); // earliest first
  });

  // ── Master Schedule P3 (ADR-029): the working curve locks once a baseline is approved ──

  it('setTargets is rejected (409) once a governing baseline is approved — plan moves by re-baseline', async () => {
    const { svc, repo } = build({
      governingBaseline: { version: 1, points: [T('2026-09-30', 40)] },
    });
    await expect(
      svc.setTargets(identity, 'p1', [{ targetDate: '2026-09-30', cumulativePercent: 50 }]),
    ).rejects.toBeInstanceOf(ConflictException);
    // The curve is never touched while a baseline governs.
    expect(repo.deleteTargetsForProject).not.toHaveBeenCalled();
    expect(repo.createTargets).not.toHaveBeenCalled();
  });

  it('setTargets still edits the working curve before the first baseline is approved', async () => {
    const { svc, repo } = build({ governingBaseline: null });
    await svc.setTargets(identity, 'p1', [{ targetDate: '2026-09-30', cumulativePercent: 25 }]);
    expect(repo.deleteTargetsForProject).toHaveBeenCalledWith(expect.anything(), 'p1');
    expect(repo.createTargets).toHaveBeenCalled();
  });
});

describe('ProgressService.getScheduleVariance (ADR-021 CONST-PROG-011)', () => {
  it('returns null planned + INSUFFICIENT_DATA when no baseline curve is set', async () => {
    const { svc } = build({ targets: [] });
    const r = await svc.getScheduleVariance(identity, 'p1', '2026-10-15');
    expect(r.plannedPercent).toBeNull();
    expect(r.status).toBe('INSUFFICIENT_DATA');
  });

  it('interpolates planned-today and flags BEHIND_SCHEDULE when verified lags', async () => {
    // Curve: 0% by Sep 30 → 100% by Oct 30. As of Oct 15 (≈ midpoint) planned ≈ 50%.
    const { svc } = build({ targets: [T('2026-09-30', 0), T('2026-10-30', 100)] });
    const r = await svc.getScheduleVariance(identity, 'p1', '2026-10-15');
    expect(r.plannedPercent).toBeGreaterThan(45);
    expect(r.plannedPercent).toBeLessThan(55);
    expect(r.physicalPercent).toBe(0); // no work packages ⇒ 0 verified
    expect(r.status).toBe('BEHIND_SCHEDULE'); // 0 − ~50 < −20pp
  });

  it('planned is 0 before the first target date', async () => {
    const { svc } = build({ targets: [T('2026-12-31', 100)] });
    const r = await svc.getScheduleVariance(identity, 'p1', '2026-06-01');
    expect(r.plannedPercent).toBe(0);
  });

  it('planned clamps to the last target after the curve ends', async () => {
    const { svc } = build({ targets: [T('2026-09-30', 80)] });
    const r = await svc.getScheduleVariance(identity, 'p1', '2027-01-01');
    expect(r.plannedPercent).toBe(80);
  });

  it('measures against the governing baseline snapshot, not the live targets (P3)', async () => {
    // The live targets say 0% due at 2026-10-15; the frozen baseline says 100% by then. The variance
    // engine must read the frozen plan, so planned ≈ 50 at the midpoint — not the drifted live curve.
    const { svc, repo } = build({
      targets: [T('2026-09-30', 0), T('2026-10-30', 0)], // drifted-flat live curve
      governingBaseline: {
        version: 2,
        points: [T('2026-09-30', 0), T('2026-10-30', 100)],
      },
    });
    const r = await svc.getScheduleVariance(identity, 'p1', '2026-10-15');
    expect(r.plannedPercent).toBeGreaterThan(45);
    expect(r.plannedPercent).toBeLessThan(55);
    // The live targets were never consulted for the planned side.
    expect(repo.findTargets).not.toHaveBeenCalled();
  });
});

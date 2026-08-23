import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { ProgressService } from './progress.service.js';

/**
 * ADR-021 CONST-PROG-011 — the planned baseline curve + schedule variance. setTargets validates the
 * curve (0–100, unique dates, non-decreasing); getScheduleVariance compares the interpolated
 * planned-today % against the verified physical roll-up.
 */
const identity = { userId: 'u1', activeOrganizationId: 'o1' } as never;

function build(over: { targets?: { targetDate: Date; cumulativePercent: unknown }[] } = {}) {
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
    approvedMeasurementsForProject: jest.fn().mockResolvedValue([]),
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  const svc = new ProgressService(
    { getClient: () => prisma } as never,
    repo as never,
    projectAccess as never,
    {} as never, // financialPosition — not used here
    {} as never, // commandGovernance — not used here
  );
  return { svc, repo, captured };
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
});

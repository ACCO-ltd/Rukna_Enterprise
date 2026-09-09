import { BadRequestException, ConflictException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { ProgressService } from './progress.service.js';
import { ACCO_STANDARD_BUILDING_PHASES } from '../domain/schedule-templates.js';

/**
 * Master Schedule P1-d (ADR-029): the guided schedule builder's two backend helpers.
 * `applyScheduleTemplate` seeds the ACCO standard phases as work packages in one transaction (409 if
 * the project already has any); `suggestWeights` derives each package's weight from its assigned BOQ
 * value (scheduleOnly / no-scope → 0; all-unpriced → 0 with no ÷0).
 */
const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

function files() {
  return {
    bind: jest.fn().mockResolvedValue(undefined),
    markImmutable: jest.fn().mockResolvedValue(undefined),
    markManyImmutable: jest.fn().mockResolvedValue(0),
  };
}

type Over = {
  existingCount?: number;
  workPackages?: unknown[];
  leafValues?: unknown[];
};

function build(over: Over = {}) {
  // A $transaction that runs the callback against the same client (mirrors progress-targets.spec).
  const prisma = {
    $transaction: async (cb: (tx: unknown) => unknown) => cb(prisma),
  };
  let seq = 0;
  const repo = {
    countWorkPackages: jest.fn().mockResolvedValue(over.existingCount ?? 0),
    // Echo back a created row shaped like the Prisma model the response maps from.
    createWorkPackage: jest.fn().mockImplementation((_tx, data) => {
      seq += 1;
      return Promise.resolve({
        id: `wp-${seq}`,
        code: data.code,
        name: data.name,
        durationDays: data.durationDays ?? null,
        scheduleOnly: data.scheduleOnly ?? false,
      });
    }),
    findWorkPackages: jest.fn().mockResolvedValue(over.workPackages ?? []),
    findLeafValues: jest.fn().mockResolvedValue(over.leafValues ?? []),
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  // Master Schedule P3 (ADR-029): the baseline repo — unused by the template path, no baseline here.
  const baselineRepo = { findApproved: jest.fn().mockResolvedValue(null) };
  const service = new ProgressService(
    { getClient: () => prisma } as never,
    repo as never,
    projectAccess as never,
    {} as never, // financialPosition — unused here
    {} as never, // commandGovernance — unused here
    files() as never,
    baselineRepo as never,
  );
  return { repo, service };
}

describe('ProgressService.applyScheduleTemplate (Master Schedule P1-d)', () => {
  it('creates the nine standard phases in order with the right scheduleOnly / durationDays', async () => {
    const { repo, service } = build();

    const res = await service.applyScheduleTemplate(identity, 'p-1', 'ACCO_STANDARD_BUILDING');

    expect(repo.createWorkPackage).toHaveBeenCalledTimes(9);
    expect(res.workPackages).toHaveLength(9);

    // Codes are auto-numbered WP-01…WP-09 in template order.
    expect(res.workPackages.map((w) => w.code)).toEqual([
      'WP-01', 'WP-02', 'WP-03', 'WP-04', 'WP-05', 'WP-06', 'WP-07', 'WP-08', 'WP-09',
    ]);

    // Names, durations and scheduleOnly track the template exactly, in order.
    expect(res.workPackages.map((w) => w.name)).toEqual(
      ACCO_STANDARD_BUILDING_PHASES.map((p) => p.name),
    );
    expect(res.workPackages.map((w) => w.durationDays)).toEqual(
      ACCO_STANDARD_BUILDING_PHASES.map((p) => p.durationDays),
    );
    expect(res.workPackages.map((w) => w.scheduleOnly)).toEqual(
      ACCO_STANDARD_BUILDING_PHASES.map((p) => p.scheduleOnly),
    );

    // First two phases are non-measurable (Design, Mobilization); the rest are measurable.
    expect(res.workPackages[0].scheduleOnly).toBe(true);
    expect(res.workPackages[1].scheduleOnly).toBe(true);
    expect(res.workPackages[2].scheduleOnly).toBe(false);

    // Durations from the ticket: 7 / 7 / 21 / 30…
    expect(res.workPackages[0].durationDays).toBe(7);
    expect(res.workPackages[2].durationDays).toBe(21);
    expect(res.workPackages[3].durationDays).toBe(30);
  });

  it('seeds progressWeight 0 and leaves planned dates unset (the wizard fills those later)', async () => {
    const { repo, service } = build();
    await service.applyScheduleTemplate(identity, 'p-1', 'ACCO_STANDARD_BUILDING');
    // Every created row carries weight 0 and no planned dates.
    for (const call of repo.createWorkPackage.mock.calls) {
      const data = call[1] as Record<string, unknown>;
      expect(data.progressWeight).toBe(0);
      expect(data.plannedStart).toBeUndefined();
      expect(data.plannedEnd).toBeUndefined();
      expect(data.projectId).toBe('p-1');
      expect(data.createdBy).toBe('user-1');
    }
  });

  it('409s when the project already has work packages (does not duplicate)', async () => {
    const { repo, service } = build({ existingCount: 3 });
    await expect(
      service.applyScheduleTemplate(identity, 'p-1', 'ACCO_STANDARD_BUILDING'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.createWorkPackage).not.toHaveBeenCalled();
  });

  it('rejects an unknown template key', async () => {
    const { repo, service } = build();
    await expect(
      service.applyScheduleTemplate(identity, 'p-1', 'NOT_A_TEMPLATE' as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createWorkPackage).not.toHaveBeenCalled();
  });
});

describe('ProgressService.suggestWeights (Master Schedule P1-d)', () => {
  it('suggests each package weight as its BOQ value share, summing to ~1.0', async () => {
    const { service } = build({
      workPackages: [
        { id: 'a', scheduleOnly: false, boqLinks: [{ boqNodeId: 'n1' }, { boqNodeId: 'n2' }] },
        { id: 'b', scheduleOnly: false, boqLinks: [{ boqNodeId: 'n3' }] },
      ],
      leafValues: [
        { id: 'n1', totalAmount: '200000.00' },
        { id: 'n2', totalAmount: '100000.00' }, // a = 300,000
        { id: 'n3', totalAmount: '100000.00' }, // b = 100,000; total = 400,000
      ],
    });
    const res = await service.suggestWeights(identity, 'p-1');
    const byId = new Map(res.weights.map((w) => [w.workPackageId, w.suggestedWeight]));
    expect(byId.get('a')).toBeCloseTo(0.75, 6); // 300k / 400k
    expect(byId.get('b')).toBeCloseTo(0.25, 6); // 100k / 400k
    const sum = res.weights.reduce((s, w) => s + w.suggestedWeight, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it('suggests 0 for a scheduleOnly phase and does not count it in the denominator', async () => {
    const { service } = build({
      workPackages: [
        { id: 'mob', scheduleOnly: true, boqLinks: [] },
        { id: 'exc', scheduleOnly: false, boqLinks: [{ boqNodeId: 'n1' }] },
        { id: 'str', scheduleOnly: false, boqLinks: [{ boqNodeId: 'n2' }] },
      ],
      leafValues: [
        { id: 'n1', totalAmount: '100000.00' },
        { id: 'n2', totalAmount: '300000.00' },
      ],
    });
    const res = await service.suggestWeights(identity, 'p-1');
    const byId = new Map(res.weights.map((w) => [w.workPackageId, w.suggestedWeight]));
    expect(byId.get('mob')).toBe(0);
    expect(byId.get('exc')).toBeCloseTo(0.25, 6); // 100k / 400k (mob excluded)
    expect(byId.get('str')).toBeCloseTo(0.75, 6); // 300k / 400k
    // Measurable packages still reconcile to 1.0 on their own.
    expect((byId.get('exc') ?? 0) + (byId.get('str') ?? 0)).toBeCloseTo(1.0, 6);
  });

  it('suggests 0 for a package with no assigned scope', async () => {
    const { service } = build({
      workPackages: [
        { id: 'a', scheduleOnly: false, boqLinks: [{ boqNodeId: 'n1' }] },
        { id: 'empty', scheduleOnly: false, boqLinks: [] },
      ],
      leafValues: [{ id: 'n1', totalAmount: '100000.00' }],
    });
    const res = await service.suggestWeights(identity, 'p-1');
    const byId = new Map(res.weights.map((w) => [w.workPackageId, w.suggestedWeight]));
    expect(byId.get('empty')).toBe(0);
    expect(byId.get('a')).toBeCloseTo(1.0, 6);
  });

  it('suggests 0 everywhere when nothing carries a value (all-unpriced / zero-total, no ÷0)', async () => {
    const { service } = build({
      workPackages: [
        { id: 'a', scheduleOnly: false, boqLinks: [{ boqNodeId: 'n1' }] },
        { id: 'b', scheduleOnly: false, boqLinks: [{ boqNodeId: 'n2' }] },
      ],
      leafValues: [
        { id: 'n1', totalAmount: null },
        { id: 'n2', totalAmount: null },
      ],
    });
    const res = await service.suggestWeights(identity, 'p-1');
    expect(res.weights).toHaveLength(2);
    for (const w of res.weights) {
      expect(w.suggestedWeight).toBe(0);
      expect(Number.isFinite(w.suggestedWeight)).toBe(true);
    }
  });

  it('returns an empty weights list for a project with no work packages', async () => {
    const { service } = build({ workPackages: [], leafValues: [] });
    const res = await service.suggestWeights(identity, 'p-1');
    expect(res.weights).toEqual([]);
    expect(res.projectId).toBe('p-1');
  });
});

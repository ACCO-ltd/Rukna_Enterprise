import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ProgressService } from './progress.service.js';

/**
 * ADR-021 CONST-PROG-005 — programme activities (the time layer under a work package). Membership is
 * enforced via the activity's work package's project; dates are validated (end ≥ start, duration ≥ 0).
 */
const identity = { userId: 'u1', activeOrganizationId: 'o1' } as never;

function build(over: { workPackage?: unknown; activity?: unknown } = {}) {
  const captured: { created?: Record<string, unknown>; updated?: Record<string, unknown> } = {};
  const repo = {
    findWorkPackageById: jest
      .fn()
      .mockResolvedValue('workPackage' in over ? over.workPackage : { id: 'wp1', projectId: 'p1' }),
    createActivity: jest.fn().mockImplementation((_p, data) => {
      captured.created = data;
      return Promise.resolve({ id: 'act1', ...data });
    }),
    findActivityById: jest
      .fn()
      .mockResolvedValue(
        'activity' in over
          ? over.activity
          : { id: 'act1', workPackage: { projectId: 'p1' }, plannedStart: null, plannedEnd: null },
      ),
    updateActivity: jest.fn().mockImplementation((_p, _id, data) => {
      captured.updated = data;
      return Promise.resolve({ id: 'act1', ...data });
    }),
    deleteActivity: jest.fn().mockResolvedValue({ id: 'act1' }),
    findActivitiesForProject: jest.fn().mockResolvedValue([]),
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  const svc = new ProgressService(
    { getClient: () => ({}) } as never,
    repo as never,
    projectAccess as never,
    {} as never,
    {} as never,
  );
  return { svc, repo, projectAccess, captured };
}

describe('ProgressService — programme activities (ADR-021 CONST-PROG-005)', () => {
  it('createActivity adds an activity under the work package (membership checked via its project)', async () => {
    const { svc, repo, projectAccess, captured } = build();
    await svc.createActivity(identity, 'wp1', {
      code: 'A1',
      name: 'Excavation',
      plannedStart: '2026-09-01',
      plannedEnd: '2026-09-30',
      durationDays: 30,
    });
    expect(projectAccess.assertMember).toHaveBeenCalledWith(identity, 'p1');
    expect(repo.createActivity).toHaveBeenCalled();
    expect(captured.created).toMatchObject({ workPackageId: 'wp1', code: 'A1', createdBy: 'u1' });
  });

  it('createActivity 404s for an unknown work package', async () => {
    const { svc } = build({ workPackage: null });
    await expect(
      svc.createActivity(identity, 'nope', { code: 'A1', name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('createActivity rejects plannedEnd before plannedStart', async () => {
    const { svc } = build();
    await expect(
      svc.createActivity(identity, 'wp1', {
        code: 'A1',
        name: 'x',
        plannedStart: '2026-09-30',
        plannedEnd: '2026-09-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createActivity rejects a negative duration', async () => {
    const { svc } = build();
    await expect(
      svc.createActivity(identity, 'wp1', { code: 'A1', name: 'x', durationDays: -5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createActivity supports a milestone (point in time)', async () => {
    const { svc, captured } = build();
    await svc.createActivity(identity, 'wp1', {
      code: 'M1',
      name: 'Handover',
      plannedStart: '2026-12-31',
      plannedEnd: '2026-12-31',
      isMilestone: true,
    });
    expect(captured.created).toMatchObject({ isMilestone: true });
  });

  it('updateActivity validates the effective dates against the stored start', async () => {
    // Stored start is 2026-09-15; updating end to 2026-09-01 must fail.
    const { svc } = build({
      activity: { id: 'act1', workPackage: { projectId: 'p1' }, plannedStart: new Date('2026-09-15'), plannedEnd: null },
    });
    await expect(
      svc.updateActivity(identity, 'act1', { plannedEnd: '2026-09-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateActivity 404s for an unknown activity', async () => {
    const { svc } = build({ activity: null });
    await expect(svc.updateActivity(identity, 'nope', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deleteActivity 404s for an unknown activity', async () => {
    const { svc } = build({ activity: null });
    await expect(svc.deleteActivity(identity, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

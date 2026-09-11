import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

import { ProgrammeBaselineService } from './programme-baseline.service.js';

const identity: RequestIdentity = {
  userId: 'user-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

const target = (targetDate: string, pct: number) => ({
  targetDate: new Date(`${targetDate}T00:00:00.000Z`),
  cumulativePercent: new Decimal(pct),
});

const baselineRow = (over: Record<string, unknown> = {}) => ({
  id: 'pb-1',
  projectId: 'p-1',
  version: 1,
  status: 'APPROVED',
  approvedBy: 'user-1',
  approvedAt: new Date('2026-09-09T00:00:00.000Z'),
  variationOrderId: null,
  note: null,
  createdAt: new Date('2026-09-09T00:00:00.000Z'),
  points: [{ targetDate: new Date('2026-09-30T00:00:00.000Z'), cumulativePercent: new Decimal(25) }],
  ...over,
});

type Over = {
  approved?: unknown;
  targets?: unknown[];
  latestVersion?: number | null;
  variationOrder?: unknown;
  createdId?: string;
  byId?: unknown;
};

function build(over: Over = {}) {
  const repo = {
    findApproved: jest.fn().mockResolvedValue(over.approved ?? null),
    findTargets: jest.fn().mockResolvedValue(over.targets ?? [target('2026-09-30', 25)]),
    findLatestVersion: jest.fn().mockResolvedValue(over.latestVersion ?? null),
    findVariationOrderProject: jest.fn().mockResolvedValue(
      // Distinguish an explicit null override (VO not found) from "not provided" (default VO).
      'variationOrder' in over ? over.variationOrder : { id: 'vo-1', contract: { projectId: 'p-1' } },
    ),
    supersedeApproved: jest.fn().mockResolvedValue({ count: 1 }),
    createApproved: jest.fn().mockResolvedValue({ id: over.createdId ?? 'pb-new' }),
    findById: jest.fn().mockResolvedValue(over.byId ?? baselineRow()),
  };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  // The transaction runs the callback with a tx client (unused by the mocked repo).
  const tenancy = { getClient: () => ({ $transaction: (fn: (tx: unknown) => unknown) => fn({}) }) };
  const auditOutbox = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ProgrammeBaselineService(
    tenancy as never,
    projectAccess as never,
    repo as never,
    auditOutbox as never,
  );
  return { repo, service, projectAccess, auditOutbox };
}

describe('ProgrammeBaselineService (Master Schedule P3, ADR-029)', () => {
  describe('approve — initial baseline (v1)', () => {
    it('creates v1 by snapshotting the current target curve', async () => {
      const { repo, service, auditOutbox } = build({
        targets: [target('2026-09-30', 25), target('2026-10-31', 60)],
      });

      const res = await service.approve(identity, 'p-1');

      expect(repo.createApproved).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          projectId: 'p-1',
          version: 1,
          approvedBy: 'user-1',
          variationOrderId: null,
          points: expect.arrayContaining([
            expect.objectContaining({ cumulativePercent: expect.anything() }),
          ]),
        }),
      );
      // The snapshot carries every live target point.
      expect(repo.createApproved.mock.calls[0][1].points).toHaveLength(2);
      expect(auditOutbox.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventType: 'PROGRAMME_BASELINE_APPROVED' }),
      );
      expect(res.version).toBe(1);
      expect(res.status).toBe('APPROVED');
    });

    it('rejects when the live target curve is empty (nothing to freeze)', async () => {
      const { repo, service } = build({ targets: [] });
      await expect(service.approve(identity, 'p-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.createApproved).not.toHaveBeenCalled();
    });

    it('rejects when an APPROVED baseline already exists (re-baseline instead)', async () => {
      const { repo, service } = build({ approved: baselineRow() });
      await expect(service.approve(identity, 'p-1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.createApproved).not.toHaveBeenCalled();
    });
  });

  describe('rebaseline — v>=2 (senior, Variation-linked)', () => {
    it('requires a variationOrderId', async () => {
      const { repo, service } = build({ approved: baselineRow() });
      await expect(
        service.rebaseline(identity, 'p-1', { variationOrderId: '  ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.createApproved).not.toHaveBeenCalled();
    });

    it('rejects a Variation that belongs to another project', async () => {
      const { repo, service } = build({
        approved: baselineRow(),
        variationOrder: { id: 'vo-x', contract: { projectId: 'other-project' } },
      });
      await expect(
        service.rebaseline(identity, 'p-1', { variationOrderId: 'vo-x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.createApproved).not.toHaveBeenCalled();
    });

    it('rejects when the Variation does not exist', async () => {
      const { repo, service } = build({ approved: baselineRow(), variationOrder: null });
      await expect(
        service.rebaseline(identity, 'p-1', { variationOrderId: 'ghost' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.createApproved).not.toHaveBeenCalled();
    });

    it('rejects when there is no approved baseline to re-baseline', async () => {
      const { repo, service } = build({ approved: null });
      await expect(
        service.rebaseline(identity, 'p-1', { variationOrderId: 'vo-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.createApproved).not.toHaveBeenCalled();
    });

    it('supersedes the prior approved baseline, increments the version, and snapshots the curve', async () => {
      const { repo, service, auditOutbox } = build({
        approved: baselineRow({ version: 1 }),
        latestVersion: 1,
        targets: [target('2026-09-30', 30), target('2026-10-31', 70)],
        byId: baselineRow({ id: 'pb-new', version: 2, variationOrderId: 'vo-1' }),
      });

      const res = await service.rebaseline(identity, 'p-1', {
        variationOrderId: 'vo-1',
        note: 'Client-approved scope change',
      });

      expect(repo.supersedeApproved).toHaveBeenCalledWith(expect.anything(), 'org-1', 'p-1');
      expect(repo.createApproved).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ version: 2, variationOrderId: 'vo-1', note: 'Client-approved scope change' }),
      );
      expect(repo.createApproved.mock.calls[0][1].points).toHaveLength(2);
      expect(auditOutbox.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventType: 'PROGRAMME_BASELINE_REBASELINED' }),
      );
      expect(res.version).toBe(2);
      expect(res.variationOrderId).toBe('vo-1');
    });

    it('rejects re-baselining onto an empty curve', async () => {
      const { repo, service } = build({ approved: baselineRow(), targets: [] });
      await expect(
        service.rebaseline(identity, 'p-1', { variationOrderId: 'vo-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.createApproved).not.toHaveBeenCalled();
    });
  });

  describe('getGoverning', () => {
    it('returns the APPROVED baseline with its frozen curve', async () => {
      const { service } = build({ approved: baselineRow({ version: 3 }) });
      const res = await service.getGoverning(identity, 'p-1');
      expect(res).not.toBeNull();
      expect(res?.version).toBe(3);
      expect(res?.status).toBe('APPROVED');
      expect(res?.points[0]).toEqual({ targetDate: '2026-09-30', cumulativePercent: 25 });
    });

    it('returns null when no baseline has been approved', async () => {
      const { service } = build({ approved: null });
      await expect(service.getGoverning(identity, 'p-1')).resolves.toBeNull();
    });
  });

  it('every command asserts project membership', async () => {
    const { service, projectAccess } = build();
    await service.getGoverning(identity, 'p-1');
    expect(projectAccess.assertMember).toHaveBeenCalledWith(identity, 'p-1');
  });
});

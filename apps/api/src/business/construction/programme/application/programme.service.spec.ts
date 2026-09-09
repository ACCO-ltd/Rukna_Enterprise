import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import { ProgrammeService } from './programme.service.js';

const identity: RequestIdentity = {
  userId: 'u-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

function build(over: { milestone?: unknown; milestones?: unknown[] } = {}) {
  const milestone =
    'milestone' in over ? over.milestone : { id: 'ms-1', projectId: 'p-1', status: 'PLANNED' };
  const repo = {
    createMilestone: jest.fn().mockResolvedValue({ id: 'ms-1' }),
    findMilestones: jest.fn().mockResolvedValue(over.milestones ?? []),
    findMilestoneById: jest.fn().mockResolvedValue(milestone),
    verifyMilestone: jest.fn().mockResolvedValue({ id: 'ms-1', status: 'VERIFIED' }),
  };
  const tenancy = { getClient: () => ({}) };
  const projectAccess = { assertMember: jest.fn().mockResolvedValue(undefined) };
  const service = new ProgrammeService(tenancy as never, repo as never, projectAccess as never);
  return { repo, service };
}

// A stored milestone row as ProgrammeRepository.findMilestones returns it (Prisma Dates + Decimals).
// `Decimal` is emulated with a minimal stub — the mapper only calls `.toString()` on it.
function decimal(v: string) {
  return { toString: () => v };
}

function storedMilestone(over: Record<string, unknown> = {}) {
  return {
    id: 'ms-1',
    projectId: 'p-1',
    code: 'MS-01',
    name: 'Substructure complete',
    status: 'PLANNED',
    baselineDate: new Date('2026-10-01T00:00:00.000Z'),
    forecastDate: null,
    actualDate: null,
    sortOrder: 0,
    contractDeliverableId: null,
    verifiedBy: null,
    verifiedAt: null,
    installments: [],
    ...over,
  };
}

function releaseInstallment(over: Record<string, unknown> = {}) {
  return {
    id: 'inst-1',
    name: 'Substructure payment',
    percentage: decimal('0.3000'),
    triggerType: 'MILESTONE',
    contract: { contractValue: decimal('1000000.00'), currency: 'USD' },
    clientInvoice: null,
    ...over,
  };
}

describe('ProgrammeService (ADR-021 ph.2 milestones)', () => {
  it('createMilestone: creates a PLANNED milestone with a baseline date', async () => {
    const { repo, service } = build();
    await service.createMilestone(identity, 'p-1', {
      code: 'MS-01',
      name: 'Substructure complete',
      baselineDate: '2026-10-01',
    });
    expect(repo.createMilestone).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: 'p-1',
        code: 'MS-01',
        baselineDate: expect.any(Date),
        createdBy: 'u-1',
      }),
    );
  });

  it('verifyMilestone: verifies a PLANNED milestone with the actual date', async () => {
    const { repo, service } = build();
    await service.verifyMilestone(identity, 'ms-1', { actualDate: '2026-10-03' });
    expect(repo.verifyMilestone).toHaveBeenCalledWith(
      expect.anything(),
      'ms-1',
      expect.any(Date),
      'u-1',
    );
  });

  it('verifyMilestone: rejects a milestone that is not PLANNED', async () => {
    const { repo, service } = build({ milestone: { id: 'ms-1', projectId: 'p-1', status: 'VERIFIED' } });
    await expect(
      service.verifyMilestone(identity, 'ms-1', { actualDate: '2026-10-03' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.verifyMilestone).not.toHaveBeenCalled();
  });

  it('verifyMilestone: 404 when the milestone does not exist', async () => {
    const { service } = build({ milestone: null });
    await expect(
      service.verifyMilestone(identity, 'missing', { actualDate: '2026-10-03' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('listMilestones: milestone → payment-stage bridge (P2 releases)', () => {
    it('projects a linked installment: amount = value × percentage, triggerType, invoiced=false', async () => {
      const { service } = build({
        milestones: [storedMilestone({ installments: [releaseInstallment()] })],
      });

      const [milestone] = await service.listMilestones(identity, 'p-1');

      expect(milestone.releases).toEqual([
        {
          installmentId: 'inst-1',
          name: 'Substructure payment',
          percentage: '0.3000',
          triggerType: 'MILESTONE',
          amount: '300000.00', // 1,000,000 × 0.30
          currency: 'USD',
          invoiced: false,
        },
      ]);
    });

    it('invoiced=true when a ClientInvoice was generated from the installment', async () => {
      const { service } = build({
        milestones: [
          storedMilestone({
            installments: [releaseInstallment({ clientInvoice: { id: 'inv-1' } })],
          }),
        ],
      });

      const [milestone] = await service.listMilestones(identity, 'p-1');

      expect(milestone.releases).toHaveLength(1);
      expect(milestone.releases[0].invoiced).toBe(true);
    });

    it('a milestone with no linked installments → releases: []', async () => {
      const { service } = build({
        milestones: [storedMilestone({ installments: [] })],
      });

      const [milestone] = await service.listMilestones(identity, 'p-1');

      expect(milestone.releases).toEqual([]);
    });

    it('amount rounds to 2 decimals with Decimal (no float drift)', async () => {
      const { service } = build({
        milestones: [
          storedMilestone({
            installments: [
              // 33.33% of 100.10 = 33.36333 → 33.36; the trailing digits must not leak.
              releaseInstallment({
                id: 'inst-round',
                percentage: decimal('0.3333'),
                contract: { contractValue: decimal('100.10'), currency: 'USD' },
              }),
            ],
          }),
        ],
      });

      const [milestone] = await service.listMilestones(identity, 'p-1');

      expect(milestone.releases[0].amount).toBe('33.36');
    });

    it('preserves the repo order of releases across installments', async () => {
      const { service } = build({
        milestones: [
          storedMilestone({
            installments: [
              releaseInstallment({ id: 'a', name: 'Advance', triggerType: 'ADVANCE' }),
              releaseInstallment({ id: 'b', name: 'Balance', triggerType: 'TIME_BASED' }),
            ],
          }),
        ],
      });

      const [milestone] = await service.listMilestones(identity, 'p-1');

      expect(milestone.releases.map((r) => r.installmentId)).toEqual(['a', 'b']);
      expect(milestone.releases.map((r) => r.triggerType)).toEqual(['ADVANCE', 'TIME_BASED']);
    });
  });
});

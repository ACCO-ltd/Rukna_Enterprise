import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ProgrammeService } from './programme.service.js';

const identity: RequestIdentity = {
  userId: 'u-1',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [],
};

/** A caller with the commercial money tier (finance / exec): release amounts are visible. */
const financeIdentity: RequestIdentity = {
  ...identity,
  permissions: [PERMISSIONS.projectsView, PERMISSIONS.financialPositionView],
};

type BuildOver = {
  milestone?: unknown;
  milestones?: unknown[];
  workPackages?: unknown[];
  leaves?: unknown[];
  verified?: unknown[];
};

function build(over: BuildOver = {}) {
  const milestone =
    'milestone' in over ? over.milestone : { id: 'ms-1', projectId: 'p-1', status: 'PLANNED' };
  const repo = {
    createMilestone: jest.fn().mockResolvedValue({ id: 'ms-1' }),
    findMilestones: jest.fn().mockResolvedValue(over.milestones ?? []),
    findMilestoneById: jest.fn().mockResolvedValue(milestone),
    verifyMilestone: jest.fn().mockResolvedValue({ id: 'ms-1', status: 'VERIFIED' }),
    findWorkPackagesForProject: jest.fn().mockResolvedValue(over.workPackages ?? []),
    replaceMilestoneWorkPackages: jest.fn().mockResolvedValue(undefined),
    lockMilestoneStatus: jest.fn().mockResolvedValue('PLANNED'),
    findLeafProgressInputs: jest
      .fn()
      .mockResolvedValue({ leaves: over.leaves ?? [], verified: over.verified ?? [] }),
  };
  // The transaction runs the callback with the same client (the mocked repo ignores it).
  const client = { $transaction: (fn: (tx: unknown) => unknown) => fn(client) };
  const tenancy = { getClient: () => client };
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
    workPackageLinks: [],
    ...over,
  };
}

/** A linked work package as the repo include selects it. */
function linkedPackage(id: string, leafIds: string[], over: Record<string, unknown> = {}) {
  return {
    workPackage: {
      id,
      code: id.toUpperCase(),
      name: `Package ${id}`,
      scheduleOnly: false,
      boqLinks: leafIds.map((boqNodeId) => ({ boqNodeId })),
      ...over,
    },
  };
}

/** A BOQ leaf as findLeafProgressInputs returns it. */
function leaf(id: string, quantity: string, totalAmount: string, nodeRole = 'WORK') {
  return { id, quantity: decimal(quantity), totalAmount: decimal(totalAmount), nodeRole };
}

function verifiedSum(boqNodeId: string, quantity: string) {
  return { boqNodeId, _sum: { quantity: decimal(quantity) } };
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

      const [milestone] = await service.listMilestones(financeIdentity, 'p-1');

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

      const [milestone] = await service.listMilestones(financeIdentity, 'p-1');

      expect(milestone.releases).toHaveLength(1);
      expect(milestone.releases[0].invoiced).toBe(true);
    });

    it('a milestone with no linked installments → releases: []', async () => {
      const { service } = build({
        milestones: [storedMilestone({ installments: [] })],
      });

      const [milestone] = await service.listMilestones(financeIdentity, 'p-1');

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

      const [milestone] = await service.listMilestones(financeIdentity, 'p-1');

      expect(milestone.releases[0].amount).toBe('33.36');
    });

    it('money-blind caller (PM / Site Engineer): amount is null, percentage and invoiced stay', async () => {
      const { service } = build({
        milestones: [
          storedMilestone({
            installments: [releaseInstallment({ clientInvoice: { id: 'inv-1' } })],
          }),
        ],
      });

      const [milestone] = await service.listMilestones(
        { ...identity, permissions: [PERMISSIONS.projectsView] },
        'p-1',
      );

      expect(milestone.releases[0]).toMatchObject({
        amount: null,
        percentage: '0.3000',
        currency: 'USD',
        invoiced: true,
      });
    });

    it('the cost tier alone (Construction Director) does not reveal release amounts', async () => {
      const { service } = build({
        milestones: [storedMilestone({ installments: [releaseInstallment()] })],
      });

      const [milestone] = await service.listMilestones(
        { ...identity, permissions: [PERMISSIONS.projectsView, PERMISSIONS.boqViewCost] },
        'p-1',
      );

      expect(milestone.releases[0].amount).toBeNull();
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

      const [milestone] = await service.listMilestones(financeIdentity, 'p-1');

      expect(milestone.releases.map((r) => r.installmentId)).toEqual(['a', 'b']);
      expect(milestone.releases.map((r) => r.triggerType)).toEqual(['ADVANCE', 'TIME_BASED']);
    });
  });

  // ── ADR-021 amendment (2026-09-28): milestone ↔ work packages + readiness ──────────────

  describe('listMilestones: linked work packages + readyToVerify', () => {
    it('reports each linked package with its value-weighted verified % (same maths as the roll-up)', async () => {
      const { service, repo } = build({
        milestones: [
          storedMilestone({ workPackageLinks: [linkedPackage('wp-a', ['l1', 'l2'])] }),
        ],
        // l1 is worth 900 and fully verified; l2 is worth 100 and untouched → 90%, not a 50% average.
        leaves: [leaf('l1', '10', '900'), leaf('l2', '10', '100')],
        verified: [verifiedSum('l1', '10')],
      });

      const [milestone] = await service.listMilestones(identity, 'p-1');

      expect(milestone.workPackages).toEqual([
        { id: 'wp-a', code: 'WP-A', name: 'Package wp-a', percentComplete: 90 },
      ]);
      expect(milestone.readyToVerify).toBe(false);
      expect(repo.findLeafProgressInputs).toHaveBeenCalledWith(
        expect.anything(),
        'org-1',
        'p-1',
        ['l1', 'l2'],
      );
    });

    it('is NOT readyToVerify at 199.1 of 200 even though the package displays 100%', async () => {
      const { service } = build({
        milestones: [storedMilestone({ workPackageLinks: [linkedPackage('wp-a', ['l1'])] })],
        leaves: [leaf('l1', '200', '1000')],
        verified: [verifiedSum('l1', '199.1')],
      });

      const [milestone] = await service.listMilestones(identity, 'p-1');

      expect(milestone.workPackages[0]!.percentComplete).toBe(100); // display rounds
      expect(milestone.readyToVerify).toBe(false); // readiness does not
    });

    it('is readyToVerify once every linked package reads 100%', async () => {
      const { service } = build({
        milestones: [
          storedMilestone({
            workPackageLinks: [linkedPackage('wp-a', ['l1']), linkedPackage('wp-b', ['l2'])],
          }),
        ],
        leaves: [leaf('l1', '10', '900'), leaf('l2', '4', '100')],
        verified: [verifiedSum('l1', '10'), verifiedSum('l2', '4')],
      });

      const [milestone] = await service.listMilestones(identity, 'p-1');

      expect(milestone.workPackages.map((wp) => wp.percentComplete)).toEqual([100, 100]);
      expect(milestone.readyToVerify).toBe(true);
    });

    it('drops a CONTINGENCY leaf from the weighting, exactly as the roll-up does', async () => {
      const { service } = build({
        milestones: [storedMilestone({ workPackageLinks: [linkedPackage('wp-a', ['l1', 'c1'])] })],
        leaves: [leaf('l1', '10', '100'), leaf('c1', '1', '10000', 'CONTINGENCY')],
        verified: [verifiedSum('l1', '10')],
      });

      const [milestone] = await service.listMilestones(identity, 'p-1');

      expect(milestone.workPackages[0]!.percentComplete).toBe(100);
    });

    it('is never ready with no packages linked, nor once VERIFIED', async () => {
      const { service } = build({
        milestones: [
          storedMilestone({ id: 'ms-empty' }),
          storedMilestone({
            id: 'ms-done',
            status: 'VERIFIED',
            workPackageLinks: [linkedPackage('wp-a', ['l1'])],
          }),
        ],
        leaves: [leaf('l1', '10', '100')],
        verified: [verifiedSum('l1', '10')],
      });

      const [empty, done] = await service.listMilestones(identity, 'p-1');

      expect(empty!.workPackages).toEqual([]);
      expect(empty!.readyToVerify).toBe(false);
      expect(done!.workPackages[0]!.percentComplete).toBe(100);
      expect(done!.readyToVerify).toBe(false);
    });
  });

  describe('createMilestone with workPackageIds', () => {
    it('validates the packages and creates the links in the same insert', async () => {
      const { service, repo } = build({
        workPackages: [
          { id: 'wp-a', code: 'WP-A', scheduleOnly: false },
          { id: 'wp-b', code: 'WP-B', scheduleOnly: false },
        ],
      });

      await service.createMilestone(identity, 'p-1', {
        code: 'MS-01',
        name: 'Substructure complete',
        baselineDate: '2026-10-01',
        workPackageIds: ['wp-a', 'wp-b', 'wp-a'],
      });

      expect(repo.findWorkPackagesForProject).toHaveBeenCalledWith(
        expect.anything(),
        'org-1',
        'p-1',
        ['wp-a', 'wp-b'],
      );
      expect(repo.createMilestone).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          workPackageLinks: {
            create: [
              { workPackageId: 'wp-a', createdBy: 'u-1' },
              { workPackageId: 'wp-b', createdBy: 'u-1' },
            ],
          },
        }),
      );
    });

    it('refuses a package from another project (or an unknown id)', async () => {
      const { service, repo } = build({ workPackages: [{ id: 'wp-a', code: 'WP-A', scheduleOnly: false }] });

      await expect(
        service.createMilestone(identity, 'p-1', {
          code: 'MS-01',
          name: 'x',
          baselineDate: '2026-10-01',
          workPackageIds: ['wp-a', 'wp-foreign'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.createMilestone).not.toHaveBeenCalled();
    });

    it('refuses a schedule-only phase — it can never read 100% verified', async () => {
      const { service, repo } = build({ workPackages: [{ id: 'wp-m', code: 'WP-MOB', scheduleOnly: true }] });

      await expect(
        service.createMilestone(identity, 'p-1', {
          code: 'MS-01',
          name: 'x',
          baselineDate: '2026-10-01',
          workPackageIds: ['wp-m'],
        }),
      ).rejects.toThrow(/WP-MOB is a schedule-only phase/);
      expect(repo.createMilestone).not.toHaveBeenCalled();
    });
  });

  describe('setMilestoneWorkPackages (PUT)', () => {
    it('replaces the set in a transaction and returns the recomputed read model', async () => {
      const { service, repo } = build({
        workPackages: [{ id: 'wp-a', code: 'WP-A', scheduleOnly: false }],
        milestones: [storedMilestone({ workPackageLinks: [linkedPackage('wp-a', ['l1'])] })],
        leaves: [leaf('l1', '10', '100')],
        verified: [verifiedSum('l1', '10')],
      });

      const res = await service.setMilestoneWorkPackages(identity, 'p-1', 'ms-1', ['wp-a']);

      expect(repo.replaceMilestoneWorkPackages).toHaveBeenCalledWith(
        expect.anything(),
        'ms-1',
        ['wp-a'],
        'u-1',
      );
      expect(repo.findMilestones).toHaveBeenCalledWith(expect.anything(), 'org-1', 'p-1', 'ms-1');
      expect(res.readyToVerify).toBe(true);
      expect(res.workPackages).toEqual([
        { id: 'wp-a', code: 'WP-A', name: 'Package wp-a', percentComplete: 100 },
      ]);
    });

    it('an empty list clears the set without looking up packages', async () => {
      const { service, repo } = build({ milestones: [storedMilestone()] });

      const res = await service.setMilestoneWorkPackages(identity, 'p-1', 'ms-1', []);

      expect(repo.findWorkPackagesForProject).not.toHaveBeenCalled();
      expect(repo.replaceMilestoneWorkPackages).toHaveBeenCalledWith(expect.anything(), 'ms-1', [], 'u-1');
      expect(res.readyToVerify).toBe(false);
    });

    it('refuses to change a VERIFIED milestone (409)', async () => {
      const { service, repo } = build({
        milestone: { id: 'ms-1', projectId: 'p-1', status: 'VERIFIED' },
      });

      await expect(
        service.setMilestoneWorkPackages(identity, 'p-1', 'ms-1', ['wp-a']),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.replaceMilestoneWorkPackages).not.toHaveBeenCalled();
    });

    it('re-checks under the row lock: a verify that landed first wins (409, no swap)', async () => {
      const { service, repo } = build({
        workPackages: [{ id: 'wp-a', code: 'WP-A', scheduleOnly: false }],
      });
      // Read outside the transaction said PLANNED; by the time the lock is taken it is VERIFIED.
      repo.lockMilestoneStatus.mockResolvedValue('VERIFIED');

      await expect(
        service.setMilestoneWorkPackages(identity, 'p-1', 'ms-1', ['wp-a']),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.lockMilestoneStatus).toHaveBeenCalledWith(expect.anything(), 'ms-1');
      expect(repo.replaceMilestoneWorkPackages).not.toHaveBeenCalled();
    });

    it('404 when the milestone belongs to another project', async () => {
      const { service, repo } = build({
        milestone: { id: 'ms-1', projectId: 'p-OTHER', status: 'PLANNED' },
      });

      await expect(
        service.setMilestoneWorkPackages(identity, 'p-1', 'ms-1', ['wp-a']),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.replaceMilestoneWorkPackages).not.toHaveBeenCalled();
    });

    it('refuses a package that is not on this project', async () => {
      const { service, repo } = build({ workPackages: [] });

      await expect(
        service.setMilestoneWorkPackages(identity, 'p-1', 'ms-1', ['wp-foreign']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.replaceMilestoneWorkPackages).not.toHaveBeenCalled();
    });
  });
});

import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { BoqPrismaRepository } from '../../boq/infrastructure/boq-prisma.repository.js';
import { BoqTreeService } from '../../boq/application/boq-tree.service.js';
import { BoqVersioningService } from '../../boq/application/boq-versioning.service.js';
import { ProgressRepository } from '../infrastructure/progress.repository.js';
import { ProgressService } from '../application/progress.service.js';

/**
 * CONST-PROG-002/009 under concurrency, against a real database: two SUBMITTED reports that each
 * fit a BOQ line on their own but together exceed it are approved at the same moment. The approve
 * transaction row-locks the BOQ line before re-reading the verified total, so exactly one wins and
 * the other is refused with DPR_EXCEEDS_BOQ_QUANTITY — the line can never end up over-verified.
 */
describe('DPR approve — over-quantity race (CONST-PROG-002/009) [DB]', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `dprr-org-${suffix}`;

  let approver: RequestIdentity;
  let projectId: string;
  let leafId: string;
  let service: ProgressService;
  let repo: ProgressRepository;
  const siteEngineer = (): RequestIdentity => ({ ...approver, userId: 'site-engineer' });

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: orgId, name: `DPR race ${suffix}`, slug: `dprr-${suffix}`, status: 'ACTIVE' },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        code: `PRJDR-${suffix}`,
        name: 'Race Project',
        currency: 'USD',
        createdBy: 'u1',
      },
    });
    projectId = project.id;
    approver = {
      userId: 'approver',
      activeOrganizationId: orgId,
      tenantSlug: `dprr-${suffix}`,
      roles: ['admin'],
      permissions: ['*'],
    };

    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const boqRepo = new BoqPrismaRepository();
    const tree = new BoqTreeService(tenancy, boqRepo);
    const gate = { gateStateTransition: jest.fn(async () => null) };
    const versioning = new BoqVersioningService(
      tenancy,
      boqRepo,
      gate as unknown as CommandGovernanceService,
    );
    const boq = await versioning.initialize(approver, projectId);
    const versionId = boq.versions[0]!.id;
    const section = await tree.addNode(approver, projectId, versionId, {
      code: '01',
      description: 'Substructure',
    });
    const leaf = await tree.addNode(approver, projectId, versionId, {
      parentId: section.id,
      code: '01.001',
      description: 'Concrete',
      isLeaf: true,
      unit: 'm3',
      quantity: '10.000',
      unitRate: '10.00',
    });
    leafId = leaf.id;

    repo = new ProgressRepository();
    service = new ProgressService(
      tenancy,
      repo,
      { assertMember: jest.fn(async () => undefined) } as never,
      {} as never, // financialPosition — unused
      gate as never,
      { markManyImmutable: jest.fn(async () => 0) } as never,
      { findApproved: jest.fn(async () => null) } as never,
    );
  });

  afterAll(async () => {
    await prisma.dailyProgressReport.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqChangeEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqNode.deleteMany({ where: { version: { boq: { organizationId: orgId } } } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  async function submittedReport(quantity: string): Promise<string> {
    const dpr = await prisma.dailyProgressReport.create({
      data: {
        organizationId: orgId,
        projectId,
        reportDate: new Date('2026-09-20'),
        status: 'SUBMITTED',
        preparedBy: 'site-engineer',
        submittedBy: 'site-engineer',
      },
    });
    await prisma.progressMeasurement.create({
      data: {
        organizationId: orgId,
        dprId: dpr.id,
        boqNodeId: leafId,
        quantity: new Prisma.Decimal(quantity),
        createdBy: 'site-engineer',
      },
    });
    return dpr.id;
  }

  it('two reports that together exceed the line: exactly one is approved', async () => {
    const [a, b] = await Promise.all([submittedReport('6'), submittedReport('6')]);

    const results = await Promise.allSettled([
      service.approve(approver, a),
      service.approve(approver, b),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason.getResponse()).toMatchObject({
      errorCode: 'DPR_EXCEEDS_BOQ_QUANTITY',
    });

    const verified = await prisma.progressMeasurement.aggregate({
      _sum: { quantity: true },
      where: { boqNodeId: leafId, dpr: { status: 'APPROVED' } },
    });
    expect(verified._sum.quantity?.toString()).toBe('6');
  });

  afterEach(() => jest.restoreAllMocks());

  it('the same report approved twice at once: approved exactly once, the loser is refused', async () => {
    const id = await submittedReport('1');

    const results = await Promise.allSettled([
      service.approve(approver, id),
      service.approve(approver, id),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [loser] = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    // Depending on timing the loser is stopped by the locked re-read (409 DPR_CHANGED) or, if it
    // read after the winner committed, by the plain status pre-check (400). Never a second approve.
    expect([400, 409]).toContain(loser!.reason.getStatus());
  });

  it('approve vs return + edit + resubmit: the line added in between is checked', async () => {
    // Line capacity 10; 7 already approved by the tests above. This report measures 1 (fits).
    const id = await submittedReport('1');
    // Another report on the same line, approved while ours is being edited.
    const other = await submittedReport('1');
    const realLock = repo.lockDpr.bind(repo);

    // Between approve's unlocked pre-check and its transaction lock, the report is returned, an
    // entry of 2 is added and it is legitimately resubmitted (7 + 3 = 10 fits at submit time); then
    // the other report is approved. On the stale read (1) approve would pass: 8 + 1 = 9. On the
    // fresh read it must refuse: 8 + 3 = 11 > 10.
    jest.spyOn(repo, 'lockDpr').mockImplementationOnce(async (tx, orgIdArg, dprId) => {
      await service.returnForRevision(approver, id, 'Add the east wing pour');
      await service.addMeasurement(siteEngineer(), id, { boqNodeId: leafId, quantity: 2 });
      await service.submit(siteEngineer(), id);
      await prisma.dailyProgressReport.update({ where: { id: other }, data: { status: 'APPROVED' } });
      return realLock(tx, orgIdArg, dprId);
    });

    const err = await service.approve(approver, id).catch((e: unknown) => e);

    expect((err as { getResponse(): unknown }).getResponse()).toMatchObject({
      errorCode: 'DPR_EXCEEDS_BOQ_QUANTITY',
    });
    const row = await prisma.dailyProgressReport.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('SUBMITTED'); // not approved on the stale read
  });

  it('approve racing a return: the report never ends up RETURNED-then-APPROVED', async () => {
    const id = await submittedReport('1');

    const results = await Promise.allSettled([
      service.approve(approver, id),
      service.returnForRevision(approver, id, 'Photos missing'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const row = await prisma.dailyProgressReport.findUniqueOrThrow({ where: { id } });
    if (results[0]!.status === 'fulfilled') {
      expect(row.status).toBe('APPROVED');
      expect(row.returnedBy).toBeNull();
    } else {
      expect(row.status).toBe('RETURNED');
      expect(row.approvedAt).toBeNull();
    }
  });
});

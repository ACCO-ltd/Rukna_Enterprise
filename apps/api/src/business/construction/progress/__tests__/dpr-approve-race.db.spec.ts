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

    service = new ProgressService(
      tenancy,
      new ProgressRepository(),
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
});

import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import type { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { BoqPrismaRepository } from '../../boq/infrastructure/boq-prisma.repository.js';
import { BoqTreeService } from '../../boq/application/boq-tree.service.js';
import { BoqVersioningService } from '../../boq/application/boq-versioning.service.js';
import { ProgrammeRepository } from '../infrastructure/programme.repository.js';
import { ProgrammeService } from '../application/programme.service.js';

/**
 * ADR-021 amendment (2026-09-28) — the milestone ↔ work package link and server-computed readiness,
 * against a real database: the migration's unique pair and cascade, the same-project rule, and
 * readyToVerify flipping only once an APPROVED report verifies every linked package's leaves.
 */
describe('Programme milestone ↔ work packages (ADR-021 amendment 2026-09-28) [DB]', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `msw-org-${suffix}`;

  let identity: RequestIdentity;
  let projectId: string;
  let otherProjectId: string;
  let leafId: string;
  let wpId: string;
  let foreignWpId: string;
  let service: ProgrammeService;

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: orgId, name: `MSW ${suffix}`, slug: `msw-${suffix}`, status: 'ACTIVE' },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        code: `PRJMSW-${suffix}`,
        name: 'Link Project',
        currency: 'USD',
        createdBy: 'u1',
      },
    });
    projectId = project.id;
    const other = await prisma.project.create({
      data: {
        organizationId: orgId,
        code: `PRJMSX-${suffix}`,
        name: 'Other Project',
        currency: 'USD',
        createdBy: 'u1',
      },
    });
    otherProjectId = other.id;
    identity = {
      userId: 'u1',
      activeOrganizationId: orgId,
      tenantSlug: `msw-${suffix}`,
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
    const boq = await versioning.initialize(identity, projectId);
    const versionId = boq.versions[0]!.id;
    const section = await tree.addNode(identity, projectId, versionId, {
      code: '01',
      description: 'Substructure',
    });
    const leaf = await tree.addNode(identity, projectId, versionId, {
      parentId: section.id,
      code: '01.001',
      description: 'Concrete',
      isLeaf: true,
      unit: 'm3',
      quantity: '10.000',
      unitRate: '10.00',
    });
    leafId = leaf.id;

    const wp = await prisma.workPackage.create({
      data: {
        organizationId: orgId,
        projectId,
        code: 'WP-01',
        name: 'Substructure',
        createdBy: 'u1',
      },
    });
    wpId = wp.id;
    await prisma.workPackageBoqNode.create({ data: { workPackageId: wpId, boqNodeId: leafId } });
    const foreign = await prisma.workPackage.create({
      data: {
        organizationId: orgId,
        projectId: otherProjectId,
        code: 'WP-01',
        name: 'Elsewhere',
        createdBy: 'u1',
      },
    });
    foreignWpId = foreign.id;

    const projectAccess = {
      assertMember: jest.fn(async () => undefined),
    } as unknown as ProjectAccessService;
    service = new ProgrammeService(tenancy, new ProgrammeRepository(), projectAccess);
  });

  afterAll(async () => {
    await prisma.dailyProgressReport.deleteMany({ where: { organizationId: orgId } });
    await prisma.programmeMilestone.deleteMany({ where: { organizationId: orgId } });
    await prisma.workPackageBoqNode.deleteMany({
      where: { workPackage: { organizationId: orgId } },
    });
    await prisma.workPackage.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqChangeEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqNode.deleteMany({ where: { version: { boq: { organizationId: orgId } } } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('links packages at create and reads readyToVerify only once an APPROVED report verifies them', async () => {
    const created = await service.createMilestone(identity, projectId, {
      code: 'MS-01',
      name: 'Substructure complete',
      baselineDate: '2026-10-01',
      workPackageIds: [wpId],
    });

    let [ms] = (await service.listMilestones(identity, projectId)).filter(
      (m) => m.id === created.id,
    );
    expect(ms!.workPackages).toEqual([
      { id: wpId, code: 'WP-01', name: 'Substructure', percentComplete: 0 },
    ]);
    expect(ms!.readyToVerify).toBe(false);

    // A SUBMITTED report does not count — only APPROVED measurements are verified.
    const submitted = await prisma.dailyProgressReport.create({
      data: {
        organizationId: orgId,
        projectId,
        reportDate: new Date('2026-09-20'),
        status: 'SUBMITTED',
        preparedBy: 'u2',
      },
    });
    await prisma.progressMeasurement.create({
      data: {
        organizationId: orgId,
        dprId: submitted.id,
        boqNodeId: leafId,
        quantity: new Prisma.Decimal('10'),
        createdBy: 'u2',
      },
    });
    [ms] = (await service.listMilestones(identity, projectId)).filter((m) => m.id === created.id);
    expect(ms!.readyToVerify).toBe(false);

    await prisma.dailyProgressReport.update({
      where: { id: submitted.id },
      data: { status: 'APPROVED' },
    });
    [ms] = (await service.listMilestones(identity, projectId)).filter((m) => m.id === created.id);
    expect(ms!.workPackages[0]!.percentComplete).toBe(100);
    expect(ms!.readyToVerify).toBe(true);
  });

  it('PUT replaces the set; a package on another project is refused', async () => {
    const ms = await service.createMilestone(identity, projectId, {
      code: 'MS-02',
      name: 'Frame',
      baselineDate: '2026-11-01',
    });

    await expect(
      service.setMilestoneWorkPackages(identity, projectId, ms.id, [foreignWpId]),
    ).rejects.toMatchObject({ status: 400 });

    const res = await service.setMilestoneWorkPackages(identity, projectId, ms.id, [wpId, wpId]);
    expect(res.workPackages.map((wp) => wp.id)).toEqual([wpId]);

    const cleared = await service.setMilestoneWorkPackages(identity, projectId, ms.id, []);
    expect(cleared.workPackages).toEqual([]);
    expect(
      await prisma.programmeMilestoneWorkPackage.count({ where: { milestoneId: ms.id } }),
    ).toBe(0);
  });

  it('enforces one link per (milestone, package) and cascades on milestone delete', async () => {
    const ms = await service.createMilestone(identity, projectId, {
      code: 'MS-03',
      name: 'Roof',
      baselineDate: '2026-12-01',
      workPackageIds: [wpId],
    });

    await expect(
      prisma.programmeMilestoneWorkPackage.create({
        data: { milestoneId: ms.id, workPackageId: wpId, createdBy: 'u1' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await prisma.programmeMilestone.delete({ where: { id: ms.id } });
    expect(
      await prisma.programmeMilestoneWorkPackage.count({ where: { milestoneId: ms.id } }),
    ).toBe(0);
    // The package itself is untouched.
    expect(await prisma.workPackage.count({ where: { id: wpId } })).toBe(1);
  });

  it('refuses to relink a VERIFIED milestone (409)', async () => {
    const ms = await service.createMilestone(identity, projectId, {
      code: 'MS-04',
      name: 'Handover',
      baselineDate: '2027-01-01',
    });
    await service.verifyMilestone(identity, ms.id, { actualDate: '2027-01-02' });

    await expect(
      service.setMilestoneWorkPackages(identity, projectId, ms.id, [wpId]),
    ).rejects.toMatchObject({ status: 409 });
  });
});

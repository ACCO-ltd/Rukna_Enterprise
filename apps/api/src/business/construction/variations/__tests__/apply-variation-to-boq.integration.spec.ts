import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { BoqPrismaRepository } from '../../boq/infrastructure/boq-prisma.repository.js';
import { BoqTreeService } from '../../boq/application/boq-tree.service.js';
import { BoqVersioningService } from '../../boq/application/boq-versioning.service.js';

/**
 * ADR-026 CONST-VAR-007 (Variations Phase 2) — integration proof that a client-approved VO's lines
 * become BOQ nodes on a revision via the EXISTING deep-copy mechanism, tagged sourceType = VARIATION
 * with the real sourceChangeOrderId FK, and that a signed-negative omission lands as a negative leaf.
 *
 * This drives the BOQ side (BoqVersioningService.appendVariationNodes) against a live DB, the same
 * way the BOQ workspace integration spec does — the orchestration + guards are covered by the
 * ApplyVariationToBoqService unit spec.
 */
describe('appendVariationNodes → BOQ (CONST-VAR-007)', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `vp2-org-${suffix}`;

  let identity: RequestIdentity;
  let projectId: string;
  let contractId: string;
  let voId: string;
  let versioning: BoqVersioningService;
  let repo: BoqPrismaRepository;

  const ungoverned = { gateStateTransition: async () => null } as unknown as CommandGovernanceService;

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: orgId, name: `VP2 ${suffix}`, slug: `vp2-${suffix}`, status: 'ACTIVE' },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        code: `VP2-${suffix}`,
        name: 'Variation Scope Project',
        currency: 'USD',
        createdBy: 'u1',
      },
    });
    projectId = project.id;
    identity = {
      userId: 'u1',
      activeOrganizationId: orgId,
      tenantSlug: `vp2-${suffix}`,
      roles: ['admin'],
      permissions: [PERMISSIONS.boqView, PERMISSIONS.boqManage, PERMISSIONS.boqBaseline],
    };

    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    repo = new BoqPrismaRepository();
    const tree = new BoqTreeService(tenancy, repo);
    versioning = new BoqVersioningService(tenancy, repo, ungoverned);

    // A baselined original BOQ (one priced leaf under one section).
    const boq = await versioning.initialize(identity, projectId);
    const v1Id = boq.versions[0]!.id;
    const section = await tree.addNode(identity, projectId, v1Id, { code: '01', description: 'Original' });
    await tree.addNode(identity, projectId, v1Id, {
      parentId: section.id,
      code: '01.001',
      description: 'Original item',
      isLeaf: true,
      unit: 'm³',
      quantity: '100',
      unitRate: '10',
    });
    await versioning.baseline(identity, projectId, v1Id);

    // A minimal contract + a client-approved VO with an addition and a signed-negative omission.
    const client = await prisma.client.create({
      data: { organizationId: orgId, code: `CL-${suffix}`, name: `Client ${suffix}` },
    });
    const contract = await prisma.contract.create({
      data: {
        organizationId: orgId,
        projectId,
        clientId: client.id,
        boqVersionId: v1Id,
        contractNumber: `CT-${suffix}`,
        contractValue: new Decimal('1000'),
        currency: 'USD',
        status: 'ACTIVE',
        createdBy: 'u1',
      },
    });
    contractId = contract.id;
    const vo = await prisma.variationOrder.create({
      data: {
        organizationId: orgId,
        contractId,
        reference: 'VO-001',
        status: 'CLIENT_APPROVED',
        title: 'Scope change',
        createdBy: 'u1',
        lines: {
          create: [
            { description: 'Extra floor', quantity: new Decimal('10'), unitRate: new Decimal('100'), amount: new Decimal('1000'), sortOrder: 0 },
            { description: 'Omit wall', quantity: new Decimal('-2'), unitRate: new Decimal('50'), amount: new Decimal('-100'), sortOrder: 1 },
          ],
        },
      },
    });
    voId = vo.id;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM boq_nodes WHERE boq_id IN (SELECT id FROM boqs WHERE organization_id = ${orgId})`;
    await prisma.variationOrderLine.deleteMany({ where: { variationOrder: { organizationId: orgId } } });
    await prisma.variationOrder.deleteMany({ where: { organizationId: orgId } });
    await prisma.contract.deleteMany({ where: { organizationId: orgId } });
    await prisma.client.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('appends VARIATION-tagged leaf nodes with the real FK, and negates an omission', async () => {
    const result = await prisma.$transaction((tx) =>
      versioning.appendVariationNodes(tx, identity, projectId, {
        id: voId,
        reference: 'VO-001',
        lines: [
          { description: 'Extra floor', quantity: new Decimal('10'), unitRate: new Decimal('100'), amount: new Decimal('1000'), sortOrder: 0 },
          { description: 'Omit wall', quantity: new Decimal('-2'), unitRate: new Decimal('50'), amount: new Decimal('-100'), sortOrder: 1 },
        ],
      }),
    );

    expect(result.nodeCount).toBe(2);

    const variationNodes = await prisma.boqNode.findMany({
      where: { versionId: result.versionId, sourceChangeOrderId: voId },
      orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }],
    });

    // A group section + two leaves, all tagged VARIATION and all pointing at the VO (the FK).
    expect(variationNodes).toHaveLength(3);
    expect(variationNodes.every((n) => n.sourceType === 'VARIATION')).toBe(true);
    expect(variationNodes.every((n) => n.sourceChangeOrderId === voId)).toBe(true);

    const leaves = variationNodes.filter((n) => n.isLeaf);
    expect(leaves).toHaveLength(2);
    const addition = leaves.find((n) => n.description === 'Extra floor')!;
    const omission = leaves.find((n) => n.description === 'Omit wall')!;
    expect(new Decimal(addition.totalAmount!.toString()).toString()).toBe('1000');
    // Option (a): the omission is a signed-negative VARIATION leaf.
    expect(new Decimal(omission.totalAmount!.toString()).toString()).toBe('-100');
    expect(leaves.every((n) => n.currency === 'USD')).toBe(true);

    // The FK relation resolves back to the VariationOrder (provenance is real, not a bare string).
    const withVo = await prisma.boqNode.findFirst({
      where: { id: addition.id },
      include: { sourceChangeOrder: { select: { reference: true } } },
    });
    expect(withVo?.sourceChangeOrder?.reference).toBe('VO-001');

    // The original baseline is untouched (immutability): its nodes are still BASELINE.
    const boq = await repo.findByProject(prisma, projectId);
    const approvedId = boq!.currentApprovedVersionId!;
    const baselineNodes = await prisma.boqNode.findMany({ where: { versionId: approvedId } });
    expect(baselineNodes.every((n) => n.sourceType === 'BASELINE')).toBe(true);
    expect(baselineNodes.some((n) => n.sourceChangeOrderId === voId)).toBe(false);
  });

  it('is idempotent on the same draft — re-appending the same VO is rejected', async () => {
    await expect(
      prisma.$transaction((tx) =>
        versioning.appendVariationNodes(tx, identity, projectId, {
          id: voId,
          reference: 'VO-001',
          lines: [
            { description: 'Extra floor', quantity: new Decimal('10'), unitRate: new Decimal('100'), amount: new Decimal('1000'), sortOrder: 0 },
          ],
        }),
      ),
    ).rejects.toThrow(/already present/i);
  });
});

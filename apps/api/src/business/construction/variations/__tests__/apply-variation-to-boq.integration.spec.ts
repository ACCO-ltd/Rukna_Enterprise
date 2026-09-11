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
 * ADR-029 V-1/V-2 (was ADR-026 CONST-VAR-007) — integration proof that a client-approved on-contract
 * VO's lines become BOQ nodes APPENDED IN PLACE on the operational COMMITTED version (stable ids, no
 * deep-copy fork), tagged sourceType = VARIATION / commercialTreatment = IN_CONTRACT with the real
 * sourceChangeOrderId FK, that a signed-negative omission lands as a negative leaf, and that a fresh
 * frozen SNAPSHOT of the enlarged tree is cut.
 *
 * This drives the BOQ side (BoqVersioningService.appendVariationNodes) against a live DB, the same
 * way the BOQ commit integration spec does — the orchestration + the contract-value raise + guards
 * are covered by the ApplyVariationToBoqService unit spec.
 *
 * NOTE (R6): DB-backed — NOT run in the R6 gate (which is DB-free unit tests + type-check). Reworked
 * here to the in-place COMMITTED behavior so it no longer encodes the retired deep-copy path; it is
 * ready to run once a test database is available.
 */
describe('appendVariationNodes → BOQ (ADR-029 V-1/V-2)', () => {
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

    // A COMMITTED original BOQ (one priced leaf under one section) — the operational version a
    // variation is adopted into under the redesign.
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
    await versioning.commit(identity, projectId, v1Id);

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

  it('V-1: appends VARIATION-tagged IN_CONTRACT leaves IN PLACE with the real FK, and negates an omission', async () => {
    // The operational COMMITTED version + its node ids BEFORE the append.
    const before = await repo.findByProject(prisma, projectId);
    const operationalId = before!.currentVersionId!;
    const beforeIds = new Set(
      (await prisma.boqNode.findMany({ where: { versionId: operationalId }, select: { id: true } })).map((n) => n.id),
    );

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
    // The leaves landed on the SAME operational version (in place, stable ids — L-6).
    expect(result.versionId).toBe(operationalId);
    expect(result.snapshotVersionId).toBeTruthy();
    expect(result.snapshotVersionId).not.toBe(operationalId);

    const variationNodes = await prisma.boqNode.findMany({
      where: { versionId: operationalId, sourceChangeOrderId: voId },
      orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }],
    });

    // A group section + two leaves, all tagged VARIATION / IN_CONTRACT and all pointing at the VO (FK).
    expect(variationNodes).toHaveLength(3);
    expect(variationNodes.every((n) => n.sourceType === 'VARIATION')).toBe(true);
    expect(variationNodes.every((n) => n.commercialTreatment === 'IN_CONTRACT')).toBe(true);
    expect(variationNodes.every((n) => n.sourceChangeOrderId === voId)).toBe(true);
    // Pre-existing nodes kept their ids (no fork): the id set only GREW.
    for (const id of beforeIds) {
      expect(variationNodes.some((n) => n.id === id)).toBe(false);
    }
    const stillThere = await prisma.boqNode.findMany({ where: { id: { in: [...beforeIds] } } });
    expect(stillThere).toHaveLength(beforeIds.size);

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
  });

  it('V-2: cuts a fresh frozen SNAPSHOT of the enlarged tree and repoints committedSnapshotVersionId', async () => {
    const boq = await repo.findByProject(prisma, projectId);
    const operationalId = boq!.currentVersionId!;
    const snapshotId = boq!.committedSnapshotVersionId!;
    expect(snapshotId).not.toBe(operationalId);

    // The snapshot copies the WHOLE enlarged operational tree (original + variation), with NEW ids.
    const operationalNodes = await prisma.boqNode.findMany({ where: { versionId: operationalId } });
    const snapshotNodes = await prisma.boqNode.findMany({ where: { versionId: snapshotId } });
    expect(snapshotNodes).toHaveLength(operationalNodes.length);
    const opIds = new Set(operationalNodes.map((n) => n.id));
    expect(snapshotNodes.every((n) => !opIds.has(n.id))).toBe(true);
    // The variation scope is present in the snapshot (the legal record includes the varied scope).
    expect(snapshotNodes.some((n) => n.sourceChangeOrderId === voId)).toBe(true);
    const snapshotVersion = await prisma.boqVersion.findUniqueOrThrow({ where: { id: snapshotId } });
    expect(snapshotVersion.status).toBe('SNAPSHOT');
  });

  it('idempotent — re-appending the same VO to the operational version is rejected', async () => {
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

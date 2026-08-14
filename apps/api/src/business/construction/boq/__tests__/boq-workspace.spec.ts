import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { BoqPrismaRepository } from '../infrastructure/boq-prisma.repository.js';
import { BoqTreeService } from '../application/boq-tree.service.js';
import { BoqVersioningService } from '../application/boq-versioning.service.js';
import { BoqWorkspaceService } from '../application/boq-workspace.service.js';

describe('BOQ workspace read models', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `boqw-org-${suffix}`;

  let identity: RequestIdentity;
  let projectId: string;
  let v1Id: string;
  let v2Id: string;
  let tree: BoqTreeService;
  let versioning: BoqVersioningService;
  let workspace: BoqWorkspaceService;

  const ungoverned = {
    gateStateTransition: async () => null,
  } as unknown as CommandGovernanceService;

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: orgId, name: `BOQ W ${suffix}`, slug: `boqw-${suffix}`, status: 'ACTIVE' },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        code: `PRJW-${suffix}`,
        name: 'Workspace Project',
        currency: 'USD',
        createdBy: 'u1',
      },
    });
    projectId = project.id;
    identity = {
      userId: 'u1',
      activeOrganizationId: orgId,
      tenantSlug: `boqw-${suffix}`,
      roles: ['admin'],
      permissions: [PERMISSIONS.boqView, PERMISSIONS.boqManage, PERMISSIONS.boqBaseline],
      lang: 'en',
    };

    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const repo = new BoqPrismaRepository();
    tree = new BoqTreeService(tenancy, repo);
    versioning = new BoqVersioningService(tenancy, repo, ungoverned);
    workspace = new BoqWorkspaceService(tenancy, repo, versioning);

    const boq = await versioning.initialize(identity, projectId);
    v1Id = boq.versions[0]!.id;

    const section = await tree.addNode(identity, projectId, v1Id, {
      code: '01',
      description: 'Substructure',
    });
    await tree.addNode(identity, projectId, v1Id, {
      parentId: section.id,
      code: '01.001',
      description: 'Bulk excavation',
      isLeaf: true,
      unit: 'm³',
      quantity: '4250.000',
      unitRate: '12.00',
    });
    await tree.addNode(identity, projectId, v1Id, {
      parentId: section.id,
      code: '01.002',
      description: 'Removed in revision',
      isLeaf: true,
      unit: 'm',
      quantity: '100.000',
      unitRate: '5.00',
    });

    await versioning.baseline(identity, projectId, v1Id);
    const revised = await versioning.createDraftFromApproved(identity, projectId, 'VO-0003');
    v2Id = revised.currentDraftVersionId!;
  });

  afterAll(async () => {
    await prisma.boqNode.deleteMany({ where: { version: { boq: { organizationId: orgId } } } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('returns the not-initialized state instead of failing for a project with no BOQ', async () => {
    const bare = await prisma.project.create({
      data: {
        organizationId: orgId,
        code: `PRJN-${suffix}`,
        name: 'No BOQ',
        currency: 'USD',
        createdBy: 'u1',
      },
    });

    const result = await workspace.getWorkspace(identity, bare.id);

    expect(result.boq).toBeNull();
    expect(result.versions).toHaveLength(0);
    expect(result.readiness).toBeNull();
    expect(result.capabilities.canManage).toBe(true);
  });

  it('resolves draft, approved and version totals in one query', async () => {
    const result = await workspace.getWorkspace(identity, projectId);

    expect(result.currency).toBe('USD');
    expect(result.approved?.id).toBe(v1Id);
    expect(result.draft?.id).toBe(v2Id);
    expect(result.versions).toHaveLength(2);
    // 4250 × 12 + 100 × 5 = 51,000 + 500
    expect(result.approved?.totalAmount).toBe('51500.00');
    expect(result.approved?.itemCount).toBe(2);
  });

  it('reports the revision it derives from and the net change', async () => {
    const item = await prisma.boqNode.findFirstOrThrow({
      where: { versionId: v2Id, code: '01.001' },
    });
    await tree.updateNode(identity, projectId, v2Id, item.id, { unitRate: '13.00' });

    const result = await workspace.getWorkspace(identity, projectId);

    expect(result.revision?.basedOnVersionId).toBe(v1Id);
    expect(result.revision?.basedOnVersionNumber).toBe(1);
    // 4250 × (13 − 12) = 4,250
    expect(result.revision?.netDelta).toBe('4250.00');
  });

  it('withholds every monetary field from a caller without commercial visibility', async () => {
    const restricted: RequestIdentity = { ...identity, permissions: [PERMISSIONS.boqManage] };

    const result = await workspace.getWorkspace(restricted, projectId);

    expect(result.capabilities.canViewCommercials).toBe(false);
    expect(result.approved?.totalAmount).toBeNull();
    expect(result.draft?.totalAmount).toBeNull();
    expect(result.versions.every((version) => version.totalAmount === null)).toBe(true);
    expect(result.readiness?.totalAmount).toBeNull();
    expect(result.revision?.netDelta).toBeNull();
    // Structure is still readable — only the commercial figures are withheld.
    expect(result.readiness?.itemCount).toBeGreaterThan(0);
  });

  it('pairs nodes across versions on lineage, not on code', async () => {
    // Renumbering a line must read as one rate change, not a removal plus an addition.
    const renamed = await prisma.boqNode.findFirstOrThrow({
      where: { versionId: v2Id, code: '01.001' },
    });
    await tree.updateNode(identity, projectId, v2Id, renamed.id, { code: '01.010' });

    const diff = await workspace.compare(identity, projectId, v1Id, v2Id);
    const change = diff.changes.find((entry) => entry.leftNodeId === renamed.originNodeId);

    expect(change).toBeDefined();
    expect(change!.kinds).toContain('RATE_CHANGED');
    expect(change!.kinds).not.toContain('ADDED');
    expect(change!.oldUnitRate).toBe('12.00');
    expect(change!.newUnitRate).toBe('13.00');
    expect(change!.amountDelta).toBe('4250.00');
    expect(change!.amountDeltaPercent).toBe('8.33');
  });

  it('classifies additions and removals and totals the net delta', async () => {
    const removed = await prisma.boqNode.findFirstOrThrow({
      where: { versionId: v2Id, code: '01.002' },
    });
    await tree.deleteNode(identity, projectId, v2Id, removed.id);

    const section = await prisma.boqNode.findFirstOrThrow({
      where: { versionId: v2Id, code: '01' },
    });
    await tree.addNode(identity, projectId, v2Id, {
      parentId: section.id,
      code: '01.003',
      description: 'New scope',
      isLeaf: true,
      unit: 'm²',
      quantity: '10.000',
      unitRate: '100.00',
    });

    const diff = await workspace.compare(identity, projectId, v1Id, v2Id);

    expect(diff.addedCount).toBe(1);
    expect(diff.removedCount).toBe(1);
    expect(diff.leftTotal).toBe('51500.00');
    // 4250 × 13 + 10 × 100 = 55,250 + 1,000
    expect(diff.rightTotal).toBe('56250.00');
    expect(diff.netDelta).toBe('4750.00');
  });

  it('refuses to compare a version with itself', async () => {
    await expect(workspace.compare(identity, projectId, v1Id, v1Id)).rejects.toThrow();
  });
});

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { BoqPrismaRepository } from '../infrastructure/boq-prisma.repository.js';
import { BoqTreeService } from '../application/boq-tree.service.js';
import { BoqVersioningService } from '../application/boq-versioning.service.js';
import { evaluateReadiness } from '../domain/boq-readiness.policy.js';

/**
 * CONST-BOQ-016 — the readiness query and the baseline command must reach the same verdict.
 *
 * Before ADR-016, an empty BOQ, a BOQ of unpriced items, and a BOQ with duplicate codes
 * could all be baselined, and a baselined version is what a contract references and every
 * certificate claims against. The tests that matter here are the ones proving the screen
 * and the server cannot disagree.
 */
describe('BOQ baseline readiness and governance', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `boqr-org-${suffix}`;

  let identity: RequestIdentity;
  let projectId: string;
  let versionId: string;
  let tree: BoqTreeService;
  let versioning: BoqVersioningService;

  const gate = { gateStateTransition: jest.fn(async () => null as null | { gated: true; approvalInstanceId: string }) };

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: orgId, name: `BOQ R ${suffix}`, slug: `boqr-${suffix}`, status: 'ACTIVE' },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        code: `PRJR-${suffix}`,
        name: 'Readiness Project',
        currency: 'USD',
        createdBy: 'u1',
      },
    });
    projectId = project.id;
    identity = {
      userId: 'u1',
      activeOrganizationId: orgId,
      tenantSlug: `boqr-${suffix}`,
      roles: ['admin'],
      permissions: ['*'],
      lang: 'en',
    };

    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const repo = new BoqPrismaRepository();
    tree = new BoqTreeService(tenancy, repo);
    versioning = new BoqVersioningService(
      tenancy,
      repo,
      gate as unknown as CommandGovernanceService,
    );

    const boq = await versioning.initialize(identity, projectId);
    versionId = boq.versions[0]!.id;
  });

  afterAll(async () => {
    await prisma.boqNode.deleteMany({ where: { version: { boq: { organizationId: orgId } } } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    gate.gateStateTransition.mockReset();
    gate.gateStateTransition.mockResolvedValue(null);
  });

  it('blocks an empty BOQ and says why', async () => {
    const readiness = await versioning.getReadiness(identity, projectId, versionId);

    expect(readiness.ready).toBe(false);
    expect(readiness.itemCount).toBe(0);
    expect(readiness.blockers.map((blocker) => blocker.kind)).toContain('NO_BILLABLE_ITEMS');
  });

  it('refuses to baseline what the readiness query calls not ready', async () => {
    await expect(versioning.baseline(identity, projectId, versionId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // The gate is never reached — an unready version is rejected before governance.
    expect(gate.gateStateTransition).not.toHaveBeenCalled();
  });

  it('reports each unpriced item individually, with the code to fix', async () => {
    const section = await tree.addNode(identity, projectId, versionId, {
      code: '01',
      description: 'Preliminaries',
    });
    await tree.addNode(identity, projectId, versionId, {
      parentId: section.id,
      code: '01.001',
      description: 'Missing everything',
      isLeaf: true,
    });

    const readiness = await versioning.getReadiness(identity, projectId, versionId);

    expect(readiness.ready).toBe(false);
    expect(readiness.itemCount).toBe(1);
    expect(readiness.pricedItemCount).toBe(0);
    expect(readiness.incompleteItemCount).toBe(1);
    expect(readiness.blockers.map((blocker) => blocker.kind).sort()).toEqual([
      'MISSING_QUANTITY',
      'MISSING_RATE',
      'MISSING_UNIT',
    ]);
    expect(readiness.blockers.every((blocker) => blocker.code === '01.001')).toBe(true);
  });

  it('allows an empty section but not an empty BOQ', async () => {
    await tree.addNode(identity, projectId, versionId, {
      code: '02',
      description: 'Section with nothing in it',
    });

    const readiness = await versioning.getReadiness(identity, projectId, versionId);

    expect(readiness.warnings.map((warning) => warning.kind)).toContain('EMPTY_SECTION');
    expect(readiness.blockers.map((blocker) => blocker.kind)).not.toContain('EMPTY_SECTION');
  });

  it('turns ready once every item is priced, and totals the version', async () => {
    const item = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '01.001' } });
    await tree.updateNode(identity, projectId, versionId, item.id, {
      unit: 'm³',
      quantity: '680.000',
      unitRate: '12.50',
    });

    const readiness = await versioning.getReadiness(identity, projectId, versionId);

    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
    expect(readiness.totalAmount).toBe('8500.00');
    expect(readiness.currency).toBe('USD');
  });

  it('flags a zero rate as a warning, not a blocker — provisional items are legal', () => {
    const readiness = evaluateReadiness(
      [
        {
          id: 'n1',
          code: '01.001',
          description: 'Provisional sum',
          isLeaf: true,
          unit: 'LS',
          quantity: '1',
          unitRate: '0',
          totalAmount: '0',
          currency: 'USD',
          parentId: null,
          isActive: true,
          sourceType: 'BASELINE',
          sourceChangeOrderId: null,
        } as never,
      ],
      { boqCurrency: 'USD', isPostAward: false, enforceVariationOrigin: false },
    );

    expect(readiness.ready).toBe(true);
    expect(readiness.warnings.map((warning) => warning.kind)).toContain('ZERO_RATE');
  });

  it('passes through the governance gate when no binding is configured', async () => {
    const boq = await versioning.baseline(identity, projectId, versionId);

    expect(gate.gateStateTransition).toHaveBeenCalledWith(
      identity,
      'BoqVersion',
      'DRAFT',
      'BASELINED',
      versionId,
    );
    expect(boq.versions.find((version) => version.id === versionId)!.status).toBe('BASELINED');
    expect(boq.originalBaselineVersionId).toBe(versionId);
  });

  it('returns 409 with the approval instance when a binding gates the baseline', async () => {
    const revision = await versioning.createDraftFromApproved(identity, projectId, 'VO-0001');
    const draftId = revision.currentDraftVersionId!;

    gate.gateStateTransition.mockResolvedValue({
      gated: true,
      approvalInstanceId: 'approval-1',
    });

    // Four-eyes is a binding, not a code path: the same command answers 409 with the
    // instance id the approver acts on, then completes on re-drive (ADR-015).
    await expect(versioning.baseline(identity, projectId, draftId)).rejects.toBeInstanceOf(
      ConflictException,
    );

    gate.gateStateTransition.mockResolvedValue(null);
    const baselined = await versioning.baseline(identity, projectId, draftId);
    expect(baselined.currentApprovedVersionId).toBe(draftId);
    // Immutable once set — the original contract baseline survives the revision.
    expect(baselined.originalBaselineVersionId).toBe(versionId);
  });
});

import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import type { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { VariationOrderPrismaRepository } from '../infrastructure/variation-order-prisma.repository.js';
import { AtRiskCommencementService } from '../application/at-risk-commencement.service.js';

/**
 * ADR-026 CONST-VAR-011 (Variations Phase 5, Route 7B) — live-DB proof of the at-risk commencement
 * authorisation. Asserts the record persists; the firewall (contract value + BOQ node + VO status all
 * unchanged) holds against the real database; the config-driven cap decides the CEO step; and tenant
 * isolation (another org's VO is unreachable).
 */
describe('AtRiskCommencementService (CONST-VAR-011, Route 7B) — integration', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `vp5-org-${suffix}`;
  const otherOrgId = `vp5-other-${suffix}`;

  let service: AtRiskCommencementService;
  let identity: RequestIdentity;
  let contractId: string;
  let voId: string;
  let boqNodeId: string;
  let otherVoId: string;

  const CONTRACT_VALUE = '5000.00';
  const NODE_TOTAL = '1000.00';
  const CAP = '25000';

  beforeAll(async () => {
    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const projectAccess = {
      assertContract: async () => undefined,
      assertMember: async () => undefined,
    } as unknown as ProjectAccessService;
    const auditOutbox = { record: async () => undefined } as unknown as TransactionalAuditOutboxService;
    // Config-driven cap: mimic ConfigService returning the provisional USD 25,000.
    const config = { get: (k: string) => (k === 'VARIATION_AT_RISK_EXPOSURE_CAP_USD' ? CAP : undefined) };

    service = new AtRiskCommencementService(
      tenancy,
      new VariationOrderPrismaRepository(),
      projectAccess,
      auditOutbox,
      config as never,
    );

    identity = {
      userId: 'u-cfo',
      activeOrganizationId: orgId,
      tenantSlug: `vp5-${suffix}`,
      roles: ['CFO'],
      permissions: [PERMISSIONS.contractsView, PERMISSIONS.contractsApprove],
    };

    await seedOrg(orgId, `vp5-${suffix}`);
    ({ contractId, voId, boqNodeId } = await seedContractWithVo(orgId));

    await seedOrg(otherOrgId, `vp5o-${suffix}`);
    otherVoId = (await seedContractWithVo(otherOrgId)).voId;
  });

  async function seedOrg(id: string, slug: string) {
    await prisma.organization.create({ data: { id, name: `Org ${slug}`, slug, status: 'ACTIVE' } });
  }

  async function seedContractWithVo(org: string) {
    const project = await prisma.project.create({
      data: { organizationId: org, code: `VP5-${org.slice(-6)}`, name: 'AtRisk project', currency: 'USD', createdBy: 'u1' },
    });
    const boq = await prisma.boq.create({ data: { organizationId: org, projectId: project.id, currency: 'USD' } });
    const version = await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 1, status: 'BASELINED', createdBy: 'u1' },
    });
    const node = await prisma.boqNode.create({
      data: {
        boqId: boq.id,
        versionId: version.id,
        path: '01.001',
        code: '01.001',
        description: 'Baseline item',
        isLeaf: true,
        depth: 0,
        sortOrder: 0,
        unit: 'm3',
        quantity: new Decimal('100'),
        unitRate: new Decimal('10'),
        currency: 'USD',
        totalAmount: new Decimal(NODE_TOTAL),
        sourceType: 'BASELINE',
      },
    });
    const client = await prisma.client.create({
      data: { organizationId: org, code: `CL-${org.slice(-6)}`, name: 'Client' },
    });
    const contract = await prisma.contract.create({
      data: {
        organizationId: org,
        projectId: project.id,
        clientId: client.id,
        boqVersionId: version.id,
        contractNumber: `CT-${org.slice(-6)}`,
        contractValue: new Decimal(CONTRACT_VALUE),
        currency: 'USD',
        status: 'ACTIVE',
        createdBy: 'u1',
      },
    });
    // A PENDING_INTERNAL VO — pre-CLIENT_APPROVED, so at-risk commencement is eligible.
    const vo = await prisma.variationOrder.create({
      data: {
        organizationId: org,
        contractId: contract.id,
        reference: 'VO-001',
        status: 'PENDING_INTERNAL',
        title: 'Urgent extra scope',
        createdBy: 'u1',
      },
    });
    return { contractId: contract.id, voId: vo.id, boqNodeId: node.id };
  }

  it('below the cap: records a CD+CFO authorisation (ceoRequired=false) and persists it', async () => {
    const res = await service.record(identity, voId, {
      exposureAmount: 18000,
      reason: 'Client instructed urgent start; VO in internal approval.',
      constructionDirectorUserId: 'u-cd',
      cfoUserId: 'u-cfo',
    });

    expect(res.ceoRequired).toBe(false);
    expect(res.ceoUserId).toBeNull();
    expect(res.capAmount).toBe('25000.00');
    expect(res.exposureAmount).toBe('18000.00');
    expect(res.voStatusAtAuthorisation).toBe('PENDING_INTERNAL');

    const rows = await prisma.variationOrderAtRiskAuthorisation.findMany({ where: { variationOrderId: voId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toContain('urgent start');
  });

  it('firewall: contract value, BOQ node and VO status are all UNCHANGED by the authorisation', async () => {
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    const node = await prisma.boqNode.findUniqueOrThrow({ where: { id: boqNodeId } });
    const vo = await prisma.variationOrder.findUniqueOrThrow({ where: { id: voId } });

    expect((contract.contractValue as Decimal).toFixed(2)).toBe(CONTRACT_VALUE);
    expect((node.totalAmount as Decimal).toFixed(2)).toBe(NODE_TOTAL);
    expect(vo.status).toBe('PENDING_INTERNAL'); // lifecycle untouched (CONST-VAR-011)
  });

  it('above the cap: the CEO is required (400 without ceoUserId), and permitted with it', async () => {
    await expect(
      service.record(identity, voId, {
        exposureAmount: 30000,
        reason: 'Large urgent exposure',
        constructionDirectorUserId: 'u-cd',
        cfoUserId: 'u-cfo',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const res = await service.record(
      { ...identity, roles: ['CEO'] },
      voId,
      {
        exposureAmount: 30000,
        reason: 'Large urgent exposure — CEO signed',
        constructionDirectorUserId: 'u-cd',
        cfoUserId: 'u-cfo',
        ceoUserId: 'u-ceo',
      },
    );
    expect(res.ceoRequired).toBe(true);
    expect(res.ceoUserId).toBe('u-ceo');
  });

  it('rejects a caller who is not CD/CFO/CEO (no informal path)', async () => {
    await expect(
      service.record(
        { ...identity, roles: ['PROJECT_MANAGER'] },
        voId,
        { exposureAmount: 1000, reason: 'x', constructionDirectorUserId: 'u-cd', cfoUserId: 'u-cfo' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('tenant isolation: another org’s VO is not reachable', async () => {
    await expect(
      service.record(identity, otherVoId, {
        exposureAmount: 1000,
        reason: 'x',
        constructionDirectorUserId: 'u-cd',
        cfoUserId: 'u-cfo',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      await prisma.variationOrderAtRiskAuthorisation.deleteMany({ where: { organizationId: org } });
      await prisma.variationOrder.deleteMany({ where: { organizationId: org } });
      await prisma.contract.deleteMany({ where: { organizationId: org } });
      await prisma.client.deleteMany({ where: { organizationId: org } });
      await prisma.$executeRaw`DELETE FROM boq_nodes WHERE boq_id IN (SELECT id FROM boqs WHERE organization_id = ${org})`;
      await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: org } } });
      await prisma.boq.deleteMany({ where: { organizationId: org } });
      await prisma.project.deleteMany({ where: { organizationId: org } });
      await prisma.organization.deleteMany({ where: { id: org } });
    }
    await prisma.$disconnect();
  });
});

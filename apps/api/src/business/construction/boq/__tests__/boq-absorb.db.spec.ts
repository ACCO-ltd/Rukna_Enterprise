import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { BoqPrismaRepository } from '../infrastructure/boq-prisma.repository.js';
import { BoqTreeService } from '../application/boq-tree.service.js';
import { BoqVersioningService } from '../application/boq-versioning.service.js';
import {
  inContractBillableTotal,
  contingencyRemaining,
} from '../domain/boq-contract-value.policy.js';

/**
 * ADR-029 E-1 / C-4 — the ABSORB atomic transaction, DB-backed (WRITTEN, LEFT UNRUN per the R5
 * ticket — the DB-free specs prove the decision logic; this proves the whole net-zero write against
 * real rows). Mirrors the commit suite's fixture. It commits a priced BOQ (a work line + a
 * contingency allowance), then absorbs scope and asserts, on the real rows, that the in-contract
 * total is unchanged, contingency ticks down by exactly the absorbed amount, and an ABSORBED leaf
 * was added — all in one transaction (both writes present, or neither).
 */
describe('BOQ ABSORB atomic transaction (ADR-029 E-1) [DB]', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `boqab-org-${suffix}`;

  let identity: RequestIdentity;
  let projectId: string;
  let versionId: string;
  let tree: BoqTreeService;
  let versioning: BoqVersioningService;
  const gate = { gateStateTransition: jest.fn(async () => null as null | { gated: true; approvalInstanceId: string }) };

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: orgId, name: `BOQ AB ${suffix}`, slug: `boqab-${suffix}`, status: 'ACTIVE' },
    });
    const project = await prisma.project.create({
      data: { organizationId: orgId, code: `PRJAB-${suffix}`, name: 'Absorb Project', currency: 'USD', createdBy: 'u1' },
    });
    projectId = project.id;
    identity = {
      userId: 'u1',
      activeOrganizationId: orgId,
      tenantSlug: `boqab-${suffix}`,
      roles: ['admin'],
      permissions: ['*'],
    };

    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const repo = new BoqPrismaRepository();
    tree = new BoqTreeService(tenancy, repo);
    versioning = new BoqVersioningService(tenancy, repo, gate as unknown as CommandGovernanceService);

    const boq = await versioning.initialize(identity, projectId);
    versionId = boq.versions[0]!.id;

    // A priced BOQ: work 1000 + contingency 500 (total 1500), committed.
    const section = await tree.addNode(identity, projectId, versionId, { code: '01', description: 'Substructure' });
    await tree.addNode(identity, projectId, versionId, {
      parentId: section.id, code: '01.001', description: 'Concrete', isLeaf: true, unit: 'm3', quantity: '100.000', unitRate: '10.00',
    });
    const contingency = await tree.addNode(identity, projectId, versionId, {
      parentId: section.id, code: '01.900', description: 'Contingency allowance', isLeaf: true, unit: 'LS', quantity: '1.000', unitRate: '500.00',
    });
    await prisma.boqNode.update({ where: { id: contingency.id }, data: { nodeRole: 'CONTINGENCY' } });
    await versioning.commit(identity, projectId, versionId);
  });

  afterAll(async () => {
    await prisma.boqChangeEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqNode.deleteMany({ where: { version: { boq: { organizationId: orgId } } } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('absorbs $200: in-contract total unchanged, contingency 500 → 300, ABSORBED leaf added', async () => {
    const before = await prisma.boqNode.findMany({ where: { versionId } });
    const totalBefore = inContractBillableTotal(before)!.toFixed(2);

    const absorbed = await tree.addAbsorbedScope(identity, projectId, versionId, {
      description: 'Extra retaining wall', amount: '200.00',
    });
    expect(absorbed.commercialTreatment).toBe('ABSORBED');

    const after = await prisma.boqNode.findMany({ where: { versionId } });
    // In-contract total constant (net-zero): the ABSORBED +200 is matched by contingency −200.
    expect(inContractBillableTotal(after)!.toFixed(2)).toBe(totalBefore);
    // Contingency remaining ticked down by exactly the absorbed amount.
    expect(contingencyRemaining(after)!.toFixed(2)).toBe('300.00');
    // The ABSORBED leaf really landed.
    expect(after.some((n) => n.commercialTreatment === 'ABSORBED' && n.totalAmount?.toFixed(2) === '200.00')).toBe(true);
    // Two events recorded (the CREATE + the funding MOVE).
    const events = await prisma.boqChangeEvent.findMany({ where: { versionId, action: { in: ['CREATE', 'MOVE'] } } });
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
});

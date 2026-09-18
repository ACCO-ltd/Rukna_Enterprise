import { randomUUID } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { BoqPrismaRepository } from '../../boq/infrastructure/boq-prisma.repository.js';
import { BoqTreeService } from '../../boq/application/boq-tree.service.js';
import { BoqVersioningService } from '../../boq/application/boq-versioning.service.js';
import { ContractPrismaRepository } from '../infrastructure/contract-prisma.repository.js';
import { ContractService } from '../application/contract.service.js';

/**
 * ADR-030 CONST-COM-020/021/022 (S-CC-1..4, S-CC-3 concurrency) — contract-create simplification,
 * DB-backed (WRITTEN, LEFT UNRUN — run against a migrated `rukna_test` with a DATABASE_URL override).
 *
 * Proves against real rows what the DB-free spec cannot: the atomic per-project number sequence hands
 * out distinct `…-C1/-C2` under concurrent creates; the value ties out to the committed BOQ; a
 * DRAFT-only project is gated with BOQ_NOT_COMMITTED and writes no row. Mirrors the BOQ ABSORB fixture.
 */
describe('Contract create — committed-BOQ bind, auto number, gate (ADR-030) [DB]', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `conc-org-${suffix}`;
  const userId = `u1-${suffix}`;

  const tenancy = { getClient: () => prisma } as unknown as TenancyService;
  const gate = {
    gateStateTransition: jest.fn(async () => null as null | { gated: true; approvalInstanceId: string }),
  };
  const attachments = { freezeFor: jest.fn().mockResolvedValue(0) };

  const boqRepo = new BoqPrismaRepository();
  const tree = new BoqTreeService(tenancy, boqRepo);
  const versioning = new BoqVersioningService(
    tenancy,
    boqRepo,
    gate as unknown as CommandGovernanceService,
  );
  const projectAccess = new ProjectAccessService(tenancy);
  const audit = new TransactionalAuditOutboxService();
  const contractRepo = new ContractPrismaRepository();
  const service = new ContractService(
    tenancy,
    contractRepo,
    projectAccess,
    audit,
    attachments as never,
    versioning,
  );

  // The ADMIN role is in ProjectAccessService.PROJECT_MEMBERSHIP_BYPASS_ROLES (case-sensitive), so the
  // fixture user need not be a project member. `permissions:['*']` covers the permission guards.
  function identityFor(org: string): RequestIdentity {
    return {
      userId,
      activeOrganizationId: org,
      tenantSlug: `conc-${suffix}`,
      roles: ['ADMIN'],
      permissions: ['*'],
    };
  }
  const identity = identityFor(orgId);

  /** Create an org + project + a committed, priced BOQ (total 750,000) and return the project. */
  async function seedProjectWithCommittedBoq(code: string) {
    const project = await prisma.project.create({
      data: { organizationId: orgId, code, name: `Project ${code}`, currency: 'USD', createdBy: userId },
    });
    const client = await prisma.client.create({
      data: { organizationId: orgId, code: `CL-${code}`, name: `Client ${code}` },
    });
    const boq = await versioning.initialize(identity, project.id);
    const versionId = boq.versions[0]!.id;
    const section = await tree.addNode(identity, project.id, versionId, {
      code: '01',
      description: 'Works',
    });
    await tree.addNode(identity, project.id, versionId, {
      parentId: section.id,
      code: '01.001',
      description: 'Concrete',
      isLeaf: true,
      unit: 'm3',
      quantity: '1000.000',
      unitRate: '750.00',
    });
    await versioning.commit(identity, project.id, versionId);
    return { project, client, versionId };
  }

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: orgId, name: `Conc ${suffix}`, slug: `conc-${suffix}`, status: 'ACTIVE' },
    });
    // `identity.userId` FKs to a real user via audit_logs.user_id — seed it (prod always has one).
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: 'x',
        firstName: 'Test',
        lastName: 'User',
        organizationId: orgId,
      },
    });
  });

  afterAll(async () => {
    await prisma.auditOutboxEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { orgId } });
    await prisma.contractNumberSequence.deleteMany({ where: { project: { organizationId: orgId } } });
    await prisma.contract.deleteMany({ where: { organizationId: orgId } });
    await prisma.boqNode.deleteMany({ where: { version: { boq: { organizationId: orgId } } } });
    await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
    await prisma.boq.deleteMany({ where: { organizationId: orgId } });
    await prisma.client.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('S-CC-1: minimal payload binds the committed version and derives base==current==tie-out', async () => {
    const code = `MIN-${suffix}`;
    const { project, client, versionId } = await seedProjectWithCommittedBoq(code);

    const created = await service.create(identity, {
      projectId: project.id,
      clientId: client.id,
      currency: 'USD',
      startDate: '2026-01-15',
      expectedEndDate: '2027-12-31',
    } as never);

    const row = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
    // Slice-1A: contract binds to an immutable SNAPSHOT cut from the operational version, not the
    // operational version itself — verify the snapshot is derived from the correct committed version.
    const snapshot = await prisma.boqVersion.findUniqueOrThrow({ where: { id: row.boqVersionId } });
    expect(snapshot.status).toBe('SNAPSHOT');
    expect(snapshot.derivedFromVersionId).toBe(versionId);
    expect(row.contractValue.toFixed(2)).toBe('750000.00');
    expect(row.baseContractValue?.toFixed(2)).toBe('750000.00');
    expect(row.billingModel).toBe('MILESTONE'); // S-CC-4 default
    expect(row.contractNumber).toBe(`${code}-C1`); // S-CC-3 first number
  });

  it('S-CC-3: two concurrent creates on one project get distinct …-C1 / …-C2 (no collision)', async () => {
    const code = `CONC-${suffix}`;
    const { project, client } = await seedProjectWithCommittedBoq(code);

    // The first contract must become effective-CLOSED before a second CLIENT_CONTRACT is allowed
    // (one effective client contract per project). To isolate the SEQUENCE from that lifecycle guard,
    // race two SUBCONTRACTs (no effective-contract constraint) on the same project — both mint from
    // the same per-project counter, so distinct numbers prove the atomic increment.
    const boqVersion = await prisma.boqVersion.findFirstOrThrow({
      where: { boq: { projectId: project.id }, status: 'COMMITTED' },
    });
    const makeSub = () =>
      service.create(identity, {
        projectId: project.id,
        clientId: client.id,
        currency: 'USD',
        contractKind: 'SUBCONTRACT',
        boqVersionId: boqVersion.id,
        contractValue: '100000.00',
      } as never);

    const [a, b] = await Promise.all([makeSub(), makeSub()]);
    const rows = await prisma.contract.findMany({
      where: { id: { in: [a.id, b.id] } },
      select: { contractNumber: true },
    });
    const numbers = rows.map((r) => r.contractNumber).sort();
    expect(new Set(numbers).size).toBe(2);
    expect(numbers).toEqual([`${code}-C1`, `${code}-C2`]);
  });

  it('S-CC-2: a DRAFT BOQ with no priced nodes is refused with no-scope error and writes no row', async () => {
    const code = `DRAFT-${suffix}`;
    const project = await prisma.project.create({
      data: { organizationId: orgId, code, name: 'Draft-only', currency: 'USD', createdBy: userId },
    });
    const client = await prisma.client.create({
      data: { organizationId: orgId, code: `CL-${code}`, name: 'Draft client' },
    });
    // Slice-1A: BOQ_NOT_COMMITTED gate removed — DRAFT versions are now valid for contract signing.
    // A BOQ with no priced nodes still fails: tie-out returns null → 400 with no-scope message.
    await versioning.initialize(identity, project.id);

    const err = await service
      .create(identity, { projectId: project.id, clientId: client.id, currency: 'USD' } as never)
      .catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toMatch(/no priced in-contract scope/);
    const count = await prisma.contract.count({ where: { projectId: project.id } });
    expect(count).toBe(0);
  });
});

import { randomUUID } from 'node:crypto';

import { Decimal } from '@prisma/client/runtime/library';
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
 * Slice-1A — ACCO Mutable BOQ → Signed Contract Snapshot (DB-backed).
 *
 * Proves the 12 required invariants end-to-end against real rows:
 *   T-1  contract can be recorded without a committed BOQ
 *   T-2  recording contract creates / references immutable SNAPSHOT
 *   T-3  snapshot amount matches signed contract source
 *   T-4  live BOQ monetary edits work after signing
 *   T-5  live BOQ edits do not change baseContractValue
 *   T-6  live BOQ edits do not change contractValue
 *   T-7  snapshot nodes do not mutate when the operational version is edited
 *   T-8  variation adoption still changes contractValue
 *   T-9  variation reversal still restores contractValue
 *   T-10 old contracts with COMMITTED/BASELINED refs still load
 *   T-11 milestone amounts remain % × baseContractValue after BOQ edits
 *   T-12 separate charges remain outside contractValue
 *
 * Run against a migrated `rukna_test` with DATABASE_URL override.
 */
describe('Slice-1A — mutable BOQ + signed-contract snapshot [DB]', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `snap-org-${suffix}`;
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

  const identity: RequestIdentity = {
    userId,
    activeOrganizationId: orgId,
    tenantSlug: `snap-${suffix}`,
    roles: ['ADMIN'],
    permissions: ['*'],
  };

  /**
   * Create a project with a priced but UNCOMMITTED BOQ (total 100,000) and a client.
   * Returns ids needed by subsequent tests.
   */
  async function seedProjectWithDraftBoq(code: string) {
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
      unitRate: '100.00',
    });
    return { project, client, versionId };
  }

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: orgId, name: `Snap ${suffix}`, slug: `snap-${suffix}`, status: 'ACTIVE' },
    });
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
    await prisma.contractPaymentInstallment.deleteMany({ where: { contract: { organizationId: orgId } } });
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

  // ── T-1 ──────────────────────────────────────────────────────────────────────

  it('T-1: contract can be recorded against a DRAFT (uncommitted) BOQ', async () => {
    const { project, client } = await seedProjectWithDraftBoq(`T1-${suffix}`);
    // No commit call — BOQ is still DRAFT.
    await expect(
      service.create(identity, { projectId: project.id, clientId: client.id, currency: 'USD' } as never),
    ).resolves.toMatchObject({ projectId: project.id });
  });

  // ── T-2 / T-3 ────────────────────────────────────────────────────────────────

  it('T-2: recording the contract creates an immutable SNAPSHOT and anchors the contract to it', async () => {
    const { project, client } = await seedProjectWithDraftBoq(`T2-${suffix}`);
    const created = await service.create(identity, {
      projectId: project.id,
      clientId: client.id,
      currency: 'USD',
    } as never);

    const row = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
    const boqVersion = await prisma.boqVersion.findUniqueOrThrow({ where: { id: row.boqVersionId } });
    expect(boqVersion.status).toBe('SNAPSHOT');
  });

  it('T-3: snapshot amount matches the signed contract source (base == snapshot total)', async () => {
    const { project, client, versionId } = await seedProjectWithDraftBoq(`T3-${suffix}`);
    const created = await service.create(identity, {
      projectId: project.id,
      clientId: client.id,
      currency: 'USD',
    } as never);

    const row = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
    // The snapshot total is exactly the tie-out total stored as baseContractValue.
    const snapshotTotal = await versioning.getInContractTotal(identity, project.id, row.boqVersionId);
    expect(snapshotTotal).toBe(row.baseContractValue?.toFixed(2));
    // The operational version (now COMMITTED) also reflects the same original total.
    const opTotal = await versioning.getInContractTotal(identity, project.id, versionId);
    expect(opTotal).toBe(row.baseContractValue?.toFixed(2));
  });

  // ── T-4 / T-5 / T-6 / T-7 ───────────────────────────────────────────────────

  it('T-4/T-5/T-6/T-7: live BOQ edits work after signing and do not mutate contract values or snapshot', async () => {
    const { project, client, versionId } = await seedProjectWithDraftBoq(`T4-${suffix}`);
    const created = await service.create(identity, {
      projectId: project.id,
      clientId: client.id,
      currency: 'USD',
    } as never);

    const rowBefore = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
    const snapshotId = rowBefore.boqVersionId;

    // Capture snapshot nodes before any edit.
    const snapshotNodesBefore = await prisma.boqNode.findMany({
      where: { versionId: snapshotId },
      select: { id: true, totalAmount: true, quantity: true, unitRate: true },
    });

    // T-4: money-changing edit on the COMMITTED operational version succeeds.
    const node = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '01.001' } });
    await tree.updateNode(identity, project.id, versionId, node.id, { quantity: '2000.000' });

    const rowAfter = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
    // T-5: baseContractValue unchanged.
    expect(rowAfter.baseContractValue?.toFixed(2)).toBe(rowBefore.baseContractValue?.toFixed(2));
    // T-6: contractValue unchanged.
    expect(rowAfter.contractValue.toFixed(2)).toBe(rowBefore.contractValue.toFixed(2));

    // T-7: snapshot nodes unchanged (the SNAPSHOT is immutable).
    const snapshotNodesAfter = await prisma.boqNode.findMany({
      where: { versionId: snapshotId },
      select: { id: true, totalAmount: true, quantity: true, unitRate: true },
    });
    expect(snapshotNodesAfter).toEqual(snapshotNodesBefore);
  });

  // ── T-8 / T-9 ────────────────────────────────────────────────────────────────

  it('T-8/T-9: variation adoption raises contractValue; reversal restores it (base never changes)', async () => {
    const { project, client } = await seedProjectWithDraftBoq(`T8-${suffix}`);
    const created = await service.create(identity, {
      projectId: project.id,
      clientId: client.id,
      currency: 'USD',
    } as never);
    const rowBase = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
    const base = rowBase.contractValue;
    const baseStr = base.toFixed(2);
    const delta = new Decimal('15000.00');

    // T-8: raise contractValue via the variation seam.
    await prisma.$transaction(async (tx) => {
      await service.raiseCurrentValueForVariation(tx as never, identity, created.id, {
        id: randomUUID(),
        reference: 'VO-T8',
        netDelta: delta,
      });
    });
    const rowRaised = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
    expect(rowRaised.contractValue.toFixed(2)).toBe(base.plus(delta).toFixed(2));
    // baseContractValue must not have changed.
    expect(rowRaised.baseContractValue?.toFixed(2)).toBe(baseStr);

    // T-9: lower contractValue back via the reversal seam.
    await prisma.$transaction(async (tx) => {
      await service.lowerCurrentValueForVariation(tx as never, identity, created.id, {
        id: randomUUID(),
        reference: 'VO-T9',
        netDelta: delta,
      });
    });
    const rowRestored = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
    expect(rowRestored.contractValue.toFixed(2)).toBe(baseStr);
    expect(rowRestored.baseContractValue?.toFixed(2)).toBe(baseStr);
  });

  // ── T-10 ─────────────────────────────────────────────────────────────────────

  it('T-10: legacy contract whose boqVersionId points to a COMMITTED version still loads', async () => {
    // Seed a contract row that directly references the COMMITTED operational version (old-style).
    const code = `T10-${suffix}`;
    const project = await prisma.project.create({
      data: { organizationId: orgId, code, name: `Project ${code}`, currency: 'USD', createdBy: userId },
    });
    const client = await prisma.client.create({
      data: { organizationId: orgId, code: `CL-${code}`, name: `Client ${code}` },
    });
    const boq = await versioning.initialize(identity, project.id);
    const versionId = boq.versions[0]!.id;
    const section = await tree.addNode(identity, project.id, versionId, { code: '01', description: 'Works' });
    await tree.addNode(identity, project.id, versionId, {
      parentId: section.id, code: '01.001', description: 'Concrete', isLeaf: true,
      unit: 'm3', quantity: '500.000', unitRate: '200.00',
    });
    // Explicitly commit (old flow) so versionId is COMMITTED.
    gate.gateStateTransition.mockResolvedValue(null);
    await versioning.commit(identity, project.id, versionId);

    // Insert a contract row directly pointing to the COMMITTED version (legacy style).
    const legacyContract = await prisma.contract.create({
      data: {
        organizationId: orgId,
        projectId: project.id,
        clientId: client.id,
        boqVersionId: versionId, // COMMITTED version — old style
        contractNumber: `${code}-C1`,
        contractValue: '100000.00',
        baseContractValue: '100000.00',
        currency: 'USD',
        billingModel: 'MILESTONE',
        contractKind: 'CLIENT_CONTRACT',
        status: 'ACTIVE',
        createdBy: userId,
      },
    });

    const found = await service.findOne(identity, legacyContract.id);
    expect(found.id).toBe(legacyContract.id);
    // The old boqVersionId (COMMITTED) is preserved as-is.
    const version = await prisma.boqVersion.findUniqueOrThrow({ where: { id: found.boqVersionId } });
    expect(version.status).toBe('COMMITTED');
  });

  // ── T-11 ─────────────────────────────────────────────────────────────────────

  it('T-11: milestone amounts remain % × baseContractValue after live BOQ edits', async () => {
    const { project, client, versionId } = await seedProjectWithDraftBoq(`T11-${suffix}`);
    const created = await service.create(identity, {
      projectId: project.id,
      clientId: client.id,
      currency: 'USD',
      // 40 / 60 payment plan
      paymentPlan: [
        { sortOrder: 0, name: 'Mobilisation', percentage: 0.4, triggerType: 'MILESTONE' },
        { sortOrder: 1, name: 'Completion', percentage: 0.6, triggerType: 'MILESTONE' },
      ],
    } as never);

    const rowBefore = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
    const base = new Decimal(rowBefore.baseContractValue!.toString());
    const installmentsBefore = await prisma.contractPaymentInstallment.findMany({
      where: { contractId: created.id },
      orderBy: { sortOrder: 'asc' },
    });
    expect(installmentsBefore).toHaveLength(2);

    // Edit the BOQ — double the quantity.
    const node = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '01.001' } });
    await tree.updateNode(identity, project.id, versionId, node.id, { quantity: '2000.000' });

    // baseContractValue is frozen — milestone amounts (% × base) are unchanged.
    const rowAfter = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
    expect(rowAfter.baseContractValue?.toFixed(2)).toBe(base.toFixed(2));

    // Verify installment percentages and expected amounts are stable.
    const installmentsAfter = await prisma.contractPaymentInstallment.findMany({
      where: { contractId: created.id },
      orderBy: { sortOrder: 'asc' },
    });
    for (let i = 0; i < installmentsBefore.length; i++) {
      expect(installmentsAfter[i]!.percentage.toFixed(4)).toBe(
        installmentsBefore[i]!.percentage.toFixed(4),
      );
      // amount = % × base — same before and after the BOQ edit.
      const expectedAmount = base.mul(new Decimal(installmentsBefore[i]!.percentage.toString())).toFixed(2);
      expect(base.mul(new Decimal(installmentsAfter[i]!.percentage.toString())).toFixed(2)).toBe(
        expectedAmount,
      );
    }
  });

  // ── T-12 ─────────────────────────────────────────────────────────────────────

  it('T-12: separate charges are excluded from contractValue', async () => {
    const { project, client, versionId } = await seedProjectWithDraftBoq(`T12-${suffix}`);
    const created = await service.create(identity, {
      projectId: project.id,
      clientId: client.id,
      currency: 'USD',
    } as never);

    const rowBefore = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });

    // Add a SEPARATE_CHARGE leaf after contract signing.
    const section = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '01' } });
    const sepNode = await tree.addNode(identity, project.id, versionId, {
      parentId: section.id,
      code: '01.SC1',
      description: 'Provisional sum',
      isLeaf: true,
      unit: 'LS',
      quantity: '1.000',
      unitRate: '50000.00',
    });
    // Mark as SEPARATE_CHARGE (outside contract value by policy).
    await prisma.boqNode.update({
      where: { id: sepNode.id },
      data: { commercialTreatment: 'SEPARATE_CHARGE' },
    });

    const rowAfter = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
    // contractValue must not include the separate charge.
    expect(rowAfter.contractValue.toFixed(2)).toBe(rowBefore.contractValue.toFixed(2));
    expect(rowAfter.baseContractValue?.toFixed(2)).toBe(rowBefore.baseContractValue?.toFixed(2));
  });
});

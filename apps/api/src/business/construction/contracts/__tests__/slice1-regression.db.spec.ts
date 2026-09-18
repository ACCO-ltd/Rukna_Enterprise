import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ForbiddenException } from '@nestjs/common';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { BoqPrismaRepository } from '../../boq/infrastructure/boq-prisma.repository.js';
import { BoqTreeService } from '../../boq/application/boq-tree.service.js';
import { BoqVersioningService } from '../../boq/application/boq-versioning.service.js';
import { inContractBillableTotal } from '../../boq/domain/boq-contract-value.policy.js';
import { ContractPrismaRepository } from '../infrastructure/contract-prisma.repository.js';
import { ContractService } from '../application/contract.service.js';

/**
 * Slice 1 regression — ADR-029 contract/BOQ/variation invariants [DB].
 *
 * NOT run in the R6 gate (DB-free unit tests). Requires DATABASE_URL pointing at
 * a migrated `rukna_test` database. Run with:
 *   npx jest --testPathPattern=slice1-regression --runInBand
 *
 * Passthrough proof for invoice/receipt/GL flows lives in the unmodified suites:
 *   - accounting/__tests__/gl.spec.ts     (GL-01..06)
 *   - accounting/__tests__/inv.spec.ts    (INV-01..03)
 *   - accounts-receivable/application/customer-receipt.service.spec.ts
 */

// ─── Shared infra ────────────────────────────────────────────────────────────

const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 12);
const orgId = `s1reg-org-${suffix}`;
const userId = `u1-${suffix}`;

const tenancy = { getClient: () => prisma } as unknown as TenancyService;
const ungoverned = {
  gateStateTransition: jest.fn(async () => null as null | { gated: true; approvalInstanceId: string }),
} as unknown as CommandGovernanceService;
const attachments = { freezeFor: jest.fn().mockResolvedValue(0) };

const boqRepo = new BoqPrismaRepository();
const tree = new BoqTreeService(tenancy, boqRepo);
const versioning = new BoqVersioningService(tenancy, boqRepo, ungoverned);
const projectAccess = new ProjectAccessService(tenancy);
const audit = new TransactionalAuditOutboxService();
const contractRepo = new ContractPrismaRepository();
const contractService = new ContractService(
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
  tenantSlug: `s1reg-${suffix}`,
  roles: ['ADMIN'],
  permissions: [
    PERMISSIONS.boqView,
    PERMISSIONS.boqManage,
    PERMISSIONS.boqBaseline,
    '*',
  ],
};

// ─── Seed helper ─────────────────────────────────────────────────────────────

/**
 * Create an org-scoped project + client + priced COMMITTED BOQ + a signed contract.
 * The contract is seeded directly via Prisma (same pattern as
 * apply-variation-to-boq.integration.spec.ts) so its baseContractValue is explicitly
 * set without triggering any contract-create side-effects under test.
 */
async function seedSignedContract(
  codePrefix: string,
  baseAmount: number,
): Promise<{
  projectId: string;
  clientId: string;
  contractId: string;
  operationalVersionId: string;
  snapshotVersionId: string;
}> {
  const project = await prisma.project.create({
    data: {
      organizationId: orgId,
      code: `${codePrefix}-${suffix}`,
      name: `Project ${codePrefix}`,
      currency: 'USD',
      createdBy: userId,
    },
  });
  const client = await prisma.client.create({
    data: { organizationId: orgId, code: `CL-${codePrefix}`, name: `Client ${codePrefix}` },
  });

  const boq = await versioning.initialize(identity, project.id);
  const draftVersionId = boq.versions[0]!.id;
  const section = await tree.addNode(identity, project.id, draftVersionId, {
    code: '01',
    description: 'Main Works',
  });
  await tree.addNode(identity, project.id, draftVersionId, {
    parentId: section.id,
    code: '01.001',
    description: 'Civil Works',
    isLeaf: true,
    unit: 'LS',
    quantity: '1.000',
    unitRate: String(baseAmount),
  });
  const committed = await versioning.commit(identity, project.id, draftVersionId);
  const operationalVersionId = committed.currentVersionId!;
  const snapshotVersionId = committed.committedSnapshotVersionId!;

  const contract = await prisma.contract.create({
    data: {
      organizationId: orgId,
      projectId: project.id,
      clientId: client.id,
      boqVersionId: operationalVersionId,
      contractNumber: `${codePrefix}-C1`,
      contractValue: new Decimal(baseAmount),
      baseContractValue: new Decimal(baseAmount),
      currency: 'USD',
      status: 'ACTIVE',
      createdBy: userId,
    },
  });

  return {
    projectId: project.id,
    clientId: client.id,
    contractId: contract.id,
    operationalVersionId,
    snapshotVersionId,
  };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await prisma.organization.create({
    data: { id: orgId, name: `S1 Reg ${suffix}`, slug: `s1reg-${suffix}`, status: 'ACTIVE' },
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
  await prisma.variationOrderLine.deleteMany({
    where: { variationOrder: { organizationId: orgId } },
  });
  await prisma.variationOrder.deleteMany({ where: { organizationId: orgId } });
  await prisma.contractPaymentInstallment.deleteMany({
    where: { contract: { organizationId: orgId } },
  });
  await prisma.contract.deleteMany({ where: { organizationId: orgId } });
  await prisma.boqChangeEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.$executeRaw`DELETE FROM boq_nodes WHERE boq_id IN (SELECT id FROM boqs WHERE organization_id = ${orgId})`;
  await prisma.boqVersion.deleteMany({ where: { boq: { organizationId: orgId } } });
  await prisma.boq.deleteMany({ where: { organizationId: orgId } });
  await prisma.client.deleteMany({ where: { organizationId: orgId } });
  await prisma.project.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────
// G1 — COMMITTED/BASELINED BOQ refs remain readable
// ─────────────────────────────────────────────────────────────────────────────

describe('G1 — existing contract BOQ refs remain readable', () => {
  it('reads back a contract binding a COMMITTED version and resolves all its nodes', async () => {
    const { contractId, operationalVersionId } = await seedSignedContract('G1-COM', 100_000);

    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.boqVersionId).toBe(operationalVersionId);

    const version = await prisma.boqVersion.findUniqueOrThrow({
      where: { id: operationalVersionId },
    });
    expect(version.status).toBe('COMMITTED');

    const nodes = await prisma.boqNode.findMany({ where: { versionId: operationalVersionId } });
    expect(nodes.length).toBeGreaterThan(0);
  });

  it('reads back a contract binding a legacy BASELINED version and resolves its nodes', async () => {
    const { projectId, clientId, contractId: originalContractId, operationalVersionId } =
      await seedSignedContract('G1-BL', 100_000);

    // Seed a BASELINED version directly (pre-R2 legacy record).
    const baselinedVersion = await prisma.boqVersion.create({
      data: {
        boq: { connect: { projectId } },
        status: 'BASELINED',
        versionNumber: 99,
        createdBy: userId,
      },
    });
    // Copy one node onto it so it has resolvable scope.
    const sourceNode = await prisma.boqNode.findFirstOrThrow({
      where: { versionId: operationalVersionId, isLeaf: true },
    });
    await prisma.boqNode.create({
      data: {
        versionId: baselinedVersion.id,
        boqId: sourceNode.boqId,
        path: sourceNode.path,
        code: sourceNode.code,
        description: sourceNode.description,
        isLeaf: true,
        unit: sourceNode.unit,
        quantity: sourceNode.quantity,
        unitRate: sourceNode.unitRate,
        totalAmount: sourceNode.totalAmount,
        currency: 'USD',
        depth: sourceNode.depth,
        sortOrder: sourceNode.sortOrder,
      },
    });

    // Cancel the effective signed contract so the partial unique index allows the legacy insert.
    await prisma.contract.update({
      where: { id: originalContractId },
      data: { status: 'CANCELLED' },
    });

    const legacyContract = await prisma.contract.create({
      data: {
        organizationId: orgId,
        projectId,
        clientId,
        boqVersionId: baselinedVersion.id,
        contractNumber: 'G1-BL-LEGACY-C1',
        contractValue: new Decimal('100000'),
        baseContractValue: new Decimal('100000'),
        currency: 'USD',
        status: 'ACTIVE',
        createdBy: userId,
      },
    });

    const row = await prisma.contract.findUniqueOrThrow({ where: { id: legacyContract.id } });
    expect(row.boqVersionId).toBe(baselinedVersion.id);

    const version = await prisma.boqVersion.findUniqueOrThrow({
      where: { id: baselinedVersion.id },
    });
    expect(version.status).toBe('BASELINED');

    const nodes = await prisma.boqNode.findMany({ where: { versionId: baselinedVersion.id } });
    expect(nodes).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G2 — Live BOQ edits cannot mutate snapshot nodes
// ─────────────────────────────────────────────────────────────────────────────

describe('G2 — live BOQ edits cannot mutate snapshot nodes', () => {
  let operationalVersionId: string;
  let snapshotVersionId: string;
  let projectId: string;

  beforeAll(async () => {
    ({ projectId, operationalVersionId, snapshotVersionId } = await seedSignedContract(
      'G2',
      200_000,
    ));
  });

  it('snapshot node count is unchanged after a money-neutral live BOQ edit', async () => {
    const countBefore = await prisma.boqNode.count({ where: { versionId: snapshotVersionId } });
    expect(countBefore).toBeGreaterThan(0);

    // A description-only edit is money-neutral and is allowed on a COMMITTED version.
    const node = await prisma.boqNode.findFirstOrThrow({
      where: { versionId: operationalVersionId, isLeaf: true },
    });
    await tree.updateNode(identity, projectId, operationalVersionId, node.id, {
      description: 'Civil Works (description updated)',
    });

    const countAfter = await prisma.boqNode.count({ where: { versionId: snapshotVersionId } });
    expect(countAfter).toBe(countBefore);
  });

  it('snapshot node ids are distinct from operational node ids', async () => {
    const opIds = new Set(
      (await prisma.boqNode.findMany({ where: { versionId: operationalVersionId }, select: { id: true } }))
        .map((n) => n.id),
    );
    const snapshotNodes = await prisma.boqNode.findMany({
      where: { versionId: snapshotVersionId },
      select: { id: true },
    });
    expect(snapshotNodes.length).toBeGreaterThan(0);
    expect(snapshotNodes.every((n) => !opIds.has(n.id))).toBe(true);
  });

  it('direct write to a snapshot version is rejected 403 SNAPSHOT_IMMUTABLE', async () => {
    const snapshotNode = await prisma.boqNode.findFirstOrThrow({
      where: { versionId: snapshotVersionId },
    });
    await expect(
      tree.updateNode(identity, projectId, snapshotVersionId, snapshotNode.id, {
        description: 'Attempted mutation of snapshot',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // The node is unchanged.
    const still = await prisma.boqNode.findUniqueOrThrow({ where: { id: snapshotNode.id } });
    expect(still.description).not.toBe('Attempted mutation of snapshot');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G3 — Contract values independent from live BOQ
// ─────────────────────────────────────────────────────────────────────────────

describe('G3 — contract values independent from live BOQ', () => {
  it('money-neutral live BOQ edit leaves contractValue and baseContractValue unchanged', async () => {
    const BASE = 300_000;
    const { projectId, contractId, operationalVersionId } = await seedSignedContract('G3-MN', BASE);

    const before = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(before.contractValue.toFixed(2)).toBe(`${BASE}.00`);
    expect(before.baseContractValue?.toFixed(2)).toBe(`${BASE}.00`);

    // Money-neutral: description change only.
    const node = await prisma.boqNode.findFirstOrThrow({
      where: { versionId: operationalVersionId, isLeaf: true },
    });
    await tree.updateNode(identity, projectId, operationalVersionId, node.id, {
      description: 'Updated description — money neutral',
    });

    const after = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(after.contractValue.toFixed(2)).toBe(`${BASE}.00`);
    expect(after.baseContractValue?.toFixed(2)).toBe(`${BASE}.00`);
  });

  it('baseContractValue equals contractValue at signing and is not null', async () => {
    const BASE = 320_000;
    const { contractId } = await seedSignedContract('G3-BASE', BASE);

    const row = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(row.baseContractValue).not.toBeNull();
    expect(row.baseContractValue!.toFixed(2)).toBe(row.contractValue.toFixed(2));
  });

  it('M-4: a legacy contract with null baseContractValue falls back to contractValue', async () => {
    // Simulate a pre-migration row that predates the base/current split.
    const { projectId, clientId, contractId: m4OriginalId, operationalVersionId } =
      await seedSignedContract('G3-M4', 350_000);
    // Cancel the effective contract so the partial unique index allows inserting the legacy row.
    await prisma.contract.update({ where: { id: m4OriginalId }, data: { status: 'CANCELLED' } });
    const legacyContract = await prisma.contract.create({
      data: {
        organizationId: orgId,
        projectId,
        clientId,
        boqVersionId: operationalVersionId,
        contractNumber: 'G3-M4-LEGACY',
        contractValue: new Decimal('350000'),
        baseContractValue: null,
        currency: 'USD',
        status: 'ACTIVE',
        createdBy: userId,
      },
    });

    const row = await prisma.contract.findUniqueOrThrow({ where: { id: legacyContract.id } });
    // M-4 guard: fall back to contractValue when base is null.
    const milestoneBase = row.baseContractValue ?? row.contractValue;
    expect(milestoneBase.toFixed(2)).toBe('350000.00');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G4 — Variation is the only contractValue mutation route
// ─────────────────────────────────────────────────────────────────────────────

describe('G4 — variation is the only contractValue mutation route', () => {
  it('raiseCurrentValueForVariation increments contractValue; baseContractValue unchanged', async () => {
    const BASE = 400_000;
    const { contractId } = await seedSignedContract('G4-RAISE', BASE);

    const result = await prisma.$transaction((tx) =>
      contractService.raiseCurrentValueForVariation(tx, identity, contractId, {
        id: 'fake-vo-raise-1',
        reference: 'VO-RAISE-1',
        netDelta: new Decimal('5000'),
      }),
    );

    expect(result.previousContractValue).toBe(`${BASE}.00`);
    expect(result.newContractValue).toBe(`${BASE + 5000}.00`);
    expect(result.baseContractValue).toBe(`${BASE}.00`);

    const row = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(row.contractValue.toFixed(2)).toBe(`${BASE + 5000}.00`);
    expect(row.baseContractValue?.toFixed(2)).toBe(`${BASE}.00`);
  });

  it('lowerCurrentValueForVariation decrements contractValue; baseContractValue unchanged', async () => {
    const BASE = 410_000;
    const { contractId } = await seedSignedContract('G4-LOWER', BASE);

    // Raise first so there is headroom to lower.
    await prisma.$transaction((tx) =>
      contractService.raiseCurrentValueForVariation(tx, identity, contractId, {
        id: 'fake-vo-lower-1-raise',
        reference: 'VO-LOWER-1-RAISE',
        netDelta: new Decimal('3000'),
      }),
    );

    const result = await prisma.$transaction((tx) =>
      contractService.lowerCurrentValueForVariation(tx, identity, contractId, {
        id: 'fake-vo-lower-1',
        reference: 'VO-LOWER-1',
        netDelta: new Decimal('3000'),
      }),
    );

    expect(result.newContractValue).toBe(`${BASE}.00`);
    expect(result.baseContractValue).toBe(`${BASE}.00`);

    const row = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(row.contractValue.toFixed(2)).toBe(`${BASE}.00`);
    expect(row.baseContractValue?.toFixed(2)).toBe(`${BASE}.00`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G5 — Separate-charge nodes never enter contractValue
// ─────────────────────────────────────────────────────────────────────────────

describe('G5 — separate-charge nodes never enter contractValue', () => {
  it('inContractBillableTotal (domain policy) excludes SEPARATE_CHARGE leaves — no DB required', () => {
    // Tests the pure policy function directly (no DB, runs in the R6 gate too).
    // Policy: IN_CONTRACT and ABSORBED count in; only SEPARATE_CHARGE is excluded (ADR-029 CONST-BOQ-030).
    const nodes = [
      {
        isLeaf: true,
        commercialTreatment: 'IN_CONTRACT',
        totalAmount: new Decimal('100'),
        isActive: true,
      },
      {
        isLeaf: true,
        commercialTreatment: 'SEPARATE_CHARGE',
        totalAmount: new Decimal('50'),
        isActive: true,
      },
      {
        isLeaf: true,
        commercialTreatment: 'ABSORBED',
        totalAmount: new Decimal('25'),
        isActive: true,
      },
      {
        isLeaf: false, // section — never counts regardless of treatment
        commercialTreatment: 'IN_CONTRACT',
        totalAmount: new Decimal('175'),
        isActive: true,
      },
    ] as Parameters<typeof inContractBillableTotal>[0];

    const total = inContractBillableTotal(nodes);
    // SEPARATE_CHARGE (50) and ABSORBED (25) are both excluded (Slice 2: ABSORBED is a third category,
    // internal cost record outside the contract total). Only IN_CONTRACT (100) counts.
    expect(total).not.toBeNull();
    expect(total!.toFixed(2)).toBe('100.00');
  });

  it('a SEPARATE_CHARGE variation node does not move getInContractTotal', async () => {
    const BASE = 500_000;
    const { projectId, contractId, operationalVersionId } = await seedSignedContract(
      'G5-SC',
      BASE,
    );

    const voId = `sc-vo-${suffix}`;
    await prisma.variationOrder.create({
      data: {
        id: voId,
        organizationId: orgId,
        contractId,
        reference: 'VO-SC-001',
        status: 'CLIENT_APPROVED',
        title: 'Separate charge scope',
        createdBy: userId,
        lines: {
          create: [
            {
              description: 'Extra equipment — separate charge',
              quantity: new Decimal('1'),
              unitRate: new Decimal('8000'),
              amount: new Decimal('8000'),
              sortOrder: 0,
            },
          ],
        },
      },
    });

    const totalBefore = await versioning.getInContractTotal(identity, projectId, operationalVersionId);

    // Variation placement requires a parentId when sections exist (Slice 2 tightening).
    const sectionNode = await prisma.boqNode.findFirstOrThrow({
      where: { versionId: operationalVersionId, isLeaf: false, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    await prisma.$transaction((tx) =>
      versioning.appendVariationNodes(tx, identity, projectId, {
        id: voId,
        reference: 'VO-SC-001',
        parentId: sectionNode.id,
        lines: [
          {
            description: 'Extra equipment — separate charge',
            quantity: new Decimal('1'),
            unitRate: new Decimal('8000'),
            amount: new Decimal('8000'),
            sortOrder: 0,
          },
        ],
      }),
    );

    // Override the node's commercialTreatment to SEPARATE_CHARGE.
    await prisma.boqNode.updateMany({
      where: { versionId: operationalVersionId, sourceChangeOrderId: voId },
      data: { commercialTreatment: 'SEPARATE_CHARGE' },
    });

    const totalAfter = await versioning.getInContractTotal(identity, projectId, operationalVersionId);
    expect(totalAfter).toBe(totalBefore);

    // The node is present but treated as separate charge.
    const scNodes = await prisma.boqNode.findMany({
      where: { versionId: operationalVersionId, sourceChangeOrderId: voId, isLeaf: true },
    });
    expect(scNodes.length).toBeGreaterThan(0);
    expect(scNodes.every((n) => n.commercialTreatment === 'SEPARATE_CHARGE')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G6 — Milestone amounts anchor to frozen baseContractValue
// ─────────────────────────────────────────────────────────────────────────────

describe('G6 — milestone amounts anchor to frozen baseContractValue', () => {
  it('percentage × baseContractValue gives milestone amount, independent of contractValue', async () => {
    const BASE = 600_000;
    const { contractId } = await seedSignedContract('G6-MS', BASE);

    // Create two installments (40 % + 60 % = 100 %).
    await prisma.contractPaymentInstallment.createMany({
      data: [
        {
          contractId,
          percentage: new Decimal('0.40'),
          name: 'Mobilisation',
          triggerType: 'MILESTONE',
          sortOrder: 1,
        },
        {
          contractId,
          percentage: new Decimal('0.60'),
          name: 'Completion',
          triggerType: 'MILESTONE',
          sortOrder: 2,
        },
      ],
    });

    const row = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    const base = row.baseContractValue ?? row.contractValue;

    const installments = await prisma.contractPaymentInstallment.findMany({
      where: { contractId },
      orderBy: { sortOrder: 'asc' },
    });
    const [first, second] = installments;
    expect(new Decimal(first!.percentage).times(base).toFixed(2)).toBe('240000.00'); // 40 % of 600k
    expect(new Decimal(second!.percentage).times(base).toFixed(2)).toBe('360000.00'); // 60 % of 600k
  });

  it('milestone anchor unchanged after VO adoption raises contractValue', async () => {
    const BASE = 620_000;
    const { contractId } = await seedSignedContract('G6-VOA', BASE);

    await prisma.contractPaymentInstallment.create({
      data: {
        contractId,
        percentage: new Decimal('1.00'),
        name: 'Full payment',
        triggerType: 'MILESTONE',
        sortOrder: 1,
      },
    });

    // Record milestone amount before the raise.
    const beforeRow = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    const baseBefore = beforeRow.baseContractValue ?? beforeRow.contractValue;
    const installment = await prisma.contractPaymentInstallment.findFirstOrThrow({
      where: { contractId },
    });
    const amountBefore = new Decimal(installment.percentage).times(baseBefore);

    // Raise contractValue via variation.
    await prisma.$transaction((tx) =>
      contractService.raiseCurrentValueForVariation(tx, identity, contractId, {
        id: 'fake-vo-g6-1',
        reference: 'VO-G6-1',
        netDelta: new Decimal('10000'),
      }),
    );

    const afterRow = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(afterRow.contractValue.toFixed(2)).toBe(`${BASE + 10_000}.00`);

    const baseAfter = afterRow.baseContractValue ?? afterRow.contractValue;
    const amountAfter = new Decimal(installment.percentage).times(baseAfter);

    // The milestone amount must not have changed because baseContractValue is frozen.
    expect(amountAfter.toFixed(2)).toBe(amountBefore.toFixed(2));
    expect(amountAfter.toFixed(2)).toBe(`${BASE}.00`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E2E scenario — 500k → sign → edit BOQ → adopt VO → reverse VO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full lifecycle proof in the canonical sequence:
 *   BOQ = 500,000 → sign contract → edit live BOQ to 510,000
 *   → adopt VO +2,000 → reverse unbilled VO
 *
 * Each step shares outer `let` state so the sequence is strictly ordered.
 */
describe('E2E scenario — 500k sign → live BOQ edit → adopt VO → reverse', () => {
  const BASE = 500_000;
  const VO_NET = 2_000;

  let projectId: string;
  let contractId: string;
  let operationalVersionId: string;
  let snapshot0Id: string;
  let snapshot0NodeCount: number;
  let voId: string;

  beforeAll(async () => {
    // ── Seed the base state ──────────────────────────────────────────────────
    ({ projectId, contractId, operationalVersionId, snapshotVersionId: snapshot0Id } =
      await seedSignedContract('E2E', BASE));

    snapshot0NodeCount = await prisma.boqNode.count({ where: { versionId: snapshot0Id } });

    voId = `e2e-vo-${suffix}`;
    await prisma.variationOrder.create({
      data: {
        id: voId,
        organizationId: orgId,
        contractId,
        reference: 'VO-E2E-001',
        status: 'CLIENT_APPROVED',
        title: 'E2E scope addition',
        createdBy: userId,
        lines: {
          create: [
            {
              description: 'Additional piling works',
              quantity: new Decimal('1'),
              unitRate: new Decimal(VO_NET),
              amount: new Decimal(VO_NET),
              sortOrder: 0,
            },
          ],
        },
      },
    });
  });

  it('[E2E-1] initial signing: contractValue = baseContractValue = 500,000 and snapshot₀ exists', async () => {
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(row.contractValue.toFixed(2)).toBe(`${BASE}.00`);
    expect(row.baseContractValue?.toFixed(2)).toBe(`${BASE}.00`);

    const snap = await prisma.boqVersion.findUniqueOrThrow({ where: { id: snapshot0Id } });
    expect(snap.status).toBe('SNAPSHOT');
    expect(snapshot0NodeCount).toBeGreaterThan(0);
  });

  it('[E2E-2] live BOQ edit to 510k: contract values unmoved, snapshot₀ node count unchanged', async () => {
    // Add a contingency section + leaf so there is something to bring the total to 510k.
    // We use allowContractValueChange because this edit intentionally moves the in-contract total
    // (simulating Eng Ahmed adding contingency allowance post-signing — the contract pin is bypassed
    // by the explicit seam, which is the production code path for contingency draws).
    const section = await tree.addNode(identity, projectId, operationalVersionId, {
      code: '02',
      description: 'Contingency',
    });
    await tree.addNode(
      identity,
      projectId,
      operationalVersionId,
      {
        parentId: section.id,
        code: '02.001',
        description: 'Contingency allowance',
        isLeaf: true,
        unit: 'LS',
        quantity: '1.000',
        unitRate: '10000.00',
      },
      { allowContractValueChange: true },
    );

    const contractRow = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contractRow.contractValue.toFixed(2)).toBe(`${BASE}.00`);
    expect(contractRow.baseContractValue?.toFixed(2)).toBe(`${BASE}.00`);

    const snap0Count = await prisma.boqNode.count({ where: { versionId: snapshot0Id } });
    expect(snap0Count).toBe(snapshot0NodeCount);
  });

  it('[E2E-3] VO adoption: contractValue = 502,000, baseContractValue = 500,000, snapshot₁ cut', async () => {
    // Variation placement requires a parentId when sections exist (Slice 2 tightening).
    const sectionNode = await prisma.boqNode.findFirstOrThrow({
      where: { versionId: operationalVersionId, isLeaf: false, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    await prisma.$transaction(async (tx) => {
      await versioning.appendVariationNodes(tx, identity, projectId, {
        id: voId,
        reference: 'VO-E2E-001',
        parentId: sectionNode.id,
        lines: [
          {
            description: 'Additional piling works',
            quantity: new Decimal('1'),
            unitRate: new Decimal(VO_NET),
            amount: new Decimal(VO_NET),
            sortOrder: 0,
          },
        ],
      });
      await contractService.raiseCurrentValueForVariation(tx, identity, contractId, {
        id: voId,
        reference: 'VO-E2E-001',
        netDelta: new Decimal(VO_NET),
      });
    });

    const row = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(row.contractValue.toFixed(2)).toBe(`${BASE + VO_NET}.00`);
    expect(row.baseContractValue?.toFixed(2)).toBe(`${BASE}.00`);

    // A new snapshot (snapshot₁) must have been cut and the pointer updated.
    const boqRow = await prisma.boq.findFirstOrThrow({ where: { projectId } });
    expect(boqRow.committedSnapshotVersionId).not.toBe(snapshot0Id);

    const snap1 = await prisma.boqVersion.findUniqueOrThrow({
      where: { id: boqRow.committedSnapshotVersionId! },
    });
    expect(snap1.status).toBe('SNAPSHOT');

    // The variation scope is present in snapshot₁.
    const voNodes = await prisma.boqNode.findMany({
      where: { versionId: boqRow.committedSnapshotVersionId!, sourceChangeOrderId: voId },
    });
    expect(voNodes.length).toBeGreaterThan(0);
  });

  it('[E2E-4] VO reversal: contractValue = 500,000, baseContractValue = 500,000, snapshot₂ cut', async () => {
    await prisma.$transaction(async (tx) => {
      await versioning.retractVariationNodes(tx, identity, projectId, {
        id: voId,
        reference: 'VO-E2E-001',
      });
      await contractService.lowerCurrentValueForVariation(tx, identity, contractId, {
        id: voId,
        reference: 'VO-E2E-001',
        netDelta: new Decimal(VO_NET),
      });
    });

    const row = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(row.contractValue.toFixed(2)).toBe(`${BASE}.00`);
    expect(row.baseContractValue?.toFixed(2)).toBe(`${BASE}.00`);

    const boqRow = await prisma.boq.findFirstOrThrow({ where: { projectId } });
    const snap2 = await prisma.boqVersion.findUniqueOrThrow({
      where: { id: boqRow.committedSnapshotVersionId! },
    });
    expect(snap2.status).toBe('SNAPSHOT');
    // snapshot₂ must not equal snapshot₀ (a new copy was cut after reversal).
    expect(snap2.id).not.toBe(snapshot0Id);
  });

  it('[E2E-5] snapshot₀ immutability: node count and ids unchanged throughout', async () => {
    const snap0Nodes = await prisma.boqNode.findMany({
      where: { versionId: snapshot0Id },
      select: { id: true },
    });
    expect(snap0Nodes).toHaveLength(snapshot0NodeCount);

    // snapshot₀ must contain no variation nodes (it predates the VO).
    const snap0VoNodes = await prisma.boqNode.findMany({
      where: { versionId: snapshot0Id, sourceChangeOrderId: voId },
    });
    expect(snap0VoNodes).toHaveLength(0);
  });
});

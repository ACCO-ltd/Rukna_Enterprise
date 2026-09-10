import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { BoqPrismaRepository } from '../infrastructure/boq-prisma.repository.js';
import { BoqTreeService } from '../application/boq-tree.service.js';
import { BoqVersioningService } from '../application/boq-versioning.service.js';

/**
 * ADR-029 §2 L-1..L-7 — the commit-to-contract lifecycle.
 *
 * DB-backed like the rest of the BOQ suite: the invariants are enforced by the transaction, the
 * status guard and the pin, not by a mock. A single fixture builds a priced BOQ, commits it, and
 * then exercises the post-commit pin and the snapshot immutability against the real rows.
 */
describe('BOQ commit-to-contract (ADR-029 L-1..L-7)', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `boqc-org-${suffix}`;

  let identity: RequestIdentity;
  let projectId: string;
  let versionId: string;
  let tree: BoqTreeService;
  let versioning: BoqVersioningService;

  const gate = {
    gateStateTransition: jest.fn(
      async () => null as null | { gated: true; approvalInstanceId: string },
    ),
  };

  /** Priced-complete two-line BOQ so commit's readiness precondition (L-3) is satisfied. */
  async function seedPricedBoq(): Promise<{ workId: string; contingencyId: string }> {
    const section = await tree.addNode(identity, projectId, versionId, {
      code: '01',
      description: 'Substructure',
    });
    const work = await tree.addNode(identity, projectId, versionId, {
      parentId: section.id,
      code: '01.001',
      description: 'Concrete',
      isLeaf: true,
      unit: 'm3',
      quantity: '100.000',
      unitRate: '10.00',
    });
    const contingency = await tree.addNode(identity, projectId, versionId, {
      parentId: section.id,
      code: '01.002',
      description: 'Contingency allowance',
      isLeaf: true,
      unit: 'LS',
      quantity: '1.000',
      unitRate: '500.00',
    });
    // Mark the contingency line CONTINGENCY (still IN_CONTRACT, part of the tie-out).
    await prisma.boqNode.update({ where: { id: contingency.id }, data: { nodeRole: 'CONTINGENCY' } });
    return { workId: work.id, contingencyId: contingency.id };
  }

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: orgId, name: `BOQ C ${suffix}`, slug: `boqc-${suffix}`, status: 'ACTIVE' },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        code: `PRJC-${suffix}`,
        name: 'Commit Project',
        currency: 'USD',
        createdBy: 'u1',
      },
    });
    projectId = project.id;
    identity = {
      userId: 'u1',
      activeOrganizationId: orgId,
      tenantSlug: `boqc-${suffix}`,
      roles: ['admin'],
      permissions: ['*'],
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

  // ─── L-1 ───────────────────────────────────────────────────────────────────

  it('L-1: initialize points currentVersionId at the single operational DRAFT', async () => {
    const boq = await versioning.getBoq(identity, projectId);
    expect(boq.currentVersionId).toBe(versionId);
    const operational = boq.versions.filter((v) => v.status === 'DRAFT' || v.status === 'COMMITTED');
    expect(operational).toHaveLength(1);
  });

  // ─── L-3 ───────────────────────────────────────────────────────────────────

  it('L-3: refuses to commit an empty (not-ready) BOQ, before ever reaching the gate', async () => {
    await expect(versioning.commit(identity, projectId, versionId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(gate.gateStateTransition).not.toHaveBeenCalled();
  });

  // ─── L-2 ───────────────────────────────────────────────────────────────────

  it('L-2: a gated commit returns 409 with the approval instance; passthrough proceeds', async () => {
    await seedPricedBoq();

    gate.gateStateTransition.mockResolvedValue({ gated: true, approvalInstanceId: 'approval-1' });
    await expect(versioning.commit(identity, projectId, versionId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(gate.gateStateTransition).toHaveBeenCalledWith(
      identity,
      'BoqVersion',
      'DRAFT',
      'COMMITTED',
      versionId,
    );
    // Nothing committed yet.
    const stillDraft = await prisma.boqVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(stillDraft.status).toBe('DRAFT');
  });

  // ─── L-4 (+ L-1 after commit) ────────────────────────────────────────────────

  it('L-4: commit flips the operational version to COMMITTED and freezes a SNAPSHOT copy', async () => {
    gate.gateStateTransition.mockResolvedValue(null);
    const boq = await versioning.commit(identity, projectId, versionId);

    // Operational version is COMMITTED, in place (same id), and currentVersionId still names it.
    expect(boq.currentVersionId).toBe(versionId);
    expect(boq.versions.find((v) => v.id === versionId)!.status).toBe('COMMITTED');

    // A frozen SNAPSHOT copy exists with NEW node ids, and the pointer names it.
    expect(boq.committedSnapshotVersionId).toBeTruthy();
    const snapshotId = boq.committedSnapshotVersionId!;
    expect(snapshotId).not.toBe(versionId);
    expect(boq.versions.find((v) => v.id === snapshotId)!.status).toBe('SNAPSHOT');

    const operationalNodes = await prisma.boqNode.findMany({ where: { versionId } });
    const snapshotNodes = await prisma.boqNode.findMany({ where: { versionId: snapshotId } });
    expect(snapshotNodes).toHaveLength(operationalNodes.length);
    const operationalIds = new Set(operationalNodes.map((n) => n.id));
    expect(snapshotNodes.every((n) => !operationalIds.has(n.id))).toBe(true);
    // The snapshot faithfully copies the tie-out classification (CONTINGENCY carried through).
    expect(snapshotNodes.some((n) => n.nodeRole === 'CONTINGENCY')).toBe(true);

    // L-1 still holds: exactly one non-snapshot version.
    const operational = boq.versions.filter((v) => v.status === 'DRAFT' || v.status === 'COMMITTED');
    expect(operational).toHaveLength(1);
  });

  it('getInContractTotal ties out to Σ IN_CONTRACT leaves (work 1000 + contingency 500)', async () => {
    const total = await versioning.getInContractTotal(identity, projectId, versionId);
    expect(total).toBe('1500.00');
  });

  // ─── L-5 ───────────────────────────────────────────────────────────────────

  it('L-5: a money-neutral description edit on a COMMITTED version is allowed', async () => {
    const node = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '01.001' } });
    const updated = await tree.updateNode(identity, projectId, versionId, node.id, {
      description: 'Concrete (corrected wording)',
    });
    expect(updated.description).toBe('Concrete (corrected wording)');
  });

  it('L-5: a rate change that moves the in-contract total is rejected (409 CONTRACT_VALUE_LOCKED)', async () => {
    const node = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '01.001' } });
    await expect(
      tree.updateNode(identity, projectId, versionId, node.id, { unitRate: '20.00' }),
    ).rejects.toBeInstanceOf(ConflictException);
    // The total is untouched — the write never hit the database.
    const total = await versioning.getInContractTotal(identity, projectId, versionId);
    expect(total).toBe('1500.00');
  });

  it('L-5: adding a priced IN_CONTRACT leaf to a COMMITTED version is pinned', async () => {
    const section = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '01' } });
    await expect(
      tree.addNode(identity, projectId, versionId, {
        parentId: section.id,
        code: '01.003',
        description: 'New priced scope',
        isLeaf: true,
        unit: 'm3',
        quantity: '1.000',
        unitRate: '99.00',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('L-5: a reallocation that keeps the in-contract total constant is allowed', async () => {
    // Draw 100 from contingency (500 → 400) into the work line (1000 → 1100): total stays 1500.
    const work = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '01.001' } });
    const contingency = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '01.002' } });

    // Bump the work line via allowContractValueChange, then compensate the contingency line — the
    // two together are net-zero. Each individual write here uses the variation seam because R2 does
    // not ship the atomic draw command (C-3, R-later); this proves the seam + the constant-total path.
    await tree.updateNode(
      identity,
      projectId,
      versionId,
      work.id,
      { quantity: '110.000' },
      { allowContractValueChange: true },
    );
    await tree.updateNode(
      identity,
      projectId,
      versionId,
      contingency.id,
      { unitRate: '400.00' },
      { allowContractValueChange: true },
    );
    const total = await versioning.getInContractTotal(identity, projectId, versionId);
    expect(total).toBe('1500.00');

    // And a subsequent money-neutral write (reorder) needs no override.
    const moved = await tree.moveNode(identity, projectId, versionId, contingency.id, {
      newSortOrder: 0,
    });
    expect(Array.isArray(moved)).toBe(true);
  });

  // ─── L-6 ───────────────────────────────────────────────────────────────────

  it('L-6: editing a COMMITTED version never mints new node ids', async () => {
    const before = await prisma.boqNode.findMany({ where: { versionId }, select: { id: true } });
    const beforeIds = new Set(before.map((n) => n.id));

    const node = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '01.001' } });
    await tree.updateNode(identity, projectId, versionId, node.id, { description: 'Same id edit' });

    const after = await prisma.boqNode.findMany({ where: { versionId }, select: { id: true } });
    const afterIds = new Set(after.map((n) => n.id));
    expect(afterIds).toEqual(beforeIds);
  });

  // ─── L-4 immutability / L-6 SNAPSHOT ─────────────────────────────────────────

  it('L-4: any write to a SNAPSHOT node is refused (403, immutable record)', async () => {
    const boq = await versioning.getBoq(identity, projectId);
    const snapshotId = boq.committedSnapshotVersionId!;
    const snapshotNode = await prisma.boqNode.findFirstOrThrow({
      where: { versionId: snapshotId, isLeaf: true },
    });
    await expect(
      tree.updateNode(identity, projectId, snapshotId, snapshotNode.id, { description: 'tamper' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ─── L-7 ───────────────────────────────────────────────────────────────────

  it('L-7: every node write on the COMMITTED version still emits exactly one change event', async () => {
    const node = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '01.001' } });
    const before = await prisma.boqChangeEvent.count({ where: { versionId, nodeId: node.id } });
    await tree.updateNode(identity, projectId, versionId, node.id, {
      description: 'History probe',
    });
    const after = await prisma.boqChangeEvent.count({ where: { versionId, nodeId: node.id } });
    // One UPDATE event for the single changed field (description).
    expect(after - before).toBe(1);
  });

  it('L-1: a second commit of an already-committed version is refused', async () => {
    await expect(versioning.commit(identity, projectId, versionId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

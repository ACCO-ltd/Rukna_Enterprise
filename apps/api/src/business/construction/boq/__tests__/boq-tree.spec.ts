import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import type { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import type { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { BoqPrismaRepository } from '../infrastructure/boq-prisma.repository.js';
import { BoqTreeService, treeTotal, type BoqTreeNodeView } from '../application/boq-tree.service.js';
import { BoqVersioningService } from '../application/boq-versioning.service.js';

/**
 * The BOQ module shipped in Sprint 2 with no backend tests at all — the only construction
 * module in that state, and the one that decides the figure a contract is signed against.
 *
 * These run against the real database because every rule under test is enforced by a
 * constraint, a transaction or a recursive query. A mocked Prisma would prove nothing about
 * whether `(version_id, parent_id, sort_order)` actually holds.
 */
describe('BOQ tree — ADR-016 correctness', () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID().slice(0, 12);
  const orgId = `boq-org-${suffix}`;

  let identity: RequestIdentity;
  let projectId: string;
  let versionId: string;
  let tree: BoqTreeService;
  let versioning: BoqVersioningService;

  /** No workflow binding configured — the gate resolves to null and commands proceed. */
  const ungoverned = {
    gateStateTransition: async () => null,
  } as unknown as CommandGovernanceService;

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: orgId, name: `BOQ Org ${suffix}`, slug: `boq-${suffix}`, status: 'ACTIVE' },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        code: `PRJ-${suffix}`,
        name: 'Baraka Tower',
        currency: 'USD',
        createdBy: 'u1',
      },
    });
    projectId = project.id;

    identity = {
      userId: 'u1',
      activeOrganizationId: orgId,
      tenantSlug: `boq-${suffix}`,
      roles: ['admin'],
      permissions: ['*'],
    };

    const tenancy = { getClient: () => prisma } as unknown as TenancyService;
    const repo = new BoqPrismaRepository();
    tree = new BoqTreeService(tenancy, repo);
    versioning = new BoqVersioningService(tenancy, repo, ungoverned);

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

  // ─── CONST-BOQ-013: one currency ───────────────────────────────────────────

  it('seeds the BOQ currency from the project', async () => {
    const boq = await versioning.getBoq(identity, projectId);
    expect(boq.currency).toBe('USD');
  });

  it('rejects a node priced in another currency', async () => {
    await expect(
      tree.addNode(identity, projectId, versionId, {
        code: 'X.CUR',
        description: 'Euro item',
        isLeaf: true,
        unit: 'm',
        quantity: '1',
        unitRate: '1.00',
        currency: 'EUR',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ─── CONST-BOQ-015: structural validity ────────────────────────────────────

  it('rejects a duplicate code within the version', async () => {
    await tree.addNode(identity, projectId, versionId, {
      code: '01',
      description: 'Preliminaries',
    });

    await expect(
      tree.addNode(identity, projectId, versionId, { code: '01', description: 'Duplicate' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects pricing fields on a section', async () => {
    await expect(
      tree.addNode(identity, projectId, versionId, {
        code: '01.PRICED',
        description: 'Section with a rate',
        isLeaf: false,
        unitRate: '100.00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a child under a billable item', async () => {
    const item = await tree.addNode(identity, projectId, versionId, {
      code: '01.ITEM',
      description: 'An item',
      isLeaf: true,
      unit: 'LS',
      quantity: '1',
      unitRate: '10.00',
    });

    await expect(
      tree.addNode(identity, projectId, versionId, {
        parentId: item.id,
        code: '01.ITEM.SUB',
        description: 'Illegal child',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a quantity beyond three decimal places', async () => {
    await expect(
      tree.addNode(identity, projectId, versionId, {
        code: '01.SCALE',
        description: 'Over-precise',
        isLeaf: true,
        unit: 'm',
        quantity: '1.23456',
        unitRate: '10.00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ─── CONST-BOQ-014: decimal arithmetic ─────────────────────────────────────

  it('computes line and section totals in decimal, not floating point', async () => {
    const section = await tree.addNode(identity, projectId, versionId, {
      code: '02',
      description: 'Substructure',
    });

    // 0.1 + 0.2 in binary floating point is 0.30000000000000004. Three lines of 0.1 × 1
    // summed as doubles drift; summed as decimals they do not.
    for (const n of [1, 2, 3]) {
      await tree.addNode(identity, projectId, versionId, {
        parentId: section.id,
        code: `02.00${n}`,
        description: `Drift probe ${n}`,
        isLeaf: true,
        unit: 'm',
        quantity: '0.100',
        unitRate: '1.00',
      });
    }

    const nodes = await tree.getTree(identity, projectId, versionId);
    const substructure = findByCode(nodes, '02')!;

    expect(substructure.computedTotal).toBe('0.30');
    expect(substructure.children.every((child) => child.totalAmount === '0.10')).toBe(true);
  });

  it('serializes every decimal as a string', async () => {
    const nodes = await tree.getTree(identity, projectId, versionId);
    const item = findByCode(nodes, '02.001')!;

    expect(typeof item.quantity).toBe('string');
    expect(typeof item.unitRate).toBe('string');
    expect(typeof item.totalAmount).toBe('string');
    expect(typeof item.computedTotal).toBe('string');
    expect(item.quantity).toBe('0.100');
    expect(item.unitRate).toBe('1.00');
  });

  it('reports no total for an unpriced section rather than a confident zero', async () => {
    const empty = await tree.addNode(identity, projectId, versionId, {
      code: '03',
      description: 'Superstructure — nothing in it yet',
    });

    const nodes = await tree.getTree(identity, projectId, versionId);
    expect(findByCode(nodes, '03')!.computedTotal).toBeNull();

    await tree.deleteNode(identity, projectId, versionId, empty.id);
  });

  // ─── CONST-BOQ-017: dense, unique sibling order ────────────────────────────

  it('assigns dense sibling positions on insert', async () => {
    const section = await tree.addNode(identity, projectId, versionId, {
      code: '04',
      description: 'Ordering',
    });
    for (const n of [1, 2, 3]) {
      await tree.addNode(identity, projectId, versionId, {
        parentId: section.id,
        code: `04.00${n}`,
        description: `Line ${n}`,
      });
    }

    const children = await prisma.boqNode.findMany({
      where: { versionId, parentId: section.id },
      orderBy: { sortOrder: 'asc' },
    });
    expect(children.map((child) => child.sortOrder)).toEqual([0, 1, 2]);
  });

  it('reindexes both sibling ranges when a node moves between parents', async () => {
    const source = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '04' } });
    const target = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '02' } });
    const moved = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '04.002' } });

    await tree.moveNode(identity, projectId, versionId, moved.id, {
      newParentId: target.id,
      newSortOrder: 0,
    });

    const sourceChildren = await prisma.boqNode.findMany({
      where: { versionId, parentId: source.id },
      orderBy: { sortOrder: 'asc' },
    });
    const targetChildren = await prisma.boqNode.findMany({
      where: { versionId, parentId: target.id },
      orderBy: { sortOrder: 'asc' },
    });

    // The hole left behind is closed, and the destination made room without a collision.
    expect(sourceChildren.map((child) => child.sortOrder)).toEqual([0, 1]);
    expect(targetChildren.map((child) => child.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(targetChildren[0]!.code).toBe('04.002');
  });

  it('rewrites path and depth across the moved subtree', async () => {
    const target = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '01' } });
    const section = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '04' } });

    await tree.moveNode(identity, projectId, versionId, section.id, {
      newParentId: target.id,
      newSortOrder: 0,
    });

    const movedSection = await prisma.boqNode.findUniqueOrThrow({ where: { id: section.id } });
    const descendants = await prisma.boqNode.findMany({
      where: { versionId, path: { startsWith: `${movedSection.path}/` } },
    });

    expect(movedSection.path).toBe(`${target.path}/${section.id}`);
    expect(movedSection.depth).toBe(target.depth + 1);
    expect(descendants.length).toBeGreaterThan(0);
    expect(descendants.every((child) => child.depth === movedSection.depth + 1)).toBe(true);
    // CONST-BOQ-008/010 — stable ids survive the rewrite.
    expect(descendants.every((child) => child.path.endsWith(child.id))).toBe(true);
  });

  it('refuses to move a node under its own descendant', async () => {
    const parent = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '01' } });
    const child = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '04' } });

    await expect(
      tree.moveNode(identity, projectId, versionId, parent.id, {
        newParentId: child.id,
        newSortOrder: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the reindexed tree from a move instead of an empty body', async () => {
    const section = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '04' } });
    const result = await tree.moveNode(identity, projectId, versionId, section.id, {
      newSortOrder: 0,
    });

    expect(Array.isArray(result)).toBe(true);
    expect(findByCode(result, '04')).not.toBeNull();
  });

  // ─── CONST-BOQ-003: deletion protection ────────────────────────────────────

  it('refuses to delete a node referenced by a downstream record', async () => {
    const item = await tree.addNode(identity, projectId, versionId, {
      code: '09.REF',
      description: 'Claimed line',
      isLeaf: true,
      unit: 'm',
      quantity: '1',
      unitRate: '5.00',
    });

    // The cost side attributes to a BOQ node through a plain string column with no FK, so
    // nothing in the database would have stopped the delete.
    const commitment = await prisma.commitmentLedgerEntry.create({
      data: {
        organizationId: orgId,
        projectId,
        boqNodeId: item.id,
        stage: 'COMMITTED',
        amount: '100.00',
        currencyCode: 'USD',
        reportingAmount: '100.00',
        exchangeRateSnapshot: '1.000000',
        sourceDocumentType: 'PURCHASE_ORDER_REVISION',
        sourceDocumentId: `po-${suffix}`,
        eventType: 'PO_APPROVED',
        idempotencyKey: `boq-del-${suffix}`,
        occurredAt: new Date(),
        accountingDate: new Date(),
      },
    });

    await expect(
      tree.deleteNode(identity, projectId, versionId, item.id),
    ).rejects.toBeInstanceOf(ConflictException);

    await prisma.commitmentLedgerEntry.delete({ where: { id: commitment.id } });
    await tree.deleteNode(identity, projectId, versionId, item.id);
  });

  // ─── Immutability and isolation ────────────────────────────────────────────

  it('refuses node writes against a baselined version', async () => {
    const boq = await versioning.baseline(identity, projectId, versionId);
    expect(boq.versions.find((v) => v.id === versionId)!.status).toBe('BASELINED');

    await expect(
      tree.addNode(identity, projectId, versionId, { code: '99', description: 'Too late' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('carries measurement method, pricing basis and lineage into a revision', async () => {
    const before = await prisma.boqNode.findFirstOrThrow({ where: { versionId, code: '02.001' } });
    await prisma.boqNode.update({
      where: { id: before.id },
      data: { measurementMethod: 'MILESTONE', pricingBasis: 'LUMP_SUM' },
    });

    const boq = await versioning.createDraftFromApproved(identity, projectId, 'Revision 2');
    const draftId = boq.currentDraftVersionId!;

    const copy = await prisma.boqNode.findFirstOrThrow({
      where: { versionId: draftId, code: '02.001' },
    });

    // These four were silently reset to their defaults by the old copy, which would have
    // changed how an inherited lump-sum item is measured for payment.
    expect(copy.measurementMethod).toBe('MILESTONE');
    expect(copy.pricingBasis).toBe('LUMP_SUM');
    expect(copy.originNodeId).toBe(before.id);
    expect(boq.versions.find((v) => v.id === draftId)!.derivedFromVersionId).toBe(versionId);
  });

  it('refuses access from another organization', async () => {
    const intruder: RequestIdentity = { ...identity, activeOrganizationId: 'someone-else' };
    await expect(tree.getTree(intruder, projectId, versionId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('totals the version from its root sections', async () => {
    const nodes = await tree.getTree(identity, projectId, versionId);
    expect(treeTotal(nodes)).toMatch(/^\d+\.\d{2}$/);
  });
});

function findByCode(nodes: BoqTreeNodeView[], code: string): BoqTreeNodeView | null {
  for (const node of nodes) {
    if (node.code === code) return node;
    const found = findByCode(node.children, code);
    if (found) return found;
  }
  return null;
}

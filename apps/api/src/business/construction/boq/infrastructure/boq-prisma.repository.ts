import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma, Boq, BoqVersion, BoqNode } from '@prisma/client';

export type BoqWithVersions = Prisma.BoqGetPayload<{
  include: { versions: { orderBy: { versionNumber: 'desc' } } };
}>;

@Injectable()
export class BoqPrismaRepository {
  // ─── BOQ ──────────────────────────────────────────────────────────────────────

  async findByProject(prisma: PrismaClient, projectId: string): Promise<BoqWithVersions | null> {
    return prisma.boq.findUnique({
      where: { projectId },
      include: { versions: { orderBy: { versionNumber: 'desc' } } },
    });
  }

  async findById(prisma: PrismaClient, id: string): Promise<BoqWithVersions | null> {
    return prisma.boq.findUnique({
      where: { id },
      include: { versions: { orderBy: { versionNumber: 'desc' } } },
    });
  }

  async createBoq(prisma: PrismaClient, data: Prisma.BoqUncheckedCreateInput): Promise<Boq> {
    return prisma.boq.create({ data });
  }

  async updateBoq(prisma: PrismaClient, id: string, data: Prisma.BoqUncheckedUpdateInput): Promise<Boq> {
    return prisma.boq.update({ where: { id }, data });
  }

  // ─── Versions ─────────────────────────────────────────────────────────────────

  async findVersion(prisma: PrismaClient, id: string): Promise<BoqVersion | null> {
    return prisma.boqVersion.findUnique({ where: { id } });
  }

  async maxVersionNumber(prisma: PrismaClient, boqId: string): Promise<number> {
    const result = await prisma.boqVersion.aggregate({
      where: { boqId },
      _max: { versionNumber: true },
    });
    return result._max.versionNumber ?? 0;
  }

  async createVersion(
    prisma: PrismaClient,
    data: Prisma.BoqVersionUncheckedCreateInput,
  ): Promise<BoqVersion> {
    return prisma.boqVersion.create({ data });
  }

  async updateVersion(
    prisma: PrismaClient,
    id: string,
    data: Prisma.BoqVersionUncheckedUpdateInput,
  ): Promise<BoqVersion> {
    return prisma.boqVersion.update({ where: { id }, data });
  }

  // ─── Nodes ────────────────────────────────────────────────────────────────────

  async findNodesByVersion(prisma: PrismaClient, versionId: string): Promise<BoqNode[]> {
    return prisma.boqNode.findMany({
      where: { versionId },
      orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async findNodeById(prisma: PrismaClient, id: string): Promise<BoqNode | null> {
    return prisma.boqNode.findUnique({ where: { id } });
  }

  async countChildren(prisma: PrismaClient, parentId: string, versionId: string): Promise<number> {
    return prisma.boqNode.count({ where: { parentId, versionId } });
  }

  async createNode(
    prisma: PrismaClient,
    data: Prisma.BoqNodeUncheckedCreateInput,
  ): Promise<BoqNode> {
    return prisma.boqNode.create({ data });
  }

  async updateNode(
    prisma: PrismaClient,
    id: string,
    data: Prisma.BoqNodeUncheckedUpdateInput,
  ): Promise<BoqNode> {
    return prisma.boqNode.update({ where: { id }, data });
  }

  async deleteNode(prisma: PrismaClient, id: string): Promise<void> {
    await prisma.boqNode.delete({ where: { id } });
  }

  /**
   * Creates a node at a specific position among its siblings, opening a gap first.
   *
   * Both statements run in one transaction because `(version_id, parent_id, sort_order)` is
   * unique — a create between the shift and the insert would land on an occupied slot.
   * The path is written in the same transaction now that the id is known, replacing the
   * `__placeholder__` write-then-patch the service used to do outside any transaction.
   */
  async createNodeAtPosition(
    prisma: PrismaClient,
    data: Prisma.BoqNodeUncheckedCreateInput,
    parentPath: string | null,
    targetOrder: number,
  ): Promise<BoqNode> {
    return prisma.$transaction(async (tx) => {
      await this.shiftSiblingsUp(tx, data.versionId, data.parentId ?? null, targetOrder);
      const created = await tx.boqNode.create({
        data: { ...data, sortOrder: targetOrder, path: '__pending__' },
      });
      return tx.boqNode.update({
        where: { id: created.id },
        data: { path: parentPath ? `${parentPath}/${created.id}` : created.id },
      });
    });
  }

  /** Deletes a node and compacts the sibling range it leaves behind — CONST-BOQ-017. */
  async deleteNodeAndReindex(
    prisma: PrismaClient,
    node: Pick<BoqNode, 'id' | 'versionId' | 'parentId'>,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.boqNode.delete({ where: { id: node.id } });
      await this.reindexSiblings(tx, node.versionId, node.parentId);
    });
  }

  async createManyNodes(
    prisma: PrismaClient,
    data: Prisma.BoqNodeUncheckedCreateInput[],
  ): Promise<void> {
    await prisma.boqNode.createMany({ data: data as Prisma.BoqNodeCreateManyInput[] });
  }

  /** How many nodes in this version already carry the given VO's provenance — CONST-VAR-007
   * idempotency guard. A VO whose nodes already exist on the (draft or approved) revision has
   * been applied and must not be applied again. */
  async countNodesForVariation(
    prisma: PrismaClient,
    versionId: string,
    variationOrderId: string,
  ): Promise<number> {
    return prisma.boqNode.count({
      where: { versionId, sourceChangeOrderId: variationOrderId },
    });
  }

  /** Every code already used in the version, optionally excluding one node (its own). */
  async findCodesInVersion(
    prisma: PrismaClient,
    versionId: string,
    excludeNodeId?: string,
  ): Promise<Set<string>> {
    const rows = await prisma.boqNode.findMany({
      where: { versionId, ...(excludeNodeId ? { id: { not: excludeNodeId } } : {}) },
      select: { code: true },
    });
    return new Set(rows.map((row) => row.code));
  }

  /** Number of nodes directly under `parentId` (null = root level). */
  async countSiblings(
    prisma: PrismaClient,
    versionId: string,
    parentId: string | null,
  ): Promise<number> {
    return prisma.boqNode.count({ where: { versionId, parentId } });
  }

  /**
   * Counts downstream records that reference this node — CONST-BOQ-003.
   *
   * Only `InterimPaymentApplicationItem.boqNodeId` is a hard FK. The cost-side four are
   * plain string columns, so the database will not stop a delete and the row would be
   * orphaned silently. This is the check that does stop it.
   *
   * `PurchaseOrderLine` is absent deliberately — it carries no `boqNodeId`. PO attribution
   * to a BOQ node reaches the ledger through `CommitmentLedgerEntry`, which is counted here.
   */
  async countNodeReferences(
    prisma: PrismaClient,
    nodeId: string,
  ): Promise<{ source: string; count: number }[]> {
    const [ipaItems, materialRequestLines, supplierBillLines, journalLines, commitments] =
      await Promise.all([
        prisma.interimPaymentApplicationItem.count({ where: { boqNodeId: nodeId } }),
        prisma.materialRequestLine.count({ where: { boqNodeId: nodeId } }),
        prisma.supplierBillLine.count({ where: { boqNodeId: nodeId } }),
        prisma.journalLine.count({ where: { boqNodeId: nodeId } }),
        prisma.commitmentLedgerEntry.count({ where: { boqNodeId: nodeId } }),
      ]);

    return [
      { source: 'paymentApplicationItems', count: ipaItems },
      { source: 'materialRequestLines', count: materialRequestLines },
      { source: 'supplierBillLines', count: supplierBillLines },
      { source: 'journalLines', count: journalLines },
      { source: 'commitmentLedgerEntries', count: commitments },
    ].filter((entry) => entry.count > 0);
  }

  async deactivateNode(prisma: PrismaClient, id: string): Promise<BoqNode> {
    return prisma.boqNode.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * Rewrites a sibling range to a dense `0..n-1` sequence — CONST-BOQ-017.
   *
   * Two passes, because `(version_id, parent_id, sort_order)` is a non-deferrable unique
   * index: PostgreSQL checks it row by row within a single UPDATE, so renumbering in place
   * trips over rows that have not moved yet. The first pass parks every sibling on a
   * negative mirror of its target (negatives are distinct among themselves and cannot
   * collide with the non-negative rows still to be moved); the second flips the sign.
   */
  async reindexSiblings(
    prisma: Prisma.TransactionClient,
    versionId: string,
    parentId: string | null,
  ): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
      WITH ranked AS (
        SELECT "id",
               ROW_NUMBER() OVER (ORDER BY "sort_order", "created_at", "id") - 1 AS new_order
        FROM "boq_nodes"
        WHERE "version_id" = ${versionId}
          AND "parent_id" IS NOT DISTINCT FROM ${parentId}
      )
      UPDATE "boq_nodes" n
      SET "sort_order" = -1 - ranked.new_order
      FROM ranked
      WHERE n."id" = ranked."id"
    `);

    await prisma.$executeRaw(Prisma.sql`
      UPDATE "boq_nodes"
      SET "sort_order" = -1 - "sort_order"
      WHERE "version_id" = ${versionId}
        AND "parent_id" IS NOT DISTINCT FROM ${parentId}
        AND "sort_order" < 0
    `);
  }

  /** Opens a gap at `fromOrder` by pushing later siblings up one place. Same two-pass reason. */
  private async shiftSiblingsUp(
    prisma: Prisma.TransactionClient,
    versionId: string,
    parentId: string | null,
    fromOrder: number,
  ): Promise<void> {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "boq_nodes"
      SET "sort_order" = -2 - "sort_order"
      WHERE "version_id" = ${versionId}
        AND "parent_id" IS NOT DISTINCT FROM ${parentId}
        AND "sort_order" >= ${fromOrder}
    `);

    await prisma.$executeRaw(Prisma.sql`
      UPDATE "boq_nodes"
      SET "sort_order" = -1 - "sort_order"
      WHERE "version_id" = ${versionId}
        AND "parent_id" IS NOT DISTINCT FROM ${parentId}
        AND "sort_order" < 0
    `);
  }

  /**
   * Moves a node and its whole subtree to a new parent and position — CONST-BOQ-009/017.
   *
   * The previous implementation issued two independent statements and never touched the
   * siblings, so `sort_order` ties were storable and read order was undefined (B13). This
   * runs as one interactive transaction:
   *
   *   1. park the node on a negative slot so it stops occupying its old position
   *   2. compact the source siblings back to a dense sequence
   *   3. open a gap at the destination position
   *   4. land the node in that gap
   *   5. rewrite path and depth for the node and every descendant, via a recursive CTE
   *
   * `path` is rewritten by prefix substitution over the subtree the CTE walks, so the
   * stable node ids inside it are preserved — CONST-BOQ-008 and CONST-BOQ-010 both require
   * that reordering never invalidates a path.
   */
  async moveNode(
    prisma: PrismaClient,
    versionId: string,
    node: BoqNode,
    newParentId: string | null,
    newParentPath: string | null,
    newParentDepth: number,
    newSortOrder: number,
  ): Promise<void> {
    const newDepth = newParentDepth + 1;
    const newNodePath = newParentPath ? `${newParentPath}/${node.id}` : node.id;
    const depthDelta = newDepth - node.depth;
    const oldPath = node.path;
    const oldParentId = node.parentId;
    // Cast to an int literal so PostgreSQL picks substring(text, int), not the bigint overload.
    const suffixOffset = Prisma.raw(String(oldPath.length + 1));

    await prisma.$transaction(async (tx) => {
      // 1 — park the node clear of both sibling ranges.
      await tx.$executeRaw(Prisma.sql`
        UPDATE "boq_nodes"
        SET "parent_id" = ${newParentId}, "sort_order" = -1, "updated_at" = now()
        WHERE "id" = ${node.id} AND "version_id" = ${versionId}
      `);

      // 2 — the node has left its old range; close the hole it left behind.
      if (oldParentId !== newParentId) {
        await this.reindexSiblings(tx, versionId, oldParentId);
      }

      // 3 + 4 — make room at the destination and land the node in it.
      const siblingCount = await tx.boqNode.count({
        where: { versionId, parentId: newParentId, id: { not: node.id } },
      });
      const targetOrder = Math.max(0, Math.min(newSortOrder, siblingCount));
      await this.shiftSiblingsUp(tx, versionId, newParentId, targetOrder);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "boq_nodes"
        SET "sort_order" = ${targetOrder}, "depth" = ${newDepth}, "updated_at" = now()
        WHERE "id" = ${node.id} AND "version_id" = ${versionId}
      `);

      // 5 — rewrite the subtree's paths and depths in one pass.
      await tx.$executeRaw(Prisma.sql`
        WITH RECURSIVE subtree AS (
          SELECT "id", "path"
          FROM "boq_nodes"
          WHERE "id" = ${node.id} AND "version_id" = ${versionId}
          UNION ALL
          SELECT child."id", child."path"
          FROM "boq_nodes" child
          JOIN subtree ON child."parent_id" = subtree."id"
          WHERE child."version_id" = ${versionId}
        )
        UPDATE "boq_nodes" n
        SET "path"       = ${newNodePath} || substring(subtree."path", ${suffixOffset}),
            "depth"      = n."depth" + ${depthDelta},
            "updated_at" = now()
        FROM subtree
        WHERE n."id" = subtree."id"
          AND n."id" <> ${node.id}
      `);

      await tx.$executeRaw(Prisma.sql`
        UPDATE "boq_nodes"
        SET "path" = ${newNodePath}, "updated_at" = now()
        WHERE "id" = ${node.id} AND "version_id" = ${versionId}
      `);

      // The destination range is dense by construction; the source range was compacted in
      // step 2 only when the parent changed. A same-parent move needs it here.
      if (oldParentId === newParentId) {
        await this.reindexSiblings(tx, versionId, newParentId);
      }
    });
  }
}

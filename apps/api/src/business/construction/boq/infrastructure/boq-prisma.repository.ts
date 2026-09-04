import { Injectable } from '@nestjs/common';
import { PrismaClient, Prisma, Boq, BoqVersion, BoqNode, BoqChangeEvent, BoqChangeAction } from '@prisma/client';

export type BoqWithVersions = Prisma.BoqGetPayload<{
  include: { versions: { orderBy: { versionNumber: 'desc' } } };
}>;

/**
 * One change to record alongside a node mutation. Written in the SAME transaction as the mutation
 * (BOQ refinement Phase 1). On a CREATE the caller may omit `nodeId` — the repo fills it with the
 * id it just generated. FK-free, so a DELETE event survives the node it names.
 */
export interface BoqChangeEventInput {
  organizationId: string;
  boqId: string;
  versionId: string;
  nodeId?: string | null;
  code?: string | null;
  action: BoqChangeAction;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  detail?: string | null;
  actorUserId: string;
}

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
    events?: BoqChangeEventInput[],
  ): Promise<BoqNode> {
    if (!events || events.length === 0) return prisma.boqNode.update({ where: { id }, data });
    // Update and its field-level history commit together.
    return prisma.$transaction(async (tx) => {
      const updated = await tx.boqNode.update({ where: { id }, data });
      await tx.boqChangeEvent.createMany({ data: events });
      return updated;
    });
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
    event?: BoqChangeEventInput,
  ): Promise<BoqNode> {
    return prisma.$transaction(async (tx) => {
      await this.shiftSiblingsUp(tx, data.versionId, data.parentId ?? null, targetOrder);
      const created = await tx.boqNode.create({
        data: { ...data, sortOrder: targetOrder, path: '__pending__' },
      });
      const node = await tx.boqNode.update({
        where: { id: created.id },
        data: { path: parentPath ? `${parentPath}/${created.id}` : created.id },
      });
      // The audit event rides the same transaction, and only now knows the node's id.
      if (event) await tx.boqChangeEvent.create({ data: { ...event, nodeId: created.id } });
      return node;
    });
  }

  /** Deletes a node and compacts the sibling range it leaves behind — CONST-BOQ-017. */
  async deleteNodeAndReindex(
    prisma: PrismaClient,
    node: Pick<BoqNode, 'id' | 'versionId' | 'parentId'>,
    event?: BoqChangeEventInput,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // Record before the delete — the event is FK-free, so it stands after the node is gone.
      if (event) await tx.boqChangeEvent.create({ data: event });
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

  /**
   * Empties a version of its nodes, deepest level first.
   *
   * The self-relation FK is `onDelete: Restrict`, checked immediately per row — a single
   * `deleteMany` over the whole version would try to remove a parent while its children still
   * reference it and be rejected. Deleting by descending depth means every child is gone
   * before its parent. Used only for an import Replace against a DRAFT (CONST-BOQ-003 — a
   * referenced node is guarded upstream, so nothing removed here is referenced downstream).
   */
  async clearVersionNodes(prisma: PrismaClient, versionId: string): Promise<void> {
    const nodes = await prisma.boqNode.findMany({
      where: { versionId },
      select: { id: true, depth: true },
    });
    if (nodes.length === 0) return;
    const maxDepth = nodes.reduce((deepest, node) => Math.max(deepest, node.depth), 0);
    for (let depth = maxDepth; depth >= 0; depth -= 1) {
      const ids = nodes.filter((node) => node.depth === depth).map((node) => node.id);
      if (ids.length > 0) await prisma.boqNode.deleteMany({ where: { id: { in: ids } } });
    }
  }

  /**
   * How many downstream records point at any of these nodes — the set-wide form of
   * `countNodeReferences`, used to refuse an import Replace that would strand a reference.
   * A DRAFT's nodes are not expected to carry any, so this is the assertion that they don't.
   */
  async countReferencesForNodes(prisma: PrismaClient, nodeIds: string[]): Promise<number> {
    if (nodeIds.length === 0) return 0;
    const where = { boqNodeId: { in: nodeIds } };
    const counts = await Promise.all([
      prisma.interimPaymentApplicationItem.count({ where }),
      prisma.materialRequestLine.count({ where }),
      prisma.supplierBillLine.count({ where }),
      prisma.journalLine.count({ where }),
      prisma.commitmentLedgerEntry.count({ where }),
      prisma.purchaseOrderLine.count({ where }),
    ]);
    return counts.reduce((total, count) => total + count, 0);
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

  /** Codes of the nodes directly under `parentId` (null = root) — feeds the next-code proposal. */
  async findChildCodes(
    prisma: PrismaClient,
    versionId: string,
    parentId: string | null,
  ): Promise<string[]> {
    const rows = await prisma.boqNode.findMany({
      where: { versionId, parentId },
      select: { code: true },
    });
    return rows.map((row) => row.code);
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
   * `InterimPaymentApplicationItem.boqNodeId` is a hard FK. The cost-side columns
   * (`MaterialRequestLine`, `SupplierBillLine`, `JournalLine`, `CommitmentLedgerEntry`,
   * `PurchaseOrderLine`) are nullable FKs with `ON DELETE SET NULL`, so the database will not
   * stop a delete — it would silently null the attribution and orphan the reference. This is
   * the check that does stop it.
   *
   * `PurchaseOrderLine` is now counted (D7 / #148): a PO line carries the node directly through
   * its cost-target `boqNodeId`, and PO approval books COMMITTED against that node. A node a
   * cost-targeted PO line points at must be protected from deletion, or the SET-NULL would
   * silently strip the cost attribution off the line.
   */
  async countNodeReferences(
    prisma: PrismaClient,
    nodeId: string,
  ): Promise<{ source: string; count: number }[]> {
    const [
      ipaItems,
      materialRequestLines,
      supplierBillLines,
      journalLines,
      commitments,
      purchaseOrderLines,
    ] = await Promise.all([
      prisma.interimPaymentApplicationItem.count({ where: { boqNodeId: nodeId } }),
      prisma.materialRequestLine.count({ where: { boqNodeId: nodeId } }),
      prisma.supplierBillLine.count({ where: { boqNodeId: nodeId } }),
      prisma.journalLine.count({ where: { boqNodeId: nodeId } }),
      prisma.commitmentLedgerEntry.count({ where: { boqNodeId: nodeId } }),
      prisma.purchaseOrderLine.count({ where: { boqNodeId: nodeId } }),
    ]);

    return [
      { source: 'paymentApplicationItems', count: ipaItems },
      { source: 'materialRequestLines', count: materialRequestLines },
      { source: 'supplierBillLines', count: supplierBillLines },
      { source: 'journalLines', count: journalLines },
      { source: 'commitmentLedgerEntries', count: commitments },
      { source: 'purchaseOrderLines', count: purchaseOrderLines },
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
    event?: BoqChangeEventInput,
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

      if (event) await tx.boqChangeEvent.create({ data: event });
    });
  }

  // ─── Change history (BOQ refinement Phase 1) ────────────────────────────────────

  /** Records events outside a node mutation — used for the one summary event on an import. */
  async recordChangeEvents(prisma: PrismaClient, events: BoqChangeEventInput[]): Promise<void> {
    if (events.length === 0) return;
    await prisma.boqChangeEvent.createMany({ data: events });
  }

  /** A version's change log, newest first, optionally narrowed to one node. */
  async findHistory(
    prisma: PrismaClient,
    versionId: string,
    options: { nodeId?: string; take: number; skip: number },
  ): Promise<BoqChangeEvent[]> {
    return prisma.boqChangeEvent.findMany({
      where: { versionId, ...(options.nodeId ? { nodeId: options.nodeId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: options.take,
      skip: options.skip,
    });
  }

  /** Maps actor ids to "First Last" for the history feed, in one query. */
  async findActorNames(prisma: PrismaClient, userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]));
  }
}

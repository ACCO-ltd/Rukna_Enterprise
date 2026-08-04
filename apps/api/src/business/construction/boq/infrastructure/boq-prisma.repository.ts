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

  async createManyNodes(
    prisma: PrismaClient,
    data: Prisma.BoqNodeUncheckedCreateInput[],
  ): Promise<void> {
    await prisma.boqNode.createMany({ data: data as Prisma.BoqNodeCreateManyInput[] });
  }

  /**
   * Moves a node and all its descendants to a new parent position.
   *
   * Step 1: Update the moved node — set new parentId, path, depth, sortOrder.
   * Step 2: Update all descendants — replace old path prefix with new path.
   *
   * The path format is "rootId/childId/grandchildId" (no leading slash).
   * Only the moved node gets a new parentId; descendants inherit new paths automatically.
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
    // Cast to int literal so PostgreSQL picks substring(text, int) not substring(text, bigint).
    const substringOffset = Prisma.raw(String(oldPath.length + 2));

    await prisma.$transaction([
      // Step 1 — update the moved node itself
      prisma.$executeRaw(Prisma.sql`
        UPDATE "boq_nodes"
        SET "parent_id"   = ${newParentId},
            "path"        = ${newNodePath},
            "depth"       = ${newDepth},
            "sort_order"  = ${newSortOrder},
            "updated_at"  = now()
        WHERE "id" = ${node.id}
          AND "version_id" = ${versionId}
      `),
      // Step 2 — update all descendants: replace old path prefix with new path
      prisma.$executeRaw(Prisma.sql`
        UPDATE "boq_nodes"
        SET "path"       = ${newNodePath} || '/' || substring("path", ${substringOffset}),
            "depth"      = "depth" + ${depthDelta},
            "updated_at" = now()
        WHERE "version_id" = ${versionId}
          AND "path" LIKE ${oldPath + '/%'}
      `),
    ]);
  }
}

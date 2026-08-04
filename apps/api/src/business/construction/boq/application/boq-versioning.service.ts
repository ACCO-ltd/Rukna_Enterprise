import { randomUUID } from 'crypto';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { BoqNode, Prisma } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { BoqPrismaRepository, BoqWithVersions } from '../infrastructure/boq-prisma.repository.js';

@Injectable()
export class BoqVersioningService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: BoqPrismaRepository,
  ) {}

  async getBoq(identity: RequestIdentity, projectId: string): Promise<BoqWithVersions> {
    const prisma = this.tenancyService.getClient();
    return this.requireBoq(prisma, projectId, identity.activeOrganizationId);
  }

  /**
   * Creates the BOQ for a project (one-time, idempotent on duplicate call).
   * Returns existing BOQ if already initialized.
   */
  async initialize(identity: RequestIdentity, projectId: string): Promise<BoqWithVersions> {
    const prisma = this.tenancyService.getClient();

    const existing = await this.repo.findByProject(prisma, projectId);
    if (existing) {
      if (existing.organizationId !== identity.activeOrganizationId) throw new ForbiddenException();
      return existing;
    }

    const boq = await this.repo.createBoq(prisma, {
      projectId,
      organizationId: identity.activeOrganizationId,
    });

    const firstVersion = await this.repo.createVersion(prisma, {
      boqId: boq.id,
      versionNumber: 1,
      status: 'DRAFT',
      createdBy: identity.userId,
    });

    await this.repo.updateBoq(prisma, boq.id, { currentDraftVersionId: firstVersion.id });

    return (await this.repo.findById(prisma, boq.id))!;
  }

  /**
   * Creates a new DRAFT version copied from the current approved version.
   * All nodes are duplicated with new IDs; originNodeId tracks lineage.
   */
  async createDraftFromApproved(
    identity: RequestIdentity,
    projectId: string,
    notes?: string,
  ): Promise<BoqWithVersions> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoq(prisma, projectId, identity.activeOrganizationId);

    if (!boq.currentApprovedVersionId) {
      throw new BadRequestException('No approved version exists to create a draft from.');
    }
    if (boq.currentDraftVersionId) {
      throw new ConflictException(
        'A draft version already exists. Baseline or cancel it before creating a new draft.',
      );
    }

    // Get all approved nodes, sorted depth-first (parents before children).
    const approvedNodes = await this.repo.findNodesByVersion(prisma, boq.currentApprovedVersionId);

    const nextVersionNumber = (await this.repo.maxVersionNumber(prisma, boq.id)) + 1;

    const newVersion = await this.repo.createVersion(prisma, {
      boqId: boq.id,
      versionNumber: nextVersionNumber,
      status: 'DRAFT',
      notes,
      createdBy: identity.userId,
    });

    if (approvedNodes.length > 0) {
      await this.copyNodes(prisma, boq.id, newVersion.id, approvedNodes);
    }

    await this.repo.updateBoq(prisma, boq.id, { currentDraftVersionId: newVersion.id });

    return (await this.repo.findById(prisma, boq.id))!;
  }

  /**
   * Baselines the current draft version:
   *  - DRAFT → BASELINED
   *  - Previous approved version → SUPERSEDED
   *  - Sets originalBaselineVersionId (immutable once set)
   *  - Clears currentDraftVersionId
   */
  async baseline(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
  ): Promise<BoqWithVersions> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoq(prisma, projectId, identity.activeOrganizationId);

    if (boq.currentDraftVersionId !== versionId) {
      throw new BadRequestException('Only the current draft version can be baselined.');
    }

    const version = await this.repo.findVersion(prisma, versionId);
    if (!version || version.status !== 'DRAFT') {
      throw new BadRequestException('Version is not in DRAFT status.');
    }

    // Supersede the previously approved version.
    if (boq.currentApprovedVersionId) {
      await this.repo.updateVersion(prisma, boq.currentApprovedVersionId, {
        status: 'SUPERSEDED',
      });
    }

    await this.repo.updateVersion(prisma, versionId, {
      status: 'BASELINED',
      baselinedAt: new Date(),
      baselinedBy: identity.userId,
    });

    await this.repo.updateBoq(prisma, boq.id, {
      currentDraftVersionId: null,
      currentApprovedVersionId: versionId,
      // originalBaselineVersionId is immutable once set (preserves original contract baseline).
      ...(boq.originalBaselineVersionId ? {} : { originalBaselineVersionId: versionId }),
    });

    return (await this.repo.findById(prisma, boq.id))!;
  }

  /**
   * Cancels the current draft version without affecting the approved version.
   */
  async cancelDraft(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
  ): Promise<BoqWithVersions> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoq(prisma, projectId, identity.activeOrganizationId);

    if (boq.currentDraftVersionId !== versionId) {
      throw new BadRequestException('Only the current draft version can be cancelled.');
    }

    const version = await this.repo.findVersion(prisma, versionId);
    if (!version || version.status !== 'DRAFT') {
      throw new BadRequestException('Version is not in DRAFT status.');
    }

    await this.repo.updateVersion(prisma, versionId, { status: 'CANCELLED' });
    await this.repo.updateBoq(prisma, boq.id, { currentDraftVersionId: null });

    return (await this.repo.findById(prisma, boq.id))!;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private async requireBoq(
    prisma: ReturnType<TenancyService['getClient']>,
    projectId: string,
    organizationId: string,
  ) {
    const boq = await this.repo.findByProject(prisma, projectId);
    if (!boq) throw new NotFoundException(`No BOQ found for project ${projectId}`);
    if (boq.organizationId !== organizationId) throw new ForbiddenException();
    return boq;
  }

  /**
   * Copies nodes from a source version into a new version.
   * Generates new IDs for every node; builds new materialized paths from the ID map.
   */
  private async copyNodes(
    prisma: ReturnType<TenancyService['getClient']>,
    boqId: string,
    newVersionId: string,
    sourceNodes: BoqNode[],
  ): Promise<void> {
    // Pass 1: assign new IDs to every source node.
    const idMap = new Map<string, string>();
    for (const node of sourceNodes) {
      idMap.set(node.id, randomUUID());
    }

    // Pass 2: rebuild parentId and materialized path using the new IDs.
    const copies: Prisma.BoqNodeCreateManyInput[] = sourceNodes.map((node) => {
      const newId = idMap.get(node.id)!;
      const newParentId = node.parentId ? (idMap.get(node.parentId) ?? null) : null;

      // Path segments are node IDs — replace each with the corresponding new ID.
      const newPath = node.path
        .split('/')
        .map((segment) => idMap.get(segment) ?? segment)
        .join('/');

      return {
        id: newId,
        boqId,
        versionId: newVersionId,
        parentId: newParentId,
        path: newPath,
        depth: node.depth,
        sortOrder: node.sortOrder,
        code: node.code,
        description: node.description,
        descriptionAr: node.descriptionAr ?? undefined,
        unit: node.unit ?? undefined,
        quantity: node.quantity ?? undefined,
        unitRate: node.unitRate ?? undefined,
        currency: node.currency ?? undefined,
        totalAmount: node.totalAmount ?? undefined,
        isLeaf: node.isLeaf,
        originNodeId: node.id,
      };
    });

    await this.repo.createManyNodes(prisma, copies as never);
  }
}

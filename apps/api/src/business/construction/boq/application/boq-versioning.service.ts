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
import {
  CommandGovernanceService,
  throwIfGated,
} from '../../../../platform/workflows/application/command-governance.service.js';
import { BoqPrismaRepository, BoqWithVersions } from '../infrastructure/boq-prisma.repository.js';
import {
  evaluateReadiness,
  type BoqBaselineReadiness,
} from '../domain/boq-readiness.policy.js';

/**
 * CONST-BOQ-001 enforcement switch — see `ReadinessContext.enforceVariationOrigin`.
 *
 * Off until the Variations module exists. Turning it on before there is a way to raise a
 * Change Order would block every post-award revision with no route to satisfying the rule.
 */
const ENFORCE_VARIATION_ORIGIN = false;

@Injectable()
export class BoqVersioningService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: BoqPrismaRepository,
    private readonly commandGovernance: CommandGovernanceService,
  ) {}

  async getBoq(identity: RequestIdentity, projectId: string): Promise<BoqWithVersions> {
    const prisma = this.tenancyService.getClient();
    return this.requireBoq(prisma, projectId, identity.activeOrganizationId);
  }

  /** CONST-BOQ-016. The same evaluation `baseline` enforces. */
  async getReadiness(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
  ): Promise<BoqBaselineReadiness> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoq(prisma, projectId, identity.activeOrganizationId);
    if (!boq.versions.some((version) => version.id === versionId)) {
      throw new NotFoundException(`Version ${versionId} does not belong to this BOQ`);
    }

    const nodes = await this.repo.findNodesByVersion(prisma, versionId);
    return evaluateReadiness(nodes, {
      boqCurrency: boq.currency,
      isPostAward: boq.originalBaselineVersionId !== null,
      enforceVariationOrigin: ENFORCE_VARIATION_ORIGIN,
    });
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

    // CONST-BOQ-013 — the BOQ's unit of account is fixed at initialization from the
    // project. It is not per node and not chosen per line.
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { currency: true },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const boq = await this.repo.createBoq(prisma, {
      projectId,
      organizationId: identity.activeOrganizationId,
      currency: project.currency || 'USD',
    });

    const firstVersion = await this.repo.createVersion(prisma, {
      boqId: boq.id,
      versionNumber: 1,
      status: 'DRAFT',
      createdBy: identity.userId,
      preparedBy: identity.userId,
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
      preparedBy: identity.userId,
      // ADR-004 specified this and it never shipped, so a revision could not say which
      // baseline it was copied from — the one fact a reviewer needs first.
      derivedFromVersionId: boq.currentApprovedVersionId,
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

    // CONST-BOQ-016 — the same evaluation the readiness endpoint returns. The screen shows
    // the blockers; this refuses the command. Neither can drift from the other.
    const readiness = evaluateReadiness(
      await this.repo.findNodesByVersion(prisma, versionId),
      {
        boqCurrency: boq.currency,
        isPostAward: boq.originalBaselineVersionId !== null,
        enforceVariationOrigin: ENFORCE_VARIATION_ORIGIN,
      },
    );
    if (!readiness.ready) {
      throw new BadRequestException({
        message: 'This BOQ version is not ready to be baselined.',
        details: { blockers: readiness.blockers },
      });
    }

    // CONST-BOQ-018 / ADR-011 — baselining is the transition a contract is signed against,
    // so it goes through the same gate as PO submission and AP approval. With no binding
    // configured this resolves to null and baselining proceeds exactly as before; adding a
    // binding turns on four-eyes approval without touching this code.
    throwIfGated(
      await this.commandGovernance.gateStateTransition(
        identity,
        'BoqVersion',
        'DRAFT',
        'BASELINED',
        versionId,
      ),
      'Baselining this BOQ version requires workflow approval.',
    );

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
        unit: node.unit ?? undefined,
        quantity: node.quantity ?? undefined,
        unitRate: node.unitRate ?? undefined,
        currency: node.currency ?? undefined,
        totalAmount: node.totalAmount ?? undefined,
        isLeaf: node.isLeaf,
        // A revision is a copy of the approved scope, so it must carry the contractual
        // properties of every line. These four were dropped, silently resetting each item
        // to QUANTITY / UNIT_RATE / BASELINE — which would have changed how an inherited
        // lump-sum item is measured for payment the moment the revision was baselined.
        measurementMethod: node.measurementMethod,
        pricingBasis: node.pricingBasis,
        sourceType: node.sourceType,
        sourceChangeOrderId: node.sourceChangeOrderId ?? undefined,
        isActive: node.isActive,
        originNodeId: node.id,
      };
    });

    await this.repo.createManyNodes(prisma, copies as never);
  }
}

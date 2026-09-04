import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BoqNode, BoqVersion, Prisma } from '@prisma/client';
import type {
  BoqImportPreview,
  BoqImportRequest,
  BoqImportResult,
  RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { BoqPrismaRepository, BoqWithVersions } from '../infrastructure/boq-prisma.repository.js';
import {
  BoqItemLibraryRepository,
  type ImportLibraryItem,
} from '../infrastructure/boq-item-library.repository.js';
import { planBoqImport, type BoqImportPlan, type PlannedImportNode } from '../domain/boq-import.policy.js';

/**
 * Bulk import (ADR-016 Phase 2). The browser parses the sheet, maps columns, and posts the
 * mapped rows; this service validates them through the pure planner and, only if nothing
 * blocks, materialises the whole tree in one transaction against a DRAFT.
 *
 * It owns BOQ + draft creation inline rather than borrowing `BoqVersioningService`, so the
 * import path carries no baseline-governance dependency — adding draft nodes is not a governed
 * transition (only baselining is).
 */
@Injectable()
export class BoqImportService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: BoqPrismaRepository,
    private readonly libraryRepo: BoqItemLibraryRepository,
  ) {}

  async import(
    identity: RequestIdentity,
    projectId: string,
    dto: BoqImportRequest,
  ): Promise<BoqImportResult> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    // 1+2 — resolve context and plan the whole sheet (pure). Validate before any write (Q6).
    const { plan, boq: resolvedBoq, currency } = await this.resolveAndPlan(prisma, orgId, projectId, dto);
    if (!plan.ok) {
      throw new BadRequestException({
        message: 'The import has blocking errors and was not applied.',
        // The global exception filter forwards `message` and `details` only, so the per-row
        // violations must travel inside `details`.
        details: { violations: plan.violations },
      });
    }
    let boq = resolvedBoq;

    // 3 — ensure a BOQ and an editable DRAFT to import into.
    if (!boq) boq = await this.createBoq(prisma, projectId, orgId, currency);

    let targetVersionId: string;
    let versionNumber: number;
    if (boq.currentDraftVersionId) {
      const version = await this.repo.findVersion(prisma, boq.currentDraftVersionId);
      if (!version || version.status !== 'DRAFT') {
        throw new ConflictException('The BOQ has no editable draft to import into.');
      }
      targetVersionId = version.id;
      versionNumber = version.versionNumber;
    } else {
      const created = await this.createEmptyDraft(prisma, boq, identity.userId);
      targetVersionId = created.id;
      versionNumber = created.versionNumber;
    }

    // 4 — existing nodes drive APPEND parent resolution and REPLACE clearing.
    const existingNodes = await this.repo.findNodesByVersion(prisma, targetVersionId);
    if (dto.mode === 'REPLACE' && existingNodes.length > 0) {
      const referenced = await this.repo.countReferencesForNodes(
        prisma,
        existingNodes.map((node) => node.id),
      );
      if (referenced > 0) {
        throw new ConflictException(
          'This draft has nodes referenced by cost or payment records; Replace is blocked. Use Append, or remove those lines first.',
        );
      }
    }

    // 5 — pre-generate ids and materialise paths (the copyNodes pattern).
    const creates = this.buildCreateInputs(
      plan.nodes,
      boq.id,
      targetVersionId,
      existingNodes,
      dto.mode,
    );

    // 6 — commit atomically: clear (Replace) → bulk-create → optional library.
    let addedToLibraryCount = 0;
    await prisma.$transaction(async (tx) => {
      if (dto.mode === 'REPLACE' && existingNodes.length > 0) {
        await this.repo.clearVersionNodes(tx as never, targetVersionId);
      }
      await this.repo.createManyNodes(tx as never, creates as never);
      if (dto.addToLibrary) {
        addedToLibraryCount = await this.addLeavesToLibrary(tx, orgId, projectId, identity.userId, plan.nodes);
      }
    });

    return {
      versionId: targetVersionId,
      versionNumber,
      mode: dto.mode,
      createdSectionCount: plan.nodes.filter((node) => !node.isLeaf).length,
      createdItemCount: plan.nodes.filter((node) => node.isLeaf).length,
      autoCreatedSectionCount: plan.nodes.filter((node) => node.autoCreated).length,
      addedToLibraryCount,
      warnings: plan.warnings,
    };
  }

  /**
   * A dry-run of the same planner the commit uses — the authoritative preview. Returns exactly
   * what would be created (including auto-synthesised sections) and every finding, without
   * touching the database. The browser mirrors basic checks for instant feedback, but this is
   * the source of truth the preview screen renders, so there is no client/server drift.
   */
  async preview(
    identity: RequestIdentity,
    projectId: string,
    dto: BoqImportRequest,
  ): Promise<BoqImportPreview> {
    const prisma = this.tenancy.getClient();
    const { plan } = await this.resolveAndPlan(prisma, identity.activeOrganizationId, projectId, dto);
    return {
      ok: plan.ok,
      mode: dto.mode,
      sectionCount: plan.nodes.filter((node) => !node.isLeaf).length,
      itemCount: plan.nodes.filter((node) => node.isLeaf).length,
      autoCreatedSectionCount: plan.nodes.filter((node) => node.autoCreated).length,
      nodes: plan.nodes.map((node) => ({
        code: node.code,
        parentCode: node.parentCode,
        description: node.description,
        isLeaf: node.isLeaf,
        depth: node.depth,
        unit: node.unit,
        quantity: node.quantity,
        unitRate: node.unitRate,
        totalAmount: node.totalAmount,
        autoCreated: node.autoCreated,
      })),
      violations: plan.violations,
      warnings: plan.warnings,
    };
  }

  // ─── mutation helpers ──────────────────────────────────────────────────────────

  /**
   * Resolves the BOQ, its currency and any existing draft codes, then runs the pure planner.
   * Shared by preview (dry-run) and import (commit) so both judge a sheet identically — the
   * only difference is that import goes on to persist the plan.
   */
  private async resolveAndPlan(
    prisma: ReturnType<TenancyService['getClient']>,
    orgId: string,
    projectId: string,
    dto: BoqImportRequest,
  ): Promise<{ plan: BoqImportPlan; boq: BoqWithVersions | null; currency: string }> {
    const boq = await this.repo.findByProject(prisma, projectId);
    let currency: string;
    if (boq) {
      if (boq.organizationId !== orgId) throw new ForbiddenException();
      currency = boq.currency;
    } else {
      const project = await prisma.project.findFirst({
        where: { id: projectId, organizationId: orgId },
        select: { currency: true },
      });
      if (!project) throw new NotFoundException(`Project ${projectId} not found`);
      currency = project.currency || 'USD';
    }

    const draftId = boq?.currentDraftVersionId ?? null;
    const existingCodes = draftId
      ? await this.repo.findCodesInVersion(prisma, draftId)
      : new Set<string>();
    const knownUnits = await this.loadKnownUnits(prisma, orgId);

    const plan = planBoqImport(dto.rows, {
      boqCurrency: currency,
      existingCodes,
      knownUnits,
      mode: dto.mode,
    });
    return { plan, boq, currency };
  }

  private async createBoq(
    prisma: ReturnType<TenancyService['getClient']>,
    projectId: string,
    organizationId: string,
    currency: string,
  ): Promise<BoqWithVersions> {
    const created = await this.repo.createBoq(prisma, { projectId, organizationId, currency });
    // Reload as BoqWithVersions (freshly created, so no versions yet) for a uniform shape.
    const boq = await this.repo.findById(prisma, created.id);
    if (!boq) throw new NotFoundException('BOQ creation failed');
    return boq;
  }

  private async createEmptyDraft(
    prisma: ReturnType<TenancyService['getClient']>,
    boq: BoqWithVersions,
    userId: string,
  ): Promise<BoqVersion> {
    const nextVersionNumber = (await this.repo.maxVersionNumber(prisma, boq.id)) + 1;
    const version = await this.repo.createVersion(prisma, {
      boqId: boq.id,
      versionNumber: nextVersionNumber,
      status: 'DRAFT',
      createdBy: userId,
      preparedBy: userId,
      derivedFromVersionId: boq.currentApprovedVersionId ?? undefined,
    });
    await this.repo.updateBoq(prisma, boq.id, { currentDraftVersionId: version.id });
    return version;
  }

  /**
   * Turns the planner's structural nodes into create inputs: a fresh id per node, a
   * materialised path built from the parent's (path segments are node ids), and — for APPEND
   * under a pre-existing parent — a sort offset past that parent's current children.
   */
  private buildCreateInputs(
    nodes: PlannedImportNode[],
    boqId: string,
    versionId: string,
    existingNodes: BoqNode[],
    mode: BoqImportRequest['mode'],
  ): Prisma.BoqNodeCreateManyInput[] {
    const existingByCode = new Map(existingNodes.map((node) => [node.code, node]));
    const existingChildCount = new Map<string | null, number>();
    for (const node of existingNodes) {
      existingChildCount.set(node.parentId, (existingChildCount.get(node.parentId) ?? 0) + 1);
    }

    const idByCode = new Map<string, string>();
    const pathByCode = new Map<string, string>();
    const creates: Prisma.BoqNodeCreateManyInput[] = [];

    for (const node of nodes) {
      const id = randomUUID();
      idByCode.set(node.code, id);

      let parentId: string | null = null;
      let parentPath: string | null = null;
      let parentIsExisting = false;
      if (node.parentCode !== null) {
        const plannedParentId = idByCode.get(node.parentCode);
        if (plannedParentId !== undefined) {
          parentId = plannedParentId;
          parentPath = pathByCode.get(node.parentCode) ?? null;
        } else {
          const existingParent = existingByCode.get(node.parentCode);
          if (existingParent) {
            parentId = existingParent.id;
            parentPath = existingParent.path;
            parentIsExisting = true;
          }
        }
      }

      const path = parentPath ? `${parentPath}/${id}` : id;
      pathByCode.set(node.code, path);

      const offset =
        mode === 'APPEND' && parentIsExisting ? (existingChildCount.get(parentId) ?? 0) : 0;

      creates.push({
        id,
        boqId,
        versionId,
        parentId,
        path,
        depth: node.depth,
        sortOrder: node.sortOrder + offset,
        code: node.code,
        description: node.description,
        isLeaf: node.isLeaf,
        // Sections carry no pricing (the planner already nulled these); leaves carry theirs.
        unit: node.unit ?? undefined,
        quantity: node.quantity ?? undefined,
        unitRate: node.unitRate ?? undefined,
        currency: node.currency ?? undefined,
        totalAmount: node.totalAmount ?? undefined,
        // measurementMethod / pricingBasis / sourceType / isActive take their schema defaults.
      });
    }

    return creates;
  }

  /**
   * Saves imported leaves to the library (Q7), de-duplicated by description — a BOQ node code
   * is positional (`02.01.003`), not a reusable item identity, so a fresh library code is
   * generated per new description. Existing descriptions are skipped; the imported rate seeds
   * the assistance `lastUsedRate` (CONST-BOQ-021).
   */
  private async addLeavesToLibrary(
    prisma: Prisma.TransactionClient,
    organizationId: string,
    projectId: string,
    userId: string,
    nodes: PlannedImportNode[],
  ): Promise<number> {
    const existing = await this.libraryRepo.findAllForDedup(prisma as never, organizationId);
    const takenCodes = new Set(existing.map((item) => item.code.toUpperCase()));
    const activeDescriptions = new Set(
      existing.filter((item) => item.active).map((item) => item.description.trim().toLowerCase()),
    );

    const items: ImportLibraryItem[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      if (!node.isLeaf) continue;
      const description = node.description.trim();
      const key = description.toLowerCase();
      if (description.length === 0 || activeDescriptions.has(key) || seen.has(key)) continue;
      seen.add(key);

      const code = this.uniqueLibraryCode(description, takenCodes);
      takenCodes.add(code.toUpperCase());
      items.push({
        organizationId,
        code,
        description,
        defaultUnit: node.unit ?? undefined,
        lastUsedRate: node.unitRate ?? undefined,
        lastUsedProjectId: projectId,
        createdBy: userId,
      });
    }

    return this.libraryRepo.createManyFromImport(prisma as never, items);
  }

  private uniqueLibraryCode(description: string, taken: ReadonlySet<string>): string {
    const base =
      description
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'ITEM';
    if (!taken.has(base)) return base;
    let suffix = 2;
    while (taken.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }

  /**
   * The org's active units, lower-cased (code + symbol), for the UNKNOWN_UNIT warning. Returns
   * undefined when the registry is empty so the planner skips the check rather than flagging
   * every unit against a registry that was never populated.
   */
  private async loadKnownUnits(
    prisma: ReturnType<TenancyService['getClient']>,
    organizationId: string,
  ): Promise<Set<string> | undefined> {
    const units = await prisma.unitOfMeasure.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: { code: true, symbol: true },
    });
    if (units.length === 0) return undefined;
    const known = new Set<string>();
    for (const unit of units) {
      if (unit.code) known.add(unit.code.trim().toLowerCase());
      if (unit.symbol) known.add(unit.symbol.trim().toLowerCase());
    }
    return known;
  }
}

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { BoqNode, MeasurementMethod, PricingBasis, BoqSourceType, Prisma } from '@prisma/client';
import type { BoqChangeEventResponse, RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import {
  BoqPrismaRepository,
  BoqWithVersions,
  type BoqChangeEventInput,
} from '../infrastructure/boq-prisma.repository.js';
import {
  formatAmount,
  formatQuantity,
  lineAmount,
  sumAmounts,
  toDecimal,
  type DecimalString,
} from '../domain/boq-money.js';
import { MAX_DEPTH, validateNodeWrite } from '../domain/boq-node.policy.js';
import { proposeNodeCode } from '../domain/boq-code.policy.js';
import type { CreateNodeDto } from '../presentation/dto/create-node.dto.js';
import type { UpdateNodeDto } from '../presentation/dto/update-node.dto.js';
import type { MoveNodeDto } from '../presentation/dto/move-node.dto.js';

/**
 * A node as it crosses the wire.
 *
 * Deliberately not `BoqNode & { children }`: the Prisma row leaks `Decimal` objects whose
 * serialization is incidental, and `computedTotal` used to go out as a JSON number while
 * `totalAmount` went out as a string — the same quantity in two representations on one
 * object (B7). Every decimal here is an explicit string, per CONST-BOQ-014.
 */
export interface BoqTreeNodeView {
  id: string;
  boqId: string;
  versionId: string;
  parentId: string | null;
  path: string;
  depth: number;
  sortOrder: number;
  code: string;
  description: string;
  isLeaf: boolean;
  measurementMethod: MeasurementMethod;
  pricingBasis: PricingBasis;
  unit: string | null;
  quantity: DecimalString | null;
  unitRate: DecimalString | null;
  currency: string;
  totalAmount: DecimalString | null;
  originNodeId: string | null;
  sourceType: BoqSourceType;
  sourceChangeOrderId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  children: BoqTreeNodeView[];
  /** Leaf: its own amount. Section: the sum of its descendants. Null when unpriced. */
  computedTotal: DecimalString | null;
}

@Injectable()
export class BoqTreeService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: BoqPrismaRepository,
  ) {}

  // ─── Queries ─────────────────────────────────────────────────────────────────

  async getTree(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
  ): Promise<BoqTreeNodeView[]> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoqForProject(prisma, projectId, identity.activeOrganizationId);
    this.requireVersionBelongsToBoq(versionId, boq);

    const nodes = await this.repo.findNodesByVersion(prisma, versionId);
    return buildTree(nodes, boq.currency);
  }

  // ─── Commands ────────────────────────────────────────────────────────────────

  async addNode(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
    dto: CreateNodeDto,
  ): Promise<BoqNode> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoqForProject(prisma, projectId, identity.activeOrganizationId);
    this.requireVersionBelongsToBoq(versionId, boq);
    await this.requireDraftVersion(prisma, versionId);

    let parentPath: string | null = null;
    let parentDepth = -1;
    let parentIsItem = false;
    let parentCode: string | null = null;

    if (dto.parentId) {
      const parent = await this.repo.findNodeById(prisma, dto.parentId);
      if (!parent || parent.versionId !== versionId) {
        throw new NotFoundException(`Parent node ${dto.parentId} not found in this version`);
      }
      parentPath = parent.path;
      parentDepth = parent.depth;
      parentIsItem = parent.isLeaf;
      parentCode = parent.code;
    }

    const isLeaf = dto.isLeaf ?? false;
    const overrideCode = dto.code?.trim();

    // Position: append unless the caller asked for a specific slot. Sibling order is dense
    // and server-owned (CONST-BOQ-017), so an out-of-range request is clamped, not rejected.
    const siblingCount = await this.repo.countSiblings(prisma, versionId, dto.parentId ?? null);
    const targetOrder = Math.max(0, Math.min(dto.sortOrder ?? siblingCount, siblingCount));

    // D2: the server assigns the code from the tree position unless the caller overrode it. If a
    // concurrent add just claimed the generated code (the unique index fires), regenerate and
    // retry; an *overridden* code that collides is the caller's to resolve, so it is not retried.
    for (let attempt = 1; ; attempt += 1) {
      const code =
        overrideCode && overrideCode.length > 0
          ? overrideCode
          : proposeNodeCode(
              isLeaf ? 'item' : 'section',
              parentCode,
              await this.repo.findChildCodes(prisma, versionId, dto.parentId ?? null),
            );

      this.assertValid(
        validateNodeWrite(
          {
            code,
            isLeaf,
            unit: dto.unit,
            quantity: dto.quantity,
            unitRate: dto.unitRate,
            currency: dto.currency,
            depth: parentDepth + 1,
          },
          {
            boqCurrency: boq.currency,
            siblingCodes: await this.repo.findCodesInVersion(prisma, versionId),
            parentIsItem,
            hasChildren: false,
          },
        ),
      );

      try {
        return await this.repo.createNodeAtPosition(
          prisma,
          {
            boqId: boq.id,
            versionId,
            parentId: dto.parentId ?? null,
            path: '',
            depth: parentDepth + 1,
            sortOrder: targetOrder,
            code,
            description: dto.description,
            isLeaf,
            measurementMethod: dto.measurementMethod ?? MeasurementMethod.QUANTITY,
            pricingBasis: dto.pricingBasis ?? PricingBasis.UNIT_RATE,
            unit: isLeaf ? (dto.unit ?? null) : null,
            quantity: isLeaf ? (dto.quantity ?? null) : null,
            unitRate: isLeaf ? (dto.unitRate ?? null) : null,
            // A leaf always carries the BOQ's currency; a section carries none. Storing it makes
            // the IPA rate snapshot self-describing without walking back up to the aggregate.
            currency: isLeaf ? boq.currency : null,
            totalAmount: formatAmount(lineAmount(dto.quantity, dto.unitRate, isLeaf)),
          },
          parentPath,
          targetOrder,
          {
            ...this.changeBase(identity, boq, versionId),
            code,
            action: 'CREATE',
            detail: isLeaf ? `Added item ${code}` : `Added section ${code}`,
          },
        );
      } catch (error) {
        if (!overrideCode && attempt < 4 && isDuplicateCodeConflict(error)) continue;
        throw error;
      }
    }
  }

  async updateNode(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
    nodeId: string,
    dto: UpdateNodeDto,
  ): Promise<BoqNode> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoqForProject(prisma, projectId, identity.activeOrganizationId);
    this.requireVersionBelongsToBoq(versionId, boq);
    await this.requireDraftVersion(prisma, versionId);

    const node = await this.requireNode(prisma, nodeId, versionId);
    const childCount = await this.repo.countChildren(prisma, nodeId, versionId);

    // The proposed state after the patch, not the patch itself — the rules are about what
    // the node ends up being.
    const isLeaf = dto.isLeaf ?? node.isLeaf;
    const code = dto.code ?? node.code;
    const unit = dto.unit !== undefined ? dto.unit : node.unit;
    const quantity = dto.quantity !== undefined ? dto.quantity : node.quantity?.toString();
    const unitRate = dto.unitRate !== undefined ? dto.unitRate : node.unitRate?.toString();

    this.assertValid(
      validateNodeWrite(
        { code, isLeaf, unit, quantity, unitRate, currency: dto.currency, depth: node.depth },
        {
          boqCurrency: boq.currency,
          siblingCodes: await this.repo.findCodesInVersion(prisma, versionId, nodeId),
          parentIsItem: false,
          hasChildren: childCount > 0,
        },
      ),
    );

    const events = this.buildUpdateEvents(identity, boq, node, dto, {
      code,
      isLeaf,
      unit: unit ?? null,
      quantity: quantity ?? null,
      unitRate: unitRate ?? null,
    });

    return this.repo.updateNode(
      prisma,
      nodeId,
      {
        code,
        description: dto.description,
        isLeaf,
        measurementMethod: dto.measurementMethod,
        pricingBasis: dto.pricingBasis,
        unit: isLeaf ? (unit ?? null) : null,
        quantity: isLeaf ? (quantity ?? null) : null,
        unitRate: isLeaf ? (unitRate ?? null) : null,
        currency: isLeaf ? boq.currency : null,
        totalAmount: formatAmount(lineAmount(quantity, unitRate, isLeaf)),
      },
      events,
    );
  }

  async moveNode(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
    nodeId: string,
    dto: MoveNodeDto,
  ): Promise<BoqTreeNodeView[]> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoqForProject(prisma, projectId, identity.activeOrganizationId);
    this.requireVersionBelongsToBoq(versionId, boq);
    await this.requireDraftVersion(prisma, versionId);

    const node = await this.requireNode(prisma, nodeId, versionId);

    if (dto.newParentId === nodeId) {
      throw new BadRequestException('Cannot move a node to itself.');
    }

    if (dto.newParentId) {
      const newParent = await this.repo.findNodeById(prisma, dto.newParentId);
      if (!newParent || newParent.versionId !== versionId) {
        throw new NotFoundException(`Target parent node ${dto.newParentId} not found`);
      }
      if (newParent.isLeaf) {
        throw new BadRequestException('Cannot move a node under a billable item.');
      }
      if (newParent.path.startsWith(node.path + '/') || newParent.path === node.path) {
        throw new BadRequestException('Cannot move a node to one of its own descendants.');
      }

      // The subtree moves with the node, so it is the deepest descendant that has to fit.
      const subtreeHeight = await this.subtreeHeight(prisma, versionId, node);
      if (newParent.depth + 1 + subtreeHeight > MAX_DEPTH) {
        throw new BadRequestException(
          `This move would exceed the ${MAX_DEPTH + 1}-level BOQ hierarchy limit.`,
        );
      }

      await this.repo.moveNode(
        prisma,
        versionId,
        node,
        dto.newParentId,
        newParent.path,
        newParent.depth,
        dto.newSortOrder,
        this.moveEvent(identity, boq, versionId, node),
      );
    } else {
      await this.repo.moveNode(
        prisma,
        versionId,
        node,
        null,
        null,
        -1,
        dto.newSortOrder,
        this.moveEvent(identity, boq, versionId, node),
      );
    }

    // Returning the tree closes B6 — the endpoint used to answer 200 with an empty body,
    // leaving the client to guess whether anything moved.
    const nodes = await this.repo.findNodesByVersion(prisma, versionId);
    return buildTree(nodes, boq.currency);
  }

  async deleteNode(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
    nodeId: string,
  ): Promise<void> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoqForProject(prisma, projectId, identity.activeOrganizationId);
    this.requireVersionBelongsToBoq(versionId, boq);
    await this.requireDraftVersion(prisma, versionId);

    const node = await this.requireNode(prisma, nodeId, versionId);

    const childCount = await this.repo.countChildren(prisma, nodeId, versionId);
    if (childCount > 0) {
      throw new BadRequestException(
        'Cannot delete a section that has children. Delete or re-parent them first.',
      );
    }

    // CONST-BOQ-003. Claims, orders and postings reference nodes by plain string columns,
    // so nothing in the database stops this delete — losing the row would orphan a claimed
    // line and silently change what a certificate was measured against.
    const references = await this.repo.countNodeReferences(prisma, nodeId);
    if (references.length > 0) {
      throw new ConflictException({
        message:
          'This BOQ item is referenced by downstream records and cannot be deleted. Deactivate it instead.',
        details: { nodeId, code: node.code, references },
      });
    }

    await this.repo.deleteNodeAndReindex(prisma, node, {
      ...this.changeBase(identity, boq, versionId),
      nodeId: node.id,
      code: node.code,
      action: 'DELETE',
      detail: node.isLeaf ? `Deleted item ${node.code}` : `Deleted section ${node.code}`,
    });
  }

  /**
   * The version's change log, newest first — the "who changed what, and what was it before" feed
   * (BOQ refinement Phase 1). Resolves actor names in one batch query.
   */
  async getHistory(
    identity: RequestIdentity,
    projectId: string,
    versionId: string,
    options: { nodeId?: string; take: number; skip: number },
  ): Promise<BoqChangeEventResponse[]> {
    const prisma = this.tenancyService.getClient();
    const boq = await this.requireBoqForProject(prisma, projectId, identity.activeOrganizationId);
    this.requireVersionBelongsToBoq(versionId, boq);

    const events = await this.repo.findHistory(prisma, versionId, options);
    const names = await this.repo.findActorNames(prisma, [
      ...new Set(events.map((event) => event.actorUserId)),
    ]);

    return events.map((event) => ({
      id: event.id,
      versionId: event.versionId,
      nodeId: event.nodeId,
      code: event.code,
      action: event.action,
      field: event.field,
      oldValue: event.oldValue,
      newValue: event.newValue,
      detail: event.detail,
      actorUserId: event.actorUserId,
      actorName: names.get(event.actorUserId) ?? null,
      createdAt: event.createdAt.toISOString(),
    }));
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  /** The org/boq/version/actor fields every change event shares. */
  private changeBase(
    identity: RequestIdentity,
    boq: BoqWithVersions,
    versionId: string,
  ): Pick<BoqChangeEventInput, 'organizationId' | 'boqId' | 'versionId' | 'actorUserId'> {
    return {
      organizationId: identity.activeOrganizationId,
      boqId: boq.id,
      versionId,
      actorUserId: identity.userId,
    };
  }

  private moveEvent(
    identity: RequestIdentity,
    boq: BoqWithVersions,
    versionId: string,
    node: BoqNode,
  ): BoqChangeEventInput {
    return {
      ...this.changeBase(identity, boq, versionId),
      nodeId: node.id,
      code: node.code,
      action: 'MOVE',
      detail: `Moved ${node.code}`,
    };
  }

  /**
   * One UPDATE event per field that actually changed, with its before/after — this is what makes
   * the log read "rate 80.00 → 85.00". Quantities and rates are compared as decimals so a
   * reformat ("85" vs "85.00") is not mistaken for an edit.
   */
  private buildUpdateEvents(
    identity: RequestIdentity,
    boq: BoqWithVersions,
    node: BoqNode,
    dto: UpdateNodeDto,
    resolved: { code: string; isLeaf: boolean; unit: string | null; quantity: string | null; unitRate: string | null },
  ): BoqChangeEventInput[] {
    const base = {
      ...this.changeBase(identity, boq, node.versionId),
      nodeId: node.id,
      code: resolved.code,
      action: 'UPDATE' as const,
    };
    const events: BoqChangeEventInput[] = [];

    const textChanged = (field: string, before: string | null, after: string | null | undefined) => {
      if (after === undefined) return; // field not part of this patch
      const from = before ?? null;
      const to = after ?? null;
      if (from !== to) events.push({ ...base, field, oldValue: from, newValue: to });
    };
    const numberChanged = (field: string, before: BoqNode['quantity'], after: string | null) => {
      const from = before !== null ? toDecimal(before) : null;
      const to = after !== null ? toDecimal(after) : null;
      const differs = from === null || to === null ? from !== to : !from.equals(to);
      if (differs) {
        events.push({ ...base, field, oldValue: before !== null ? before.toString() : null, newValue: after });
      }
    };

    textChanged('code', node.code, resolved.code);
    textChanged('description', node.description, dto.description);
    if (resolved.isLeaf) {
      textChanged('unit', node.unit, resolved.unit);
      numberChanged('quantity', node.quantity, resolved.quantity);
      numberChanged('unitRate', node.unitRate, resolved.unitRate);
    }
    textChanged('measurementMethod', node.measurementMethod, dto.measurementMethod);
    textChanged('pricingBasis', node.pricingBasis, dto.pricingBasis);

    return events;
  }

  private assertValid(violations: { code: string; message: string }[]): void {
    if (violations.length === 0) return;
    throw new BadRequestException({
      message: violations[0]!.message,
      details: { violations },
    });
  }

  /** Levels below `node`, 0 when it is a leaf of the tree. */
  private async subtreeHeight(
    prisma: ReturnType<TenancyService['getClient']>,
    versionId: string,
    node: BoqNode,
  ): Promise<number> {
    const nodes = await this.repo.findNodesByVersion(prisma, versionId);
    const prefix = `${node.path}/`;
    return nodes
      .filter((candidate) => candidate.path.startsWith(prefix))
      .reduce((max, descendant) => Math.max(max, descendant.depth - node.depth), 0);
  }

  private async requireBoqForProject(
    prisma: ReturnType<TenancyService['getClient']>,
    projectId: string,
    organizationId: string,
  ): Promise<BoqWithVersions> {
    const boq = await this.repo.findByProject(prisma, projectId);
    if (!boq) throw new NotFoundException(`No BOQ found for project ${projectId}`);
    if (boq.organizationId !== organizationId) throw new ForbiddenException();
    return boq;
  }

  private requireVersionBelongsToBoq(versionId: string, boq: BoqWithVersions): void {
    const belongs = boq.versions.some((v) => v.id === versionId);
    if (!belongs) throw new NotFoundException(`Version ${versionId} does not belong to this BOQ`);
  }

  private async requireDraftVersion(
    prisma: ReturnType<TenancyService['getClient']>,
    versionId: string,
  ): Promise<void> {
    const version = await this.repo.findVersion(prisma, versionId);
    if (!version) throw new NotFoundException(`Version ${versionId} not found`);
    if (version.status !== 'DRAFT') {
      throw new ForbiddenException('BOQ nodes can only be modified in a DRAFT version.');
    }
  }

  private async requireNode(
    prisma: ReturnType<TenancyService['getClient']>,
    nodeId: string,
    versionId: string,
  ): Promise<BoqNode> {
    const node = await this.repo.findNodeById(prisma, nodeId);
    if (!node || node.versionId !== versionId) {
      throw new NotFoundException(`Node ${nodeId} not found in version ${versionId}`);
    }
    return node;
  }
}

/**
 * True when a write hit the version's unique-code index — the signal to retry an auto-generated
 * code a concurrent add claimed first. An overridden code that collides is not retried.
 */
function isDuplicateCodeConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    String((error.meta as { target?: unknown } | undefined)?.target ?? '').includes('code')
  );
}

/**
 * Flat ordered rows → recursive tree, with section totals summed bottom-up in Decimal.
 *
 * Exported because the readiness, workspace and compare queries all need the same shape and
 * must agree with what the tree endpoint returns.
 */
export function buildTree(nodes: BoqNode[], boqCurrency: string): BoqTreeNodeView[] {
  const views = new Map<string, BoqTreeNodeView>();

  for (const node of nodes) {
    views.set(node.id, {
      id: node.id,
      boqId: node.boqId,
      versionId: node.versionId,
      parentId: node.parentId,
      path: node.path,
      depth: node.depth,
      sortOrder: node.sortOrder,
      code: node.code,
      description: node.description,
      isLeaf: node.isLeaf,
      measurementMethod: node.measurementMethod,
      pricingBasis: node.pricingBasis,
      unit: node.unit,
      quantity: formatQuantity(toDecimal(node.quantity)),
      unitRate: formatAmount(toDecimal(node.unitRate)),
      currency: node.currency ?? boqCurrency,
      totalAmount: formatAmount(toDecimal(node.totalAmount)),
      originNodeId: node.originNodeId,
      sourceType: node.sourceType,
      sourceChangeOrderId: node.sourceChangeOrderId,
      isActive: node.isActive,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      children: [],
      computedTotal: formatAmount(toDecimal(node.totalAmount)),
    });
  }

  const roots: BoqTreeNodeView[] = [];
  for (const view of views.values()) {
    const parent = view.parentId ? views.get(view.parentId) : undefined;
    if (parent) parent.children.push(view);
    else roots.push(view);
  }

  for (const view of views.values()) {
    view.children.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  roots.sort((a, b) => a.sortOrder - b.sortOrder);

  sumSectionTotals(roots);
  return roots;
}

function sumSectionTotals(nodes: BoqTreeNodeView[]): void {
  for (const node of nodes) {
    if (node.children.length === 0) continue;
    sumSectionTotals(node.children);
    node.computedTotal = formatAmount(
      sumAmounts(node.children.map((child) => toDecimal(child.computedTotal))),
    );
  }
}

/** The version's grand total — the sum of its root sections. */
export function treeTotal(roots: BoqTreeNodeView[]): DecimalString | null {
  return formatAmount(sumAmounts(roots.map((root) => toDecimal(root.computedTotal))));
}

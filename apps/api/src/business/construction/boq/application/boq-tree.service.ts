import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { BoqNode, MeasurementMethod, PricingBasis, BoqSourceType } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { BoqPrismaRepository, BoqWithVersions } from '../infrastructure/boq-prisma.repository.js';
import {
  formatAmount,
  formatQuantity,
  lineAmount,
  sumAmounts,
  toDecimal,
  type DecimalString,
} from '../domain/boq-money.js';
import { MAX_DEPTH, validateNodeWrite } from '../domain/boq-node.policy.js';
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

    if (dto.parentId) {
      const parent = await this.repo.findNodeById(prisma, dto.parentId);
      if (!parent || parent.versionId !== versionId) {
        throw new NotFoundException(`Parent node ${dto.parentId} not found in this version`);
      }
      parentPath = parent.path;
      parentDepth = parent.depth;
      parentIsItem = parent.isLeaf;
    }

    const isLeaf = dto.isLeaf ?? false;
    this.assertValid(
      validateNodeWrite(
        {
          code: dto.code,
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

    // Position: append unless the caller asked for a specific slot. Sibling order is dense
    // and server-owned (CONST-BOQ-017), so an out-of-range request is clamped, not rejected.
    const siblingCount = await this.repo.countSiblings(prisma, versionId, dto.parentId ?? null);
    const targetOrder = Math.max(0, Math.min(dto.sortOrder ?? siblingCount, siblingCount));

    return this.repo.createNodeAtPosition(
      prisma,
      {
        boqId: boq.id,
        versionId,
        parentId: dto.parentId ?? null,
        path: '',
        depth: parentDepth + 1,
        sortOrder: targetOrder,
        code: dto.code,
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
    );
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

    return this.repo.updateNode(prisma, nodeId, {
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
    });
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
      );
    } else {
      await this.repo.moveNode(prisma, versionId, node, null, null, -1, dto.newSortOrder);
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

    await this.repo.deleteNodeAndReindex(prisma, node);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

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

import { Injectable } from '@nestjs/common';
import type {
  PrismaClient, PurchaseOrderStatus, PurchaseOrderRevisionStatus, ProcurementLineType,
} from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreatePoLineData {
  lineNumber: number;
  lineType: ProcurementLineType;
  materialId?: string;
  description: string;
  unitOfMeasureId: string;
  orderedQuantity: Decimal;
  unitPrice: Decimal;
  extendedAmount: Decimal;
  spendCategoryId?: string;
  taxCodeId?: string;
  // Cost-target (A3/D7): both set for a project-cost-relevant line, both undefined for org lines.
  projectId?: string;
  boqNodeId?: string;
  notes?: string;
}

/** Facts a cost-target validity check needs, resolved from a boqNodeId within one org. */
export interface ResolvedCostNode {
  projectId: string;
  isLeaf: boolean;
  isActive: boolean;
}

export interface CreatePoRevisionData {
  organizationId: string;
  supplierId: string;
  poNumber: string;
  currencyCode: string;
  effectiveFrom: Date;
  reason?: string;
  deliveryAddress?: string;
  expectedDeliveryDate?: Date;
  createdBy: string;
  lines: CreatePoLineData[];
}

export interface CreatePoLineAllocationData {
  organizationId: string;
  purchaseOrderLineId: string;
  materialRequestLineId: string;
  allocatedQuantity: Decimal;
}

// Read model. Each line carries enough label info for the cost-target chip (project code/name,
// BOQ node code/description) and for GR / PO-backed bill to inherit the target (D7).
const PO_INCLUDE = {
  revisions: {
    include: {
      lines: {
        include: {
          material: true,
          uom: true,
          spendCategory: true,
          project: { select: { id: true, code: true, name: true } },
          boqNode: { select: { id: true, code: true, description: true } },
        },
        orderBy: { lineNumber: 'asc' as const },
      },
    },
    orderBy: { revisionNumber: 'asc' as const },
  },
  supplier: true,
} as const;

@Injectable()
export class PurchaseOrderRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.purchaseOrder.findFirst({ where: { id, organizationId }, include: PO_INCLUDE });
  }

  findByPoNumber(prisma: TenantPrisma, organizationId: string, poNumber: string) {
    return prisma.purchaseOrder.findUnique({ where: { organizationId_poNumber: { organizationId, poNumber } }, include: PO_INCLUDE });
  }

  findAll(prisma: TenantPrisma, organizationId: string, filters?: { status?: PurchaseOrderStatus; supplierId?: string }) {
    return prisma.purchaseOrder.findMany({
      where: {
        organizationId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.supplierId ? { supplierId: filters.supplierId } : {}),
      },
      include: { supplier: true, revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createWithRevision(prisma: TenantPrisma, data: CreatePoRevisionData) {
    const { lines, organizationId, supplierId, poNumber, createdBy, ...revData } = data;

    const po = await prisma.purchaseOrder.create({
      data: {
        organizationId,
        supplierId,
        poNumber,
        createdBy,
        revisions: {
          create: {
            ...revData,
            revisionNumber: 1,
            createdBy,
            lines: { create: lines },
          },
        },
      },
      include: PO_INCLUDE,
    });

    const firstRevision = po.revisions[0];
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { currentRevisionId: firstRevision.id },
    });

    return prisma.purchaseOrder.findFirst({ where: { id: po.id }, include: PO_INCLUDE });
  }

  findRevisionById(prisma: TenantPrisma, revisionId: string) {
    return prisma.purchaseOrderRevision.findFirst({
      where: { id: revisionId },
      include: {
        lines: {
          include: { material: true, uom: true },
          orderBy: { lineNumber: 'asc' },
        },
        purchaseOrder: true,
      },
    });
  }

  updateRevisionStatus(
    prisma: TenantPrisma,
    revisionId: string,
    status: PurchaseOrderRevisionStatus,
    extra?: { approvedBy?: string; approvedAt?: Date; approvalInstanceId?: string },
  ) {
    return prisma.purchaseOrderRevision.update({ where: { id: revisionId }, data: { status, ...extra } });
  }

  updatePoStatus(prisma: TenantPrisma, poId: string, status: PurchaseOrderStatus, currentRevisionId?: string) {
    return prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status, ...(currentRevisionId ? { currentRevisionId } : {}) },
    });
  }

  createLineAllocation(prisma: TenantPrisma, data: CreatePoLineAllocationData) {
    return prisma.purchaseOrderLineRequestAllocation.create({ data });
  }

  /**
   * Resolves a BOQ node (org-scoped) into the facts a cost-target check needs: which project's
   * BOQ owns it, whether it is a billable leaf item, and whether it is still active. Returns null
   * when the id resolves to no node in this org — the service treats that as BOQ_NODE_NOT_FOUND.
   *
   * Org isolation is enforced through the node's BOQ (`boq.organizationId`), so a node from
   * another tenant is invisible here.
   */
  async resolveCostNode(
    prisma: TenantPrisma,
    organizationId: string,
    boqNodeId: string,
  ): Promise<ResolvedCostNode | null> {
    const node = await prisma.boqNode.findFirst({
      where: { id: boqNodeId, version: { boq: { organizationId } } },
      select: { isLeaf: true, isActive: true, version: { select: { boq: { select: { projectId: true } } } } },
    });
    if (!node) return null;
    return {
      projectId: node.version.boq.projectId,
      isLeaf: node.isLeaf,
      isActive: node.isActive,
    };
  }

  countPoNumbers(prisma: TenantPrisma, organizationId: string): Promise<number> {
    return prisma.purchaseOrder.count({ where: { organizationId } });
  }

  async createRevision(
    prisma: TenantPrisma,
    purchaseOrderId: string,
    revisionNumber: number,
    data: Omit<CreatePoRevisionData, 'organizationId' | 'supplierId' | 'poNumber'>,
  ) {
    const { lines, createdBy, ...revData } = data;
    return prisma.purchaseOrderRevision.create({
      data: {
        purchaseOrderId,
        revisionNumber,
        createdBy,
        ...revData,
        lines: { create: lines },
      },
      include: { lines: { include: { material: true, uom: true }, orderBy: { lineNumber: 'asc' } } },
    });
  }
}

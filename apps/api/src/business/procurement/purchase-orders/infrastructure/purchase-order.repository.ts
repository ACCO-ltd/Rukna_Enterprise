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

  findAll(prisma: TenantPrisma, organizationId: string, filters?: { status?: PurchaseOrderStatus; supplierId?: string; projectId?: string }) {
    return prisma.purchaseOrder.findMany({
      where: {
        organizationId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.supplierId ? { supplierId: filters.supplierId } : {}),
        ...(filters?.projectId ? {
          revisions: { some: { lines: { some: { projectId: filters.projectId } } } },
        } : {}),
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
        status: 'DRAFT',
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
   * Quantity of each MR line already on a LIVE order: allocations on lines of a revision that is
   * still in play (not CANCELLED, not SUPERSEDED — a superseded revision's quantity lives on in its
   * successor's own allocations) of a purchase order that is not CANCELLED. A cancelled order frees
   * its quantity, so an MR line can be ordered again (ADR-044 §8 re-raise after a cancelled draft).
   */
  async liveAllocatedQuantities(prisma: TenantPrisma, mrLineIds: string[]): Promise<Map<string, Decimal>> {
    if (mrLineIds.length === 0) return new Map();
    const rows = await prisma.purchaseOrderLineRequestAllocation.groupBy({
      by: ['materialRequestLineId'],
      where: {
        materialRequestLineId: { in: mrLineIds },
        purchaseOrderLine: {
          revision: {
            status: { notIn: ['CANCELLED', 'SUPERSEDED'] },
            purchaseOrder: { status: { not: 'CANCELLED' } },
          },
        },
      },
      _sum: { allocatedQuantity: true },
    });
    return new Map(
      rows
        .filter((r) => r._sum.allocatedQuantity !== null)
        .map((r) => [r.materialRequestLineId, r._sum.allocatedQuantity as Decimal] as const),
    );
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

  /**
   * ADR-044 §7 — the quotation request whose award this PO was raised from (read from
   * `quotation_requests` directly: no import of the quotation module, no cycle). Null for a PO not
   * raised from an award.
   */
  findAwardForPurchaseOrder(prisma: TenantPrisma, organizationId: string, purchaseOrderId: string) {
    return prisma.quotationRequest.findFirst({
      where: { purchaseOrderId, organizationId },
      select: {
        id: true,
        number: true,
        status: true,
        purchaseOrderId: true,
        awardedSupplierId: true,
        awardedTotal: true,
        awardedBy: true,
        awardFinalApproverId: true,
        awardApprovalInstanceId: true,
        materialRequest: { select: { lines: { select: { id: true } } } },
      },
    });
  }

  /** ADR-044 — the MR's non-cancelled quotation rounds (newest first), for the manual-order guard. */
  findQuotationRoundsForMaterialRequest(prisma: TenantPrisma, organizationId: string, materialRequestId: string) {
    return prisma.quotationRequest.findMany({
      where: { organizationId, materialRequestId, status: { not: 'CANCELLED' } },
      select: { id: true, number: true, closedAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Review M1 — the award's order is confirmed: its quotation round is closed (idempotent). */
  closeAwardRound(prisma: TenantPrisma, purchaseOrderId: string) {
    return prisma.quotationRequest.updateMany({
      where: { purchaseOrderId, status: 'AWARDED', closedAt: null },
      data: { closedAt: new Date() },
    });
  }

  /** Takes the award's row lock and confirms it still covers `purchaseOrderId`. */
  async lockAwardFor(prisma: TenantPrisma, quotationRequestId: string, purchaseOrderId: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM quotation_requests
       WHERE id = ${quotationRequestId}
         AND purchase_order_id = ${purchaseOrderId}
         AND status = 'AWARDED'
       FOR UPDATE`;
    return rows.length === 1;
  }

  /** The MR lines each PO line allocates to. */
  async mrLinesByPoLine(prisma: TenantPrisma, purchaseOrderLineIds: string[]): Promise<Map<string, string[]>> {
    const rows = await prisma.purchaseOrderLineRequestAllocation.findMany({
      where: { purchaseOrderLineId: { in: purchaseOrderLineIds } },
      select: { purchaseOrderLineId: true, materialRequestLineId: true },
    });
    const byLine = new Map<string, string[]>();
    for (const row of rows) {
      byLine.set(row.purchaseOrderLineId, [...(byLine.get(row.purchaseOrderLineId) ?? []), row.materialRequestLineId]);
    }
    return byLine;
  }

  /** ADR-044 §8 — first use of the revision's quotation columns. */
  setRevisionQuotation(
    prisma: TenantPrisma,
    revisionId: string,
    data: { quotationRef: string; quotationDate: Date | null; quotedAmount: Decimal },
  ) {
    return prisma.purchaseOrderRevision.update({ where: { id: revisionId }, data });
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

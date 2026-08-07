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
  notes?: string;
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

const PO_INCLUDE = {
  revisions: {
    include: {
      lines: {
        include: { material: true, uom: true, spendCategory: true },
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

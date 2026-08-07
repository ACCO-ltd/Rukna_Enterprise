import { Injectable } from '@nestjs/common';
import type { PrismaClient, GrnStatus, ProcurementLineType, QualityStatus } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateGrnLineData {
  purchaseOrderLineId: string;
  lineNumber: number;
  lineType: ProcurementLineType;
  materialId?: string;
  unitOfMeasureId: string;
  spendCategoryId?: string;
  orderedQuantity: Decimal;
  previouslyReceivedQty: Decimal;
  receivedQuantity: Decimal;
  acceptedQuantity: Decimal;
  rejectedQuantity: Decimal;
  rejectionReason?: string;
  qualityStatus: QualityStatus;
  notes?: string;
}

export interface CreateGrnLineAllocationData {
  organizationId: string;
  goodsReceiptLineId: string;
  purchaseOrderLineRequestAllocationId: string;
  receivedQuantity: Decimal;
  acceptedQuantity: Decimal;
  rejectedQuantity: Decimal;
}

export interface CreateGrnData {
  organizationId: string;
  grnNumber: string;
  purchaseOrderId: string;
  purchaseOrderRevisionId: string;
  supplierId: string;
  deliveryDate: Date;
  deliveryNoteRef?: string;
  createdBy: string;
  lines: CreateGrnLineData[];
}

const GRN_INCLUDE = {
  lines: {
    include: {
      material: true,
      uom: true,
      allocations: true,
    },
    orderBy: { lineNumber: 'asc' as const },
  },
} as const;

@Injectable()
export class GoodsReceiptRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.goodsReceiptNote.findFirst({ where: { id, organizationId }, include: GRN_INCLUDE });
  }

  findAll(
    prisma: TenantPrisma,
    organizationId: string,
    filters?: { status?: GrnStatus; purchaseOrderId?: string },
  ) {
    return prisma.goodsReceiptNote.findMany({
      where: {
        organizationId,
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.purchaseOrderId ? { purchaseOrderId: filters.purchaseOrderId } : {}),
      },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(prisma: TenantPrisma, data: CreateGrnData) {
    const { lines, ...header } = data;
    return prisma.goodsReceiptNote.create({
      data: { ...header, lines: { create: lines } },
      include: GRN_INCLUDE,
    });
  }

  updateStatus(
    prisma: TenantPrisma,
    id: string,
    status: GrnStatus,
    extra?: { postedAt?: Date; postedBy?: string; exceptionReason?: string },
  ) {
    return prisma.goodsReceiptNote.update({ where: { id }, data: { status, ...extra }, include: GRN_INCLUDE });
  }

  createLineAllocation(prisma: TenantPrisma, data: CreateGrnLineAllocationData) {
    return prisma.goodsReceiptLineAllocation.create({ data });
  }

  countGrnNumbers(prisma: TenantPrisma, organizationId: string): Promise<number> {
    return prisma.goodsReceiptNote.count({ where: { organizationId } });
  }

  // Sum previously received quantity for a PO line across all POSTED GRNs
  previouslyReceived(prisma: TenantPrisma, purchaseOrderLineId: string): Promise<Decimal | null> {
    return prisma.goodsReceiptLine
      .aggregate({
        where: {
          purchaseOrderLineId,
          grn: { status: 'POSTED' },
        },
        _sum: { receivedQuantity: true },
      })
      .then(r => r._sum.receivedQuantity as Decimal | null);
  }

  findPoLineAllocations(prisma: TenantPrisma, purchaseOrderLineId: string) {
    return prisma.purchaseOrderLineRequestAllocation.findMany({
      where: { purchaseOrderLineId },
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { PrismaClient, BillMatchType, BillMatchStatus } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateMatchLineData {
  supplierBillLineId: string;
  purchaseOrderLineId: string;
  goodsReceiptLineId?: string;
  poQuantity: Decimal;
  receivedQuantity?: Decimal;
  billedQuantity: Decimal;
  poUnitPrice: Decimal;
  billedUnitPrice: Decimal;
  quantityVariance: Decimal;
  priceVariance: Decimal;
  amountVariance: Decimal;
  withinTolerance: boolean;
  exceptionReason?: string;
}

@Injectable()
export class BillMatchRepository {
  findByBillId(prisma: TenantPrisma, supplierBillId: string) {
    return prisma.supplierBillMatch.findUnique({
      where: { supplierBillId },
      include: { lines: { include: { purchaseOrderLine: true } } },
    });
  }

  async createOrReplace(
    prisma: TenantPrisma,
    supplierBillId: string,
    matchType: BillMatchType,
    lines: CreateMatchLineData[],
  ) {
    // Delete previous match if exists (re-run scenario)
    const existing = await prisma.supplierBillMatch.findUnique({ where: { supplierBillId } });
    if (existing) {
      await prisma.supplierBillMatchLine.deleteMany({ where: { supplierBillMatchId: existing.id } });
      await prisma.supplierBillMatch.delete({ where: { supplierBillId } });
    }

    return prisma.supplierBillMatch.create({
      data: {
        supplierBillId,
        matchType,
        lines: {
          create: lines.map(({ purchaseOrderLineId, ...rest }) => ({
            ...rest,
            purchaseOrderLine: { connect: { id: purchaseOrderLineId } },
          })),
        },
      },
      include: { lines: { include: { purchaseOrderLine: true } } },
    });
  }

  updateStatus(
    prisma: TenantPrisma,
    supplierBillId: string,
    status: BillMatchStatus,
    extra?: { matchedAt?: Date; matchedBy?: string; approvedBy?: string; approvedAt?: Date; approvalReason?: string },
  ) {
    return prisma.supplierBillMatch.update({
      where: { supplierBillId },
      data: { status, ...extra },
    });
  }

  // Fetch org-level tolerance policy (simplified — full hierarchy resolution built in Sprint 5 service)
  findOrgTolerancePolicy(prisma: TenantPrisma, organizationId: string) {
    return prisma.matchingTolerancePolicy.findFirst({
      where: { organizationId, scopeType: 'ORGANIZATION', status: 'ACTIVE' },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  findPoTolerancePolicy(prisma: TenantPrisma, organizationId: string, purchaseOrderId: string) {
    return prisma.matchingTolerancePolicy.findFirst({
      where: { organizationId, scopeType: 'PURCHASE_ORDER', purchaseOrderId, status: 'ACTIVE' },
      orderBy: { effectiveFrom: 'desc' },
    });
  }
}

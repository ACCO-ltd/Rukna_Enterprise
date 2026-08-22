import { Injectable } from '@nestjs/common';
import type { PrismaClient, PoReceiptException, PoReceiptExceptionStatus } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * ADR-022 CONST-DOA-004 — persistence for the PO-creator-receipt exception (request → supervisor
 * verify → CFO approve). An APPROVED row is what lets the receiver's GRN past the SoD block.
 */
@Injectable()
export class ReceiptExceptionRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<PoReceiptException | null> {
    return prisma.poReceiptException.findFirst({ where: { id, organizationId } });
  }

  listByPo(prisma: TenantPrisma, organizationId: string, purchaseOrderId: string) {
    return prisma.poReceiptException.findMany({
      where: { organizationId, purchaseOrderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(
    prisma: TenantPrisma,
    data: {
      organizationId: string;
      purchaseOrderId: string;
      receiverUserId: string;
      reason: string;
      requestedBy: string;
    },
  ) {
    return prisma.poReceiptException.create({ data });
  }

  updateStatus(
    prisma: TenantPrisma,
    id: string,
    data: Partial<{
      status: PoReceiptExceptionStatus;
      supervisorUserId: string;
      supervisorVerifiedAt: Date;
      cfoUserId: string;
      cfoApprovedAt: Date;
      rejectionReason: string;
    }>,
  ) {
    return prisma.poReceiptException.update({ where: { id }, data });
  }

  async hasApprovedException(
    prisma: TenantPrisma,
    purchaseOrderId: string,
    receiverUserId: string,
  ): Promise<boolean> {
    const count = await prisma.poReceiptException.count({
      where: { purchaseOrderId, receiverUserId, status: 'APPROVED' },
    });
    return count > 0;
  }
}

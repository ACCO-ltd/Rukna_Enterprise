import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Reads behind "what can I receive?" — OPEN purchase orders with their ACTIVE revision's lines,
 * and the PO-creator receipt exceptions
 * (ADR-022 CONST-DOA-004). No money is read here.
 */
@Injectable()
export class ReceivabilityRepository {
  findOpenWithActiveRevision(prisma: TenantPrisma, organizationId: string) {
    return prisma.purchaseOrder.findMany({
      where: { organizationId, status: 'OPEN', revisions: { some: { status: 'ACTIVE' } } },
      select: {
        id: true,
        poNumber: true,
        status: true,
        createdBy: true,
        supplier: { select: { id: true, name: true } },
        revisions: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            revisionNumber: true,
            expectedDeliveryDate: true,
            lines: {
              select: {
                id: true,
                lineNumber: true,
                description: true,
                orderedQuantity: true,
                uom: { select: { code: true, symbol: true } },
                project: { select: { id: true, code: true, name: true } },
              },
              orderBy: { lineNumber: 'asc' },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Each PO's most recent receipt exception naming `receiverUserId` (newest first). */
  findLatestExceptions(
    prisma: TenantPrisma,
    organizationId: string,
    purchaseOrderIds: string[],
    receiverUserId: string,
  ) {
    if (purchaseOrderIds.length === 0) return Promise.resolve([]);
    return prisma.poReceiptException.findMany({
      where: { organizationId, purchaseOrderId: { in: purchaseOrderIds }, receiverUserId },
      select: { id: true, purchaseOrderId: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}

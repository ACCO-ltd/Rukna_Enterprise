import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Reads behind "what can I receive?" — OPEN purchase orders with their ACTIVE revision's lines,
 * the quantity already accepted on POSTED receipts, and the PO-creator receipt exceptions
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

  /** Accepted quantity per PO line across POSTED receipts — the receiving read model's rule. */
  async acceptedByLine(prisma: TenantPrisma, purchaseOrderLineIds: string[]): Promise<Map<string, Decimal>> {
    const byLine = new Map<string, Decimal>();
    if (purchaseOrderLineIds.length === 0) return byLine;
    const lines = await prisma.goodsReceiptLine.findMany({
      where: { purchaseOrderLineId: { in: purchaseOrderLineIds }, grn: { status: 'POSTED' } },
      select: { purchaseOrderLineId: true, acceptedQuantity: true },
    });
    for (const line of lines) {
      const prev = byLine.get(line.purchaseOrderLineId) ?? new Decimal(0);
      byLine.set(line.purchaseOrderLineId, prev.add(line.acceptedQuantity as Decimal));
    }
    return byLine;
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

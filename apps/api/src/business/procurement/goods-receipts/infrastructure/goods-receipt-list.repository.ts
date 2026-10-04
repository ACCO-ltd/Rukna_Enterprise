import { Injectable } from '@nestjs/common';
import type { GrnStatus, PrismaClient } from '@prisma/client';
import { poProjectScope } from '../../purchase-orders/infrastructure/purchase-order-list.repository.js';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface GoodsReceiptListFilters {
  status?: GrnStatus;
  purchaseOrderId?: string;
  /** GRN number, delivery-note ref, PO number or supplier name (case-insensitive substring). */
  search?: string;
}

@Injectable()
export class GoodsReceiptListRepository {
  findForList(
    prisma: TenantPrisma,
    organizationId: string,
    filters: GoodsReceiptListFilters,
    accessibleProjectIds: string[] | undefined,
  ) {
    const search = filters.search?.trim();
    return prisma.goodsReceiptNote.findMany({
      where: {
        organizationId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.purchaseOrderId ? { purchaseOrderId: filters.purchaseOrderId } : {}),
        AND: [
          search
            ? {
                OR: [
                  { grnNumber: { contains: search, mode: 'insensitive' } },
                  { deliveryNoteRef: { contains: search, mode: 'insensitive' } },
                  { purchaseOrder: { poNumber: { contains: search, mode: 'insensitive' } } },
                  { supplier: { name: { contains: search, mode: 'insensitive' } } },
                ],
              }
            : {},
          accessibleProjectIds === undefined ? {} : { purchaseOrder: poProjectScope(accessibleProjectIds) },
        ],
      },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: {
            poLine: { select: { project: { select: { id: true, code: true, name: true } } } },
          },
        },
        supplier: { select: { id: true, name: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

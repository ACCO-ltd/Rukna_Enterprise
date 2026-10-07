import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient, PurchaseOrderStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface PurchaseOrderListFilters {
  status?: PurchaseOrderStatus;
  supplierId?: string;
  projectId?: string;
  /** PO number or supplier name, case-insensitive substring. */
  search?: string;
}

/**
 * Project scoping for PO reads, receiving's 'any' rule (ADR-043 review M2): an org-level PO (no
 * line coded to a project) is visible to anyone with the endpoint's permission; a project PO is
 * visible when the caller can access at least one of its projects. `undefined` = no scoping.
 */
export function poProjectScope(accessibleProjectIds: string[] | undefined): Prisma.PurchaseOrderWhereInput {
  if (accessibleProjectIds === undefined) return {};
  return {
    OR: [
      { revisions: { every: { lines: { every: { projectId: null } } } } },
      { revisions: { some: { lines: { some: { projectId: { in: accessibleProjectIds } } } } } },
    ],
  };
}

@Injectable()
export class PurchaseOrderListRepository {
  findForList(
    prisma: TenantPrisma,
    organizationId: string,
    filters: PurchaseOrderListFilters,
    accessibleProjectIds: string[] | undefined,
  ) {
    const search = filters.search?.trim();
    return prisma.purchaseOrder.findMany({
      where: {
        organizationId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
        ...(filters.projectId
          ? { revisions: { some: { lines: { some: { projectId: filters.projectId } } } } }
          : {}),
        AND: [
          search
            ? {
                OR: [
                  { poNumber: { contains: search, mode: 'insensitive' } },
                  { supplier: { name: { contains: search, mode: 'insensitive' } } },
                ],
              }
            : {},
          poProjectScope(accessibleProjectIds),
        ],
      },
      include: {
        supplier: true,
        revisions: {
          orderBy: { revisionNumber: 'desc' },
          include: {
            lines: {
              select: {
                id: true,
                orderedQuantity: true,
                unitPrice: true,
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

  /** Accepted quantity per PO line across POSTED receipts (the receiving read model's rule). */
  async acceptedByLine(prisma: TenantPrisma, purchaseOrderLineIds: string[]): Promise<Map<string, Decimal>> {
    const byLine = new Map<string, Decimal>();
    if (purchaseOrderLineIds.length === 0) return byLine;
    const rows = await prisma.goodsReceiptLine.findMany({
      where: { purchaseOrderLineId: { in: purchaseOrderLineIds }, grn: { status: 'POSTED' } },
      select: { purchaseOrderLineId: true, acceptedQuantity: true },
    });
    for (const r of rows) {
      byLine.set(r.purchaseOrderLineId, (byLine.get(r.purchaseOrderLineId) ?? new Decimal(0)).add(r.acceptedQuantity as Decimal));
    }
    return byLine;
  }
}

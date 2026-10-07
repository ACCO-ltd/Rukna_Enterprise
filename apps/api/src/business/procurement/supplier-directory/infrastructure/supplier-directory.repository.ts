import { Injectable } from '@nestjs/common';
import type { PrismaClient, SupplierStatus } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/** Reads behind the procurement supplier directory. Batched: one query per fact, no N+1. */
@Injectable()
export class SupplierDirectoryRepository {
  findSuppliers(prisma: TenantPrisma, organizationId: string, filters: { status?: SupplierStatus; search?: string }) {
    const search = filters.search?.trim();
    return prisma.supplier.findMany({
      where: {
        organizationId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        paymentTermsDays: true,
        defaultCurrency: true,
        contacts: {
          where: { isPrimary: true },
          select: { name: true, phone: true },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /** OPEN purchase orders per supplier. */
  async openOrderCounts(prisma: TenantPrisma, organizationId: string, supplierIds: string[]) {
    if (supplierIds.length === 0) return new Map<string, number>();
    const rows = await prisma.purchaseOrder.groupBy({
      by: ['supplierId'],
      where: { organizationId, supplierId: { in: supplierIds }, status: 'OPEN' },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.supplierId, r._count._all]));
  }

  /**
   * Outstanding payable per supplier and currency: the stored `outstandingAmount` of posted bills
   * (POSTED or OPENING_BALANCE) — the same population the AP subledger reconciliation sums.
   */
  async payableBalances(prisma: TenantPrisma, organizationId: string, supplierIds: string[]) {
    if (supplierIds.length === 0) return [];
    const rows = await prisma.supplierBill.groupBy({
      by: ['supplierId', 'currencyCode'],
      where: {
        organizationId,
        supplierId: { in: supplierIds },
        postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] },
      },
      _sum: { outstandingAmount: true },
    });
    return rows.map((r) => ({
      supplierId: r.supplierId,
      currencyCode: r.currencyCode,
      amount: r._sum.outstandingAmount,
    }));
  }
}

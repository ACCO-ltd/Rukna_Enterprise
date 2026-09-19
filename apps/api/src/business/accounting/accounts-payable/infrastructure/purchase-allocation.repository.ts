import { Injectable } from '@nestjs/common';
import type { PrismaClient, SupplierPaymentPurchaseAllocation } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreatePurchaseAllocationData {
  organizationId: string;
  supplierPaymentId: string;
  purchaseOrderId: string;
  allocatedAmount: Decimal;
  allocationDate: Date;
  notes?: string;
  createdBy: string;
}

@Injectable()
export class PurchaseAllocationRepository {
  create(
    prisma: TenantPrisma,
    data: CreatePurchaseAllocationData,
  ): Promise<SupplierPaymentPurchaseAllocation> {
    return prisma.supplierPaymentPurchaseAllocation.create({
      data: {
        organizationId: data.organizationId,
        supplierPaymentId: data.supplierPaymentId,
        purchaseOrderId: data.purchaseOrderId,
        allocatedAmount: data.allocatedAmount,
        allocationDate: data.allocationDate,
        notes: data.notes ?? null,
        createdBy: data.createdBy,
      },
    });
  }

  findByPayment(
    prisma: TenantPrisma,
    organizationId: string,
    supplierPaymentId: string,
  ): Promise<SupplierPaymentPurchaseAllocation[]> {
    return prisma.supplierPaymentPurchaseAllocation.findMany({
      where: { supplierPaymentId, organizationId },
      orderBy: { allocationDate: 'asc' },
    });
  }
}

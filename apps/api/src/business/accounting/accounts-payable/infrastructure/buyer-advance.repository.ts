import { Injectable } from '@nestjs/common';
import type { PrismaClient, BuyerAdvance, AdvanceReturn, BuyerAdvanceEvidenceAllocation } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateBuyerAdvanceData {
  organizationId: string;
  purchaseOrderId: string;
  recipientUserId: string;
  amount: Decimal;
  currencyCode: string;
  paymentMethod: string;
  disbursementBankAccountId: string;
  reference?: string;
  notes?: string;
  advancedAt: Date;
  createdBy: string;
}

export interface CreateAdvanceReturnData {
  organizationId: string;
  buyerAdvanceId: string;
  amount: Decimal;
  returnMethod: string;
  destinationBankAccountId?: string;
  receivedBy: string;
  receivedAt: Date;
  reference?: string;
  note?: string;
}

export interface CreateEvidenceAllocationData {
  organizationId: string;
  buyerAdvanceId: string;
  supplierBillId: string;
  allocatedAmount: Decimal;
  createdBy: string;
}

export type BuyerAdvanceWithRelations = BuyerAdvance & {
  returns: AdvanceReturn[];
  evidenceAllocations: BuyerAdvanceEvidenceAllocation[];
};

@Injectable()
export class BuyerAdvanceRepository {
  create(prisma: TenantPrisma, data: CreateBuyerAdvanceData): Promise<BuyerAdvance> {
    return prisma.buyerAdvance.create({
      data: {
        organizationId: data.organizationId,
        purchaseOrderId: data.purchaseOrderId,
        recipientUserId: data.recipientUserId,
        amount: data.amount,
        currencyCode: data.currencyCode,
        paymentMethod: data.paymentMethod as never,
        disbursementBankAccountId: data.disbursementBankAccountId,
        reference: data.reference ?? null,
        notes: data.notes ?? null,
        advancedAt: data.advancedAt,
        documentStatus: 'DRAFT',
        postingStatus: 'NOT_POSTED',
        createdBy: data.createdBy,
      },
    });
  }

  findById(
    prisma: TenantPrisma,
    organizationId: string,
    id: string,
  ): Promise<BuyerAdvanceWithRelations | null> {
    return prisma.buyerAdvance.findFirst({
      where: { id, organizationId },
      include: {
        returns: { orderBy: { receivedAt: 'asc' } },
        evidenceAllocations: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  findByPurchaseOrder(
    prisma: TenantPrisma,
    organizationId: string,
    purchaseOrderId: string,
  ): Promise<BuyerAdvanceWithRelations[]> {
    return prisma.buyerAdvance.findMany({
      where: { organizationId, purchaseOrderId },
      include: {
        returns: { orderBy: { receivedAt: 'asc' } },
        evidenceAllocations: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { advancedAt: 'asc' },
    });
  }

  createReturn(prisma: TenantPrisma, data: CreateAdvanceReturnData): Promise<AdvanceReturn> {
    return prisma.advanceReturn.create({
      data: {
        organizationId: data.organizationId,
        buyerAdvanceId: data.buyerAdvanceId,
        amount: data.amount,
        returnMethod: data.returnMethod as never,
        destinationBankAccountId: data.destinationBankAccountId ?? null,
        receivedBy: data.receivedBy,
        receivedAt: data.receivedAt,
        reference: data.reference ?? null,
        note: data.note ?? null,
      },
    });
  }

  createEvidenceAllocation(
    prisma: TenantPrisma,
    data: CreateEvidenceAllocationData,
  ): Promise<BuyerAdvanceEvidenceAllocation> {
    return prisma.buyerAdvanceEvidenceAllocation.create({
      data: {
        organizationId: data.organizationId,
        buyerAdvanceId: data.buyerAdvanceId,
        supplierBillId: data.supplierBillId,
        allocatedAmount: data.allocatedAmount,
        createdBy: data.createdBy,
      },
    });
  }
}

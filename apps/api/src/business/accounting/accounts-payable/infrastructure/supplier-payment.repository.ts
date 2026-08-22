import { Injectable } from '@nestjs/common';
import type { PrismaClient, SupplierPayment, SupplierPaymentAllocation } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateSupplierPaymentData {
  organizationId: string;
  supplierId: string;
  bankAccountId: string;
  paymentDate: Date;
  accountingDate: Date;
  currencyCode: string;
  totalAmount: Decimal;
  allocatedAmount: Decimal;
  unallocatedAmount: Decimal;
  paymentMethod: string;
  bankReference?: string;
  notes?: string;
  createdBy: string;
}

@Injectable()
export class SupplierPaymentRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.supplierPayment.findFirst({
      where: { id, organizationId },
      include: {
        allocations: { orderBy: { createdAt: 'asc' } },
        releaseSignatures: { orderBy: { signedAt: 'asc' } },
      },
    });
  }

  // ── ADR-022 CONST-DOA-005: payment release dual control ──────────────────────
  addReleaseSignature(prisma: TenantPrisma, supplierPaymentId: string, signatoryUserId: string) {
    return prisma.paymentReleaseSignature.create({ data: { supplierPaymentId, signatoryUserId } });
  }

  countReleaseSignatures(prisma: TenantPrisma, supplierPaymentId: string): Promise<number> {
    return prisma.paymentReleaseSignature.count({ where: { supplierPaymentId } });
  }

  markReleased(prisma: TenantPrisma, id: string) {
    return prisma.supplierPayment.update({ where: { id }, data: { documentStatus: 'RELEASED' } });
  }

  findAll(prisma: TenantPrisma, organizationId: string, supplierId?: string) {
    return prisma.supplierPayment.findMany({
      where: { organizationId, ...(supplierId ? { supplierId } : {}) },
      orderBy: { paymentDate: 'desc' },
    });
  }

  create(prisma: TenantPrisma, data: CreateSupplierPaymentData): Promise<SupplierPayment> {
    return prisma.supplierPayment.create({
      data: {
        organizationId: data.organizationId,
        supplierId: data.supplierId,
        bankAccountId: data.bankAccountId,
        paymentDate: data.paymentDate,
        accountingDate: data.accountingDate,
        currencyCode: data.currencyCode,
        totalAmount: data.totalAmount,
        allocatedAmount: data.allocatedAmount,
        unallocatedAmount: data.unallocatedAmount,
        paymentMethod: data.paymentMethod,
        bankReference: data.bankReference ?? null,
        notes: data.notes ?? null,
        documentStatus: 'DRAFT',
        postingStatus: 'NOT_POSTED',
        createdBy: data.createdBy,
      },
    });
  }

  approve(prisma: TenantPrisma, id: string, approvedBy: string) {
    return prisma.supplierPayment.update({
      where: { id },
      data: { documentStatus: 'APPROVED', approvedBy, approvedAt: new Date() },
    });
  }

  markPosted(
    prisma: TenantPrisma,
    id: string,
    journalEntryId: string,
    paymentNumber: string,
    postedBy: string,
  ) {
    return prisma.supplierPayment.update({
      where: { id },
      data: {
        postingStatus: 'POSTED',
        postedJournalEntryId: journalEntryId,
        paymentNumber,
        postedAt: new Date(),
        postedBy,
      },
    });
  }

  markPostingFailed(prisma: TenantPrisma, id: string, errorCode: string) {
    return prisma.supplierPayment.update({
      where: { id },
      data: { postingStatus: 'FAILED', lastPostingAttemptAt: new Date(), lastPostingErrorCode: errorCode },
    });
  }

  updateAllocations(
    prisma: TenantPrisma,
    id: string,
    allocatedAmount: Decimal,
    unallocatedAmount: Decimal,
  ) {
    return prisma.supplierPayment.update({
      where: { id },
      data: { allocatedAmount, unallocatedAmount },
    });
  }

  createAllocation(
    prisma: TenantPrisma,
    data: {
      organizationId: string;
      supplierPaymentId: string;
      supplierBillId: string;
      allocatedAmount: Decimal;
      allocationDate: Date;
      journalEntryId?: string;
      postingStatus: string;
      createdBy: string;
    },
  ): Promise<SupplierPaymentAllocation> {
    return prisma.supplierPaymentAllocation.create({
      data: {
        organizationId: data.organizationId,
        supplierPaymentId: data.supplierPaymentId,
        supplierBillId: data.supplierBillId,
        allocatedAmount: data.allocatedAmount,
        allocationDate: data.allocationDate,
        journalEntryId: data.journalEntryId ?? null,
        postingStatus: data.postingStatus as never,
        createdBy: data.createdBy,
      },
    });
  }
}

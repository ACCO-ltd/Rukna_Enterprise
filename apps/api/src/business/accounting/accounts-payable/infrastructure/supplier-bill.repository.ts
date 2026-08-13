import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateSupplierBillData {
  organizationId: string;
  supplierId: string;
  supplierInvoiceNumber: string;
  billDate: Date;
  dueDate: Date;
  currencyCode: string;
  exchangeRateSnapshot: Decimal;
  exchangeRateDate: Date;
  exchangeRateSource: string;
  purchaseOrderId?: string;
  purchaseOrderRevisionId?: string;
  projectId?: string;
  departmentId?: string;
  subtotal: Decimal;
  vatAmount: Decimal;
  totalAmount: Decimal;
  createdBy: string;
  lines: {
    lineNumber: number;
    description: string;
    quantity?: Decimal;
    unitPrice?: Decimal;
    netAmount: Decimal;
    vatAmount: Decimal;
    grossAmount: Decimal;
    expenseProfileCode: string;
    projectId?: string;
    departmentId?: string;
    costCenterId?: string;
    boqNodeId?: string;
  }[];
}

@Injectable()
export class SupplierBillRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.supplierBill.findFirst({
      where: { id, organizationId },
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
        supplier: { select: { id: true, code: true, name: true } },
      },
    });
  }

  findAll(prisma: TenantPrisma, organizationId: string, supplierId?: string) {
    return prisma.supplierBill.findMany({
      where: { organizationId, ...(supplierId ? { supplierId } : {}) },
      include: { supplier: { select: { id: true, code: true, name: true } } },
      orderBy: { billDate: 'desc' },
    });
  }

  async create(prisma: TenantPrisma, data: CreateSupplierBillData) {
    const norm = data.supplierInvoiceNumber.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return prisma.supplierBill.create({
      data: {
        organizationId: data.organizationId,
        supplierId: data.supplierId,
        supplierInvoiceNumber: data.supplierInvoiceNumber,
        supplierInvoiceNumberNorm: norm,
        billDate: data.billDate,
        dueDate: data.dueDate,
        currencyCode: data.currencyCode,
        exchangeRateSnapshot: data.exchangeRateSnapshot,
        exchangeRateDate: data.exchangeRateDate,
        exchangeRateSource: data.exchangeRateSource,
        purchaseOrderId: data.purchaseOrderId ?? null,
        purchaseOrderRevisionId: data.purchaseOrderRevisionId ?? null,
        projectId: data.projectId ?? null,
        departmentId: data.departmentId ?? null,
        subtotal: data.subtotal,
        vatAmount: data.vatAmount,
        totalAmount: data.totalAmount,
        outstandingAmount: data.totalAmount,
        documentStatus: 'DRAFT',
        postingStatus: 'NOT_POSTED',
        createdBy: data.createdBy,
        lines: { create: data.lines },
      },
      include: { lines: true },
    });
  }

  approve(prisma: TenantPrisma, id: string, approvedBy: string) {
    return prisma.supplierBill.update({
      where: { id },
      data: { documentStatus: 'APPROVED', approvedBy, approvedAt: new Date() },
    });
  }

  markPosted(
    prisma: TenantPrisma,
    id: string,
    journalEntryId: string,
    billNumber: string,
    postedBy: string,
  ) {
    return prisma.supplierBill.update({
      where: { id },
      data: {
        postingStatus: 'POSTED',
        postedJournalEntryId: journalEntryId,
        billNumber,
        postedAt: new Date(),
        postedBy,
      },
    });
  }

  markPostingFailed(prisma: TenantPrisma, id: string, errorCode: string) {
    return prisma.supplierBill.update({
      where: { id },
      data: { postingStatus: 'FAILED', lastPostingAttemptAt: new Date(), lastPostingErrorCode: errorCode },
    });
  }

  updateOutstandingAmount(prisma: TenantPrisma, id: string, outstandingAmount: Decimal) {
    return prisma.supplierBill.update({ where: { id }, data: { outstandingAmount } });
  }
}

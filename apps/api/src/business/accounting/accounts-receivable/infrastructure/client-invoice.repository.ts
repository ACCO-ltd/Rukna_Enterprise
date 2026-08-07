import { Injectable } from '@nestjs/common';
import type { PrismaClient, ClientInvoice } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface CreateClientInvoiceData {
  organizationId: string;
  clientId: string;
  sourceIpcId?: string | null;
  projectId?: string;
  contractId?: string;
  invoiceDate: Date;
  dueDate: Date;
  currencyCode: string;
  exchangeRateSnapshot: Decimal;
  exchangeRateDate: Date;
  exchangeRateSource: string;
  subtotal: Decimal;
  vatAmount: Decimal;
  totalAmount: Decimal;
  paymentTerms?: string;
  billingAddressSnapshot: object;
  createdBy: string;
}

@Injectable()
export class ClientInvoiceRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<ClientInvoice | null> {
    return prisma.clientInvoice.findFirst({ where: { id, organizationId } });
  }

  findByIpc(prisma: TenantPrisma, organizationId: string, ipcId: string): Promise<ClientInvoice | null> {
    return prisma.clientInvoice.findFirst({ where: { sourceIpcId: ipcId, organizationId } });
  }

  findAll(prisma: TenantPrisma, organizationId: string, clientId?: string) {
    return prisma.clientInvoice.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      orderBy: { invoiceDate: 'desc' },
    });
  }

  findUnpostedApproved(prisma: TenantPrisma, organizationId: string) {
    return prisma.clientInvoice.findMany({
      where: { organizationId, documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED' },
    });
  }

  create(prisma: TenantPrisma, data: CreateClientInvoiceData): Promise<ClientInvoice> {
    return prisma.clientInvoice.create({
      data: {
        organizationId: data.organizationId,
        clientId: data.clientId,
        sourceIpcId: data.sourceIpcId,
        projectId: data.projectId ?? null,
        contractId: data.contractId ?? null,
        invoiceDate: data.invoiceDate,
        dueDate: data.dueDate,
        currencyCode: data.currencyCode,
        exchangeRateSnapshot: data.exchangeRateSnapshot,
        exchangeRateDate: data.exchangeRateDate,
        exchangeRateSource: data.exchangeRateSource,
        subtotal: data.subtotal,
        vatAmount: data.vatAmount,
        totalAmount: data.totalAmount,
        outstandingAmount: data.totalAmount,
        paymentTerms: data.paymentTerms ?? null,
        billingAddressSnapshot: data.billingAddressSnapshot,
        documentStatus: 'DRAFT',
        postingStatus: 'NOT_POSTED',
        createdBy: data.createdBy,
      },
    });
  }

  markPosted(
    prisma: TenantPrisma,
    id: string,
    journalEntryId: string,
    invoiceNumber: string,
    postedBy: string,
  ) {
    return prisma.clientInvoice.update({
      where: { id },
      data: {
        postingStatus: 'POSTED',
        postedJournalEntryId: journalEntryId,
        invoiceNumber,
        postedAt: new Date(),
        postedBy,
      },
    });
  }

  markPostingFailed(prisma: TenantPrisma, id: string, errorCode: string) {
    return prisma.clientInvoice.update({
      where: { id },
      data: {
        postingStatus: 'FAILED',
        lastPostingAttemptAt: new Date(),
        lastPostingErrorCode: errorCode,
      },
    });
  }

  approve(prisma: TenantPrisma, id: string, approvedBy: string) {
    return prisma.clientInvoice.update({
      where: { id },
      data: { documentStatus: 'APPROVED', approvedBy, approvedAt: new Date() },
    });
  }

  updateOutstandingAmount(prisma: TenantPrisma, id: string, outstandingAmount: Decimal) {
    return prisma.clientInvoice.update({ where: { id }, data: { outstandingAmount } });
  }
}

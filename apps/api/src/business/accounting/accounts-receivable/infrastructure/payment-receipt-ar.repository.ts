import { Injectable } from '@nestjs/common';
import type { PrismaClient, PaymentReceipt, ClientReceiptAllocation } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class PaymentReceiptArRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<PaymentReceipt | null> {
    return prisma.paymentReceipt.findFirst({ where: { id, organizationId } });
  }

  findAll(prisma: TenantPrisma, organizationId: string, clientId?: string) {
    return prisma.paymentReceipt.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      orderBy: { receiptDate: 'desc' },
    });
  }

  markPosted(
    prisma: TenantPrisma,
    id: string,
    journalEntryId: string,
    postedBy: string,
    allocatedAmount: Decimal,
    unallocatedAmount: Decimal,
  ) {
    return prisma.paymentReceipt.update({
      where: { id },
      data: {
        postingStatus: 'POSTED',
        postedJournalEntryId: journalEntryId,
        postedAt: new Date(),
        postedBy,
        documentStatus: 'APPROVED',
        allocatedAmount,
        unallocatedAmount,
      },
    });
  }

  updateAllocations(
    prisma: TenantPrisma,
    id: string,
    allocatedAmount: Decimal,
    unallocatedAmount: Decimal,
  ) {
    return prisma.paymentReceipt.update({
      where: { id },
      data: { allocatedAmount, unallocatedAmount },
    });
  }

  createAllocation(
    prisma: TenantPrisma,
    data: {
      organizationId: string;
      paymentReceiptId: string;
      clientInvoiceId: string;
      allocatedAmount: Decimal;
      allocationDate: Date;
      journalEntryId?: string;
      postingStatus: string;
      createdBy: string;
    },
  ): Promise<ClientReceiptAllocation> {
    return prisma.clientReceiptAllocation.create({
      data: {
        organizationId: data.organizationId,
        paymentReceiptId: data.paymentReceiptId,
        clientInvoiceId: data.clientInvoiceId,
        allocatedAmount: data.allocatedAmount,
        allocationDate: data.allocationDate,
        journalEntryId: data.journalEntryId ?? null,
        postingStatus: data.postingStatus as never,
        createdBy: data.createdBy,
      },
    });
  }

  findAllocationsByReceipt(prisma: TenantPrisma, paymentReceiptId: string) {
    return prisma.clientReceiptAllocation.findMany({
      where: { paymentReceiptId, postingStatus: { in: ['POSTED', 'NOT_POSTED'] } },
    });
  }

  getTotalAllocatedToInvoice(prisma: TenantPrisma, clientInvoiceId: string): Promise<Decimal> {
    return prisma.clientReceiptAllocation
      .aggregate({
        where: { clientInvoiceId, postingStatus: { in: ['POSTED'] } },
        _sum: { allocatedAmount: true },
      })
      .then((r) => new Decimal(r._sum.allocatedAmount?.toString() ?? '0'));
  }
}

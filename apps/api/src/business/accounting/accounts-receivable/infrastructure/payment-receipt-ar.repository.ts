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

  /**
   * All allocations on a receipt for the receipt workspace (ACC-SET-001 FE-1) — including
   * REVERSED ones, which the panel renders struck-through as an audit trail rather than
   * silently dropping. Balances are unaffected: they are tracked on the receipt row, and the
   * applied total excludes reversed allocations. Newest first.
   */
  findAllocationsByReceipt(prisma: TenantPrisma, paymentReceiptId: string) {
    return prisma.clientReceiptAllocation.findMany({
      where: { paymentReceiptId },
      orderBy: { createdAt: 'desc' },
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

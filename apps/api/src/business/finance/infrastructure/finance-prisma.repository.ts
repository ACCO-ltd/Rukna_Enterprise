import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { PrismaClient, PaymentReceipt } from '@prisma/client';

export type ReceiptFull = PaymentReceipt & {
  allocations: import('@prisma/client').ReceiptAllocation[];
};

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class FinancePrismaRepository {
  findAll(prisma: TenantPrisma, organizationId: string, clientId?: string) {
    return prisma.paymentReceipt.findMany({
      where: { organizationId, ...(clientId ? { clientId } : {}) },
      orderBy: { receiptDate: 'desc' },
    });
  }

  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<ReceiptFull | null> {
    return prisma.paymentReceipt.findFirst({
      where: { id, organizationId },
      include: { allocations: { orderBy: { allocatedAt: 'desc' } } },
    }) as Promise<ReceiptFull | null>;
  }

  create(
    prisma: TenantPrisma,
    data: {
      organizationId: string;
      clientId: string;
      receiptDate: Date;
      accountingDate: Date;
      totalAmount: string;
      currencyCode: string;
      reference?: string;
      notes?: string;
      createdBy: string;
    },
  ) {
    // A receipt is fully unallocated when recorded: unallocatedAmount = totalAmount,
    // allocatedAmount = 0. The schema invariant is totalAmount = allocatedAmount +
    // unallocatedAmount (always), and unallocatedAmount has no default — omitting it
    // (the previous `data as never` path) made every POST /receipts fail at the DB.
    return prisma.paymentReceipt.create({
      data: {
        organizationId: data.organizationId,
        clientId: data.clientId,
        receiptDate: data.receiptDate,
        accountingDate: data.accountingDate,
        totalAmount: new Decimal(data.totalAmount),
        allocatedAmount: new Decimal(0),
        unallocatedAmount: new Decimal(data.totalAmount),
        currencyCode: data.currencyCode,
        reference: data.reference ?? null,
        notes: data.notes ?? null,
        createdBy: data.createdBy,
      },
    });
  }

  // Returns the sum of all allocated amounts for a receipt as a Decimal string.
  getTotalAllocated(prisma: TenantPrisma, receiptId: string): Promise<string> {
    return prisma.receiptAllocation
      .aggregate({ where: { receiptId }, _sum: { allocatedAmount: true } })
      .then((r) => new Decimal(r._sum.allocatedAmount?.toString() ?? '0').toFixed(2));
  }

  addAllocation(
    prisma: TenantPrisma,
    data: {
      receiptId: string;
      certificateId: string;
      allocatedAmount: string;
      allocatedBy: string;
    },
  ) {
    return prisma.receiptAllocation.create({ data: data as never });
  }

  findAllocation(prisma: TenantPrisma, allocationId: string) {
    return prisma.receiptAllocation.findUnique({ where: { id: allocationId } });
  }

  removeAllocation(prisma: TenantPrisma, allocationId: string) {
    return prisma.receiptAllocation.delete({ where: { id: allocationId } });
  }

  // Derives payment state for a certificate from its allocations.
  // Compares allocations against net certified (gross minus deductions) not gross total.
  async getCertificatePaymentSummary(
    prisma: TenantPrisma,
    certificateId: string,
  ): Promise<{ totalAllocated: string; netCertified: string; status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' }> {
    const [cert, alloc] = await Promise.all([
      prisma.interimPaymentCertificate.findUnique({
        where: { id: certificateId },
        select: {
          items: { select: { certifiedAmount: true } },
          deductions: { select: { amount: true } },
        },
      }),
      prisma.receiptAllocation.aggregate({
        where: { certificateId },
        _sum: { allocatedAmount: true },
      }),
    ]);

    const netCertified = (cert?.items ?? [])
      .reduce((s, i) => s.plus(new Decimal(i.certifiedAmount.toString())), new Decimal(0))
      .minus(
        (cert?.deductions ?? []).reduce(
          (s, d) => s.plus(new Decimal(d.amount.toString())),
          new Decimal(0),
        ),
      );

    const totalAllocated = new Decimal(alloc._sum.allocatedAmount?.toString() ?? '0');

    let status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
    if (totalAllocated.greaterThanOrEqualTo(netCertified) && netCertified.greaterThan(0)) {
      status = 'PAID';
    } else if (totalAllocated.greaterThan(0)) {
      status = 'PARTIALLY_PAID';
    }

    return {
      totalAllocated: totalAllocated.toFixed(2),
      netCertified: netCertified.toFixed(2),
      status,
    };
  }
}

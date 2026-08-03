import { Injectable } from '@nestjs/common';
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
      amount: string;
      currency: string;
      exchangeRate?: string;
      reference?: string;
      notes?: string;
      createdBy: string;
    },
  ) {
    return prisma.paymentReceipt.create({ data: data as never });
  }

  // Returns the sum of all allocated amounts for a receipt.
  getTotalAllocated(prisma: TenantPrisma, receiptId: string): Promise<number> {
    return prisma.receiptAllocation
      .aggregate({ where: { receiptId }, _sum: { allocatedAmount: true } })
      .then((r) => Number(r._sum.allocatedAmount ?? 0));
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
  async getCertificatePaymentSummary(
    prisma: TenantPrisma,
    certificateId: string,
  ): Promise<{ totalAllocated: number; status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' }> {
    const [cert, alloc] = await Promise.all([
      prisma.interimPaymentCertificate.findUnique({
        where: { id: certificateId },
        select: { certifiedTotal: true },
      }),
      prisma.receiptAllocation.aggregate({
        where: { certificateId },
        _sum: { allocatedAmount: true },
      }),
    ]);

    const certTotal = Number(cert?.certifiedTotal ?? 0);
    const totalAllocated = Number(alloc._sum.allocatedAmount ?? 0);

    let status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
    if (totalAllocated >= certTotal) status = 'PAID';
    else if (totalAllocated > 0) status = 'PARTIALLY_PAID';

    return { totalAllocated, status };
  }
}

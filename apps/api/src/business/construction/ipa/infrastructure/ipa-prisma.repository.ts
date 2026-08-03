import { Injectable } from '@nestjs/common';
import type { PrismaClient, InterimPaymentApplication } from '@prisma/client';

export type IpaFull = InterimPaymentApplication & {
  items: import('@prisma/client').InterimPaymentApplicationItem[];
  deductions: import('@prisma/client').InterimPaymentApplicationDeduction[];
  attachments: import('@prisma/client').IpaAttachment[];
};

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class IpaPrismaRepository {
  findAll(prisma: TenantPrisma, organizationId: string, contractId?: string) {
    return prisma.interimPaymentApplication.findMany({
      where: { organizationId, ...(contractId ? { contractId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<IpaFull | null> {
    return prisma.interimPaymentApplication.findFirst({
      where: { id, organizationId },
      include: { items: true, deductions: true, attachments: true },
    }) as Promise<IpaFull | null>;
  }

  create(
    prisma: TenantPrisma,
    data: {
      contractId: string;
      organizationId: string;
      periodFrom?: Date;
      periodTo?: Date;
      exchangeRateCurrency?: string;
      exchangeRateBase?: string;
      exchangeRateValue?: string;
      exchangeRateDate?: Date;
      notes?: string;
      createdBy: string;
    },
  ) {
    return prisma.interimPaymentApplication.create({ data: data as never });
  }

  update(
    prisma: TenantPrisma,
    id: string,
    data: Partial<{
      status: string;
      applicationNumber: number;
      applicationRef: string;
      periodFrom: Date;
      periodTo: Date;
      submittedAt: Date;
      submittedBy: string;
      notes: string;
    }>,
  ) {
    return prisma.interimPaymentApplication.update({ where: { id }, data: data as never });
  }

  getNextApplicationNumber(prisma: TenantPrisma, contractId: string): Promise<number> {
    return prisma.interimPaymentApplication
      .aggregate({ where: { contractId }, _max: { applicationNumber: true } })
      .then((r) => (r._max.applicationNumber ?? 0) + 1);
  }

  getLastEffectiveCertifiedQty(
    prisma: TenantPrisma,
    contractId: string,
    boqNodeId: string,
  ): Promise<number> {
    // Finds the certified quantity from the most recent effective IPC for this contract+node.
    return prisma.interimPaymentCertificateItem
      .findFirst({
        where: {
          certificate: { application: { contractId }, isEffective: true },
          applicationItem: { boqNodeId },
        },
        orderBy: { certificate: { createdAt: 'desc' } },
        select: { certifiedQuantity: true },
      })
      .then((r) => Number(r?.certifiedQuantity ?? 0));
  }

  addItem(
    prisma: TenantPrisma,
    applicationId: string,
    data: {
      boqNodeId: string;
      measurementMethodSnapshot: string;
      unitRateSnapshot: string;
      currencySnapshot: string;
      cumulativeClaimed: string;
      previousEffectiveCertified: string;
      periodQuantity: string;
      periodAmount: string;
    },
  ) {
    return prisma.interimPaymentApplicationItem.create({
      data: { applicationId, ...data } as never,
    });
  }

  removeItem(prisma: TenantPrisma, itemId: string) {
    return prisma.interimPaymentApplicationItem.delete({ where: { id: itemId } });
  }

  addDeduction(
    prisma: TenantPrisma,
    applicationId: string,
    data: {
      deductionType: string;
      sourceTermId?: string;
      rate?: string;
      basis: string;
      amount: string;
    },
  ) {
    return prisma.interimPaymentApplicationDeduction.create({
      data: { applicationId, ...data } as never,
    });
  }

  removeDeduction(prisma: TenantPrisma, deductionId: string) {
    return prisma.interimPaymentApplicationDeduction.delete({ where: { id: deductionId } });
  }
}

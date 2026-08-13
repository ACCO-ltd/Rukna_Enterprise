import { Injectable } from '@nestjs/common';
import type { PrismaClient, InterimPaymentCertificate } from '@prisma/client';

export type IpcFull = InterimPaymentCertificate & {
  items: import('@prisma/client').InterimPaymentCertificateItem[];
  deductions: import('@prisma/client').InterimPaymentCertificateDeduction[];
  attachments: import('@prisma/client').IpcAttachment[];
};

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class IpcPrismaRepository {
  findAll(
    prisma: TenantPrisma,
    organizationId: string,
    applicationId?: string,
    projectId?: string,
    userId?: string,
  ) {
    return prisma.interimPaymentCertificate.findMany({
      where: {
        organizationId,
        ...(applicationId ? { applicationId } : {}),
        ...(projectId
          ? { application: { contract: { projectId } } }
          : userId
            ? {
                application: {
                  contract: { project: { members: { some: { userId, removedAt: null } } } },
                },
              }
            : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<IpcFull | null> {
    return prisma.interimPaymentCertificate.findFirst({
      where: { id, organizationId },
      include: { items: true, deductions: true, attachments: true },
    }) as Promise<IpcFull | null>;
  }

  findEffectiveByApplication(prisma: TenantPrisma, applicationId: string) {
    return prisma.interimPaymentCertificate.findFirst({
      where: { applicationId, isEffective: true },
    });
  }

  getNextCertificateNumber(prisma: TenantPrisma, applicationId: string): Promise<number> {
    return prisma.interimPaymentCertificate
      .aggregate({ where: { applicationId }, _max: { certificateNumber: true } })
      .then((r) => (r._max.certificateNumber ?? 0) + 1);
  }

  create(
    prisma: TenantPrisma,
    data: {
      applicationId: string;
      organizationId: string;
      certificateNumber: number;
      certificateRef?: string;
      status: string;
      isEffective: boolean;
      effectiveAt?: Date;
      certifiedTotal: string;
      currency: string;
      exchangeRateCurrency?: string;
      exchangeRateBase?: string;
      exchangeRateValue?: string;
      exchangeRateDate?: Date;
      issuedAt?: Date;
      issuedBy?: string;
      notes?: string;
      createdBy: string;
    },
  ) {
    return prisma.interimPaymentCertificate.create({ data: data as never });
  }

  addItem(
    prisma: TenantPrisma,
    certificateId: string,
    data: {
      applicationItemId: string;
      certifiedQuantity: string;
      certifiedAmount: string;
      varianceQuantity: string;
      varianceReason?: string;
    },
  ) {
    return prisma.interimPaymentCertificateItem.create({
      data: { certificateId, ...data } as never,
    });
  }

  addDeduction(
    prisma: TenantPrisma,
    certificateId: string,
    data: {
      deductionType: string;
      sourceTermId?: string;
      rate?: string;
      basis: string;
      amount: string;
    },
  ) {
    return prisma.interimPaymentCertificateDeduction.create({
      data: { certificateId, ...data } as never,
    });
  }

  // Atomic supersession: old cert → not effective, new cert → effective.
  async supersede(
    prisma: TenantPrisma,
    currentEffectiveId: string,
    newCertId: string,
    reason: string,
    supersededBy: string,
  ) {
    const now = new Date();
    await prisma.interimPaymentCertificate.update({
      where: { id: currentEffectiveId },
      data: {
        isEffective: false,
        supersededAt: now,
        supersededById: newCertId,
        supersessionReason: reason,
      } as never,
    });
    return prisma.interimPaymentCertificate.update({
      where: { id: newCertId },
      data: { isEffective: true, effectiveAt: now, issuedAt: now, issuedBy: supersededBy } as never,
    });
  }
}

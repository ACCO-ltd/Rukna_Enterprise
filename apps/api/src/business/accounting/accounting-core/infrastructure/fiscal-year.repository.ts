import { Injectable } from '@nestjs/common';
import type { PrismaClient, FiscalYear, AccountingPeriod, PeriodType, PeriodStatus } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export type FiscalYearWithPeriods = FiscalYear & { periods: AccountingPeriod[] };

@Injectable()
export class FiscalYearRepository {
  findByName(prisma: TenantPrisma, organizationId: string, name: string) {
    return prisma.fiscalYear.findUnique({
      where: { organizationId_name: { organizationId, name } },
    });
  }

  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<FiscalYearWithPeriods | null> {
    return prisma.fiscalYear.findFirst({
      where: { id, organizationId },
      include: { periods: { orderBy: { periodNumber: 'asc' } } },
    }) as Promise<FiscalYearWithPeriods | null>;
  }

  findAll(prisma: TenantPrisma, organizationId: string): Promise<FiscalYearWithPeriods[]> {
    return prisma.fiscalYear.findMany({
      where: { organizationId },
      include: { periods: { orderBy: { periodNumber: 'asc' } } },
      orderBy: { startDate: 'desc' },
    }) as Promise<FiscalYearWithPeriods[]>;
  }

  createWithPeriods(
    prisma: TenantPrisma,
    data: {
      organizationId: string;
      name: string;
      startDate: Date;
      endDate: Date;
      retainedEarningsAccountId: string;
      createdBy: string;
      periods: Array<{
        organizationId: string;
        periodNumber: number;
        name: string;
        startDate: Date;
        endDate: Date;
        periodType: PeriodType;
        status: PeriodStatus;
      }>;
    },
  ): Promise<FiscalYearWithPeriods> {
    return prisma.fiscalYear.create({
      data: {
        organizationId: data.organizationId,
        name: data.name,
        startDate: data.startDate,
        endDate: data.endDate,
        retainedEarningsAccountId: data.retainedEarningsAccountId,
        createdBy: data.createdBy,
        periods: { create: data.periods },
      },
      include: { periods: { orderBy: { periodNumber: 'asc' } } },
    }) as Promise<FiscalYearWithPeriods>;
  }

  findPeriodById(prisma: TenantPrisma, organizationId: string, periodId: string) {
    return prisma.accountingPeriod.findFirst({
      where: { id: periodId, organizationId },
    });
  }

  findPeriodCovering(prisma: TenantPrisma, organizationId: string, date: Date) {
    return prisma.accountingPeriod.findFirst({
      where: {
        organizationId,
        startDate: { lte: date },
        endDate: { gte: date },
      },
    });
  }
}

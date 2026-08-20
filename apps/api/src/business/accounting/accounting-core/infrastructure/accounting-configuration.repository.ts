import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class AccountingConfigurationRepository {
  getFiscalCalendarPolicy(prisma: TenantPrisma, organizationId: string) {
    return prisma.fiscalCalendarPolicy.findUnique({ where: { organizationId } });
  }

  getTaxPolicy(prisma: TenantPrisma, organizationId: string) {
    return prisma.taxPolicy.findUnique({ where: { organizationId } });
  }

  getNumberingPolicy(prisma: TenantPrisma, organizationId: string) {
    return prisma.numberingPolicy.findUnique({ where: { organizationId } });
  }

  getPostingPolicy(prisma: TenantPrisma, organizationId: string) {
    return prisma.postingPolicy.findUnique({ where: { organizationId } });
  }

  getDimensionPolicy(prisma: TenantPrisma, organizationId: string) {
    return prisma.dimensionPolicy.findUnique({ where: { organizationId } });
  }

  getBankingPolicy(prisma: TenantPrisma, organizationId: string) {
    return prisma.bankingPolicy.findUnique({ where: { organizationId } });
  }

  upsertFiscalCalendarPolicy(
    prisma: TenantPrisma,
    organizationId: string,
    data: {
      fiscalYearStartMonth: number;
      fiscalYearStartDay: number;
      useAdjustmentPeriods: boolean;
      updatedBy: string;
    },
  ) {
    return prisma.fiscalCalendarPolicy.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
  }

  upsertTaxPolicy(
    prisma: TenantPrisma,
    organizationId: string,
    data: {
      defaultOutputTaxCodeId?: string | null;
      defaultInputTaxCodeId?: string | null;
      updatedBy: string;
    },
  ) {
    return prisma.taxPolicy.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
  }

  upsertNumberingPolicy(
    prisma: TenantPrisma,
    organizationId: string,
    data: { numberingScope: 'CONTINUOUS' | 'RESET_ANNUALLY'; updatedBy: string },
  ) {
    return prisma.numberingPolicy.upsert({
      where: { organizationId },
      create: { organizationId, numberingScope: data.numberingScope as never, updatedBy: data.updatedBy },
      update: { numberingScope: data.numberingScope as never, updatedBy: data.updatedBy },
    });
  }

  upsertPostingPolicy(
    prisma: TenantPrisma,
    organizationId: string,
    data: {
      requireFourEyesOnJournals: boolean;
      draftJournalsBlockPeriodClose: boolean;
      enforceControlAccountAtDb: boolean;
      updatedBy: string;
    },
  ) {
    return prisma.postingPolicy.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
  }

  upsertDimensionPolicy(
    prisma: TenantPrisma,
    organizationId: string,
    data: {
      projectDimensionDefault: string;
      departmentDimensionDefault: string;
      costCenterDimensionDefault: string;
      updatedBy: string;
    },
  ) {
    return prisma.dimensionPolicy.upsert({
      where: { organizationId },
      create: { organizationId, ...data } as never,
      update: { ...data } as never,
    });
  }

  upsertBankingPolicy(
    prisma: TenantPrisma,
    organizationId: string,
    data: {
      requireBankAccountForReceipts: boolean;
      requireBankAccountForPayments: boolean;
      requireBankReviewBeforeClose: boolean;
      updatedBy: string;
    },
  ) {
    return prisma.bankingPolicy.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
  }
}

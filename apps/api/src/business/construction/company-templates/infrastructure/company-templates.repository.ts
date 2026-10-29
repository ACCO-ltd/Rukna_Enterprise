import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** The two template columns on the organization row. NULL = the platform default is in force. */
@Injectable()
export class CompanyTemplatesRepository {
  find(prisma: TenantPrisma, organizationId: string) {
    return prisma.organization.findUnique({
      where: { id: organizationId },
      select: { paymentPlanTemplate: true, scheduleTemplate: true },
    });
  }

  setPaymentPlan(prisma: TenantPrisma, organizationId: string, value: Prisma.InputJsonValue | null) {
    return prisma.organization.update({
      where: { id: organizationId },
      data: { paymentPlanTemplate: value ?? Prisma.DbNull },
      select: { id: true },
    });
  }

  setSchedule(prisma: TenantPrisma, organizationId: string, value: Prisma.InputJsonValue | null) {
    return prisma.organization.update({
      where: { id: organizationId },
      data: { scheduleTemplate: value ?? Prisma.DbNull },
      select: { id: true },
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { PrismaClient, Prisma } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class ProgrammeRepository {
  createMilestone(prisma: TenantPrisma, data: Prisma.ProgrammeMilestoneUncheckedCreateInput) {
    return prisma.programmeMilestone.create({ data });
  }

  findMilestones(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.programmeMilestone.findMany({
      where: { organizationId, projectId },
      orderBy: [{ sortOrder: 'asc' }, { baselineDate: 'asc' }],
    });
  }

  findMilestoneById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.programmeMilestone.findFirst({ where: { id, organizationId } });
  }

  verifyMilestone(prisma: TenantPrisma, id: string, actualDate: Date, verifiedBy: string) {
    return prisma.programmeMilestone.update({
      where: { id },
      data: { status: 'VERIFIED', actualDate, verifiedBy, verifiedAt: new Date() },
    });
  }
}

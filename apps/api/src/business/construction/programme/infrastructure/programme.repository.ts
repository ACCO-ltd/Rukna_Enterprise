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
      // Master Schedule P2 — the payment installments this milestone RELEASES, one query. Only the
      // read-side fields the release projection needs: identity, percentage/trigger, the parent
      // contract's value + currency (to derive the amount), and whether an invoice was generated.
      include: {
        installments: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            percentage: true,
            triggerType: true,
            contract: { select: { contractValue: true, currency: true } },
            clientInvoice: { select: { id: true } },
          },
        },
      },
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

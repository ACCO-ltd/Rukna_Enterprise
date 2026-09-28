import type { PrismaClient } from '@prisma/client';

/**
 * Strict CONST-COM-011 (2026-09-28): a work-completion (`MILESTONE`) stage bills only when linked
 * to a programme milestone verified on site. Fixtures that exercise billing mechanics — packages,
 * variations, reconciliation — rather than the evidence gate itself call this once after creating
 * their stages, so every unlinked MILESTONE stage on the contract gets a real VERIFIED milestone,
 * exactly as it would need in production.
 */
export async function linkVerifiedMilestones(prisma: PrismaClient, contractId: string): Promise<void> {
  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    select: { organizationId: true, projectId: true },
  });
  const stages = await prisma.contractPaymentInstallment.findMany({
    where: { contractId, triggerType: 'MILESTONE', programmeMilestoneId: null },
    select: { id: true, name: true, sortOrder: true },
  });
  for (const stage of stages) {
    const milestone = await prisma.programmeMilestone.create({
      data: {
        organizationId: contract.organizationId,
        projectId: contract.projectId,
        code: `VM-${stage.id.slice(-8)}`,
        name: stage.name,
        status: 'VERIFIED',
        baselineDate: new Date('2026-01-01'),
        actualDate: new Date('2026-01-01'),
        verifiedAt: new Date('2026-01-01'),
        verifiedBy: 'fixture',
        createdBy: 'fixture',
      },
    });
    await prisma.contractPaymentInstallment.update({
      where: { id: stage.id },
      data: { programmeMilestoneId: milestone.id },
    });
  }
}

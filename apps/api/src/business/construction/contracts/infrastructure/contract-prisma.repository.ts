import { Injectable } from '@nestjs/common';
import type { PrismaClient, Contract, ContractGuarantee } from '@prisma/client';

export type ContractFull = Contract & {
  retentionTerms: import('@prisma/client').ContractRetentionTerms | null;
  advanceTerms: import('@prisma/client').ContractAdvanceTerm[];
  guarantees: (ContractGuarantee & {
    attachments: import('@prisma/client').GuaranteeAttachment[];
  })[];
  milestones: import('@prisma/client').ContractMilestone[];
  attachments: import('@prisma/client').ContractAttachment[];
  client: { id: string; name: string; taxNumber: string | null };
};

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

@Injectable()
export class ContractPrismaRepository {
  findAll(prisma: TenantPrisma, organizationId: string, projectId?: string) {
    return prisma.contract.findMany({
      where: {
        organizationId,
        ...(projectId ? { projectId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<ContractFull | null> {
    return prisma.contract.findFirst({
      where: { id, organizationId },
      include: {
        retentionTerms: true,
        advanceTerms: true,
        guarantees: { include: { attachments: true } },
        milestones: { orderBy: { sortOrder: 'asc' } },
        attachments: true,
        client: { select: { id: true, name: true, taxNumber: true } },
      },
    }) as Promise<ContractFull | null>;
  }

  findByNumber(prisma: TenantPrisma, organizationId: string, contractNumber: string) {
    return prisma.contract.findUnique({
      where: { organizationId_contractNumber: { organizationId, contractNumber } },
    });
  }

  findActiveByProject(prisma: TenantPrisma, projectId: string) {
    return prisma.contract.findMany({
      where: { projectId, status: 'ACTIVE' },
    });
  }

  create(
    prisma: TenantPrisma,
    data: {
      projectId: string;
      organizationId: string;
      clientId: string;
      boqVersionId: string;
      contractNumber: string;
      contractValue: string;
      currency: string;
      billingModel?: string;
      startDate?: Date;
      expectedEndDate?: Date;
      createdBy: string;
    },
  ) {
    return prisma.contract.create({
      data: {
        projectId: data.projectId,
        organizationId: data.organizationId,
        clientId: data.clientId,
        boqVersionId: data.boqVersionId,
        contractNumber: data.contractNumber,
        contractValue: data.contractValue,
        currency: data.currency,
        billingModel: (data.billingModel ?? 'MEASURED_IPC') as never,
        startDate: data.startDate,
        expectedEndDate: data.expectedEndDate,
        createdBy: data.createdBy,
      },
    });
  }

  update(prisma: TenantPrisma, id: string, data: Partial<{
    contractNumber: string;
    contractValue: string;
    currency: string;
    billingModel: string;
    startDate: Date;
    expectedEndDate: Date;
    status: string;
    clientNameSnapshot: string;
    clientTaxSnapshot: string;
  }>) {
    return prisma.contract.update({
      where: { id },
      data: data as never,
    });
  }

  upsertRetentionTerms(
    prisma: TenantPrisma,
    contractId: string,
    data: {
      retentionRate: string;
      retentionCap: string;
      retentionSplitOnPc: string;
      retentionReleasedAt?: Date;
    },
  ) {
    return prisma.contractRetentionTerms.upsert({
      where: { contractId },
      create: {
        contractId,
        retentionRate: data.retentionRate,
        retentionCap: data.retentionCap,
        retentionSplitOnPC: data.retentionSplitOnPc,
        retentionReleasedAt: data.retentionReleasedAt,
      },
      update: {
        retentionRate: data.retentionRate,
        retentionCap: data.retentionCap,
        retentionSplitOnPC: data.retentionSplitOnPc,
        retentionReleasedAt: data.retentionReleasedAt,
      },
    });
  }

  addAdvanceTerm(
    prisma: TenantPrisma,
    contractId: string,
    data: {
      advanceType: string;
      description?: string;
      amount?: string;
      percentage?: string;
      recoveryRate: string;
    },
  ) {
    return prisma.contractAdvanceTerm.create({
      data: {
        contractId,
        advanceType: data.advanceType as never,
        description: data.description,
        amount: data.amount,
        percentage: data.percentage,
        recoveryRate: data.recoveryRate,
      },
    });
  }

  removeAdvanceTerm(prisma: TenantPrisma, termId: string) {
    return prisma.contractAdvanceTerm.delete({ where: { id: termId } });
  }

  addGuarantee(
    prisma: TenantPrisma,
    contractId: string,
    data: {
      guaranteeType: string;
      amount: string;
      currency: string;
      issuer: string;
      beneficiary: string;
      issueDate: Date;
      expiryDate: Date;
      notes?: string;
    },
  ) {
    return prisma.contractGuarantee.create({
      data: { contractId, ...data },
    });
  }

  updateGuarantee(
    prisma: TenantPrisma,
    guaranteeId: string,
    data: { status?: string; notes?: string },
  ) {
    return prisma.contractGuarantee.update({
      where: { id: guaranteeId },
      data: data as never,
    });
  }

  addMilestone(
    prisma: TenantPrisma,
    contractId: string,
    data: {
      name: string;
      description?: string;
      dueDate?: Date;
      sortOrder?: number;
    },
  ) {
    return prisma.contractMilestone.create({
      data: { contractId, ...data, sortOrder: data.sortOrder ?? 0 },
    });
  }

  completeMilestone(
    prisma: TenantPrisma,
    milestoneId: string,
    completedBy: string,
  ) {
    return prisma.contractMilestone.update({
      where: { id: milestoneId },
      data: { completedAt: new Date(), completedBy },
    });
  }

  moveActiveContractsToFinalAccount(prisma: TenantPrisma, projectId: string) {
    return prisma.contract.updateMany({
      where: { projectId, status: 'ACTIVE' },
      data: { status: 'FINAL_ACCOUNT_PENDING' },
    });
  }
}

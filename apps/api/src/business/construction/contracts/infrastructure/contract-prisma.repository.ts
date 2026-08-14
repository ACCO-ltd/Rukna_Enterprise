import { Injectable } from '@nestjs/common';
import type { PrismaClient, Contract, ContractGuarantee, ContractKind } from '@prisma/client';

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
  findAll(prisma: TenantPrisma, organizationId: string, projectId?: string, userId?: string) {
    return prisma.contract.findMany({
      where: {
        organizationId,
        ...(projectId ? { projectId } : {}),
        ...(userId ? { project: { members: { some: { userId, removedAt: null } } } } : {}),
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

  /**
   * Returns the current/effective CLIENT_CONTRACT for a project, or null if none exists.
   * "Effective" means not yet CLOSED, CANCELLED, or TERMINATED.
   * Called inside a transaction so the check and the subsequent insert are atomic.
   */
  findEffectiveClientContract(
    prisma: TenantPrisma,
    projectId: string,
  ): Promise<{ id: string; contractNumber: string } | null> {
    return prisma.contract.findFirst({
      where: {
        projectId,
        contractKind: 'CLIENT_CONTRACT',
        status: { notIn: ['CLOSED', 'CANCELLED', 'TERMINATED'] as never[] },
      },
      select: { id: true, contractNumber: true },
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
      contractKind?: ContractKind;
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
        contractKind: data.contractKind ?? 'CLIENT_CONTRACT',
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

  /** Scoped read — the security guard for CONST-COM-002 (organizationId + contractId + childId). */
  findAdvanceTermOwned(prisma: TenantPrisma, contractId: string, termId: string) {
    return prisma.contractAdvanceTerm.findFirst({ where: { id: termId, contractId } });
  }

  /** Scoped delete: only removes the term if it belongs to `contractId`. Returns { count }. */
  removeAdvanceTerm(prisma: TenantPrisma, contractId: string, termId: string) {
    return prisma.contractAdvanceTerm.deleteMany({ where: { id: termId, contractId } });
  }

  addGuarantee(
    prisma: TenantPrisma,
    contractId: string,
    data: {
      guaranteeType: string;
      reference?: string;
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

  /** Scoped read — the security guard for CONST-COM-002. */
  findGuaranteeOwned(prisma: TenantPrisma, contractId: string, guaranteeId: string) {
    return prisma.contractGuarantee.findFirst({ where: { id: guaranteeId, contractId } });
  }

  /** Scoped update: only mutates the guarantee if it belongs to `contractId`. Returns { count }. */
  updateGuarantee(
    prisma: TenantPrisma,
    contractId: string,
    guaranteeId: string,
    data: { status?: string; notes?: string },
  ) {
    return prisma.contractGuarantee.updateMany({
      where: { id: guaranteeId, contractId },
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

  /** Scoped read — the security guard for CONST-COM-002. */
  findMilestoneOwned(prisma: TenantPrisma, contractId: string, milestoneId: string) {
    return prisma.contractMilestone.findFirst({ where: { id: milestoneId, contractId } });
  }

  /** Scoped completion: only mutates the milestone if it belongs to `contractId`. Returns { count }. */
  completeMilestone(
    prisma: TenantPrisma,
    contractId: string,
    milestoneId: string,
    completedBy: string,
  ) {
    return prisma.contractMilestone.updateMany({
      where: { id: milestoneId, contractId },
      data: { completedAt: new Date(), completedBy },
    });
  }

  findGuaranteeById(prisma: TenantPrisma, guaranteeId: string) {
    return prisma.contractGuarantee.findUnique({ where: { id: guaranteeId } });
  }

  findMilestoneById(prisma: TenantPrisma, milestoneId: string) {
    return prisma.contractMilestone.findUnique({ where: { id: milestoneId } });
  }

  moveActiveContractsToFinalAccount(prisma: TenantPrisma, projectId: string) {
    return prisma.contract.updateMany({
      where: { projectId, status: 'ACTIVE' },
      data: { status: 'FINAL_ACCOUNT_PENDING' },
    });
  }
}

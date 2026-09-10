import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient, Contract, ContractGuarantee, ContractKind, PaymentTrigger } from '@prisma/client';

export type ContractFull = Contract & {
  retentionTerms: import('@prisma/client').ContractRetentionTerms | null;
  advanceTerms: import('@prisma/client').ContractAdvanceTerm[];
  guarantees: (ContractGuarantee & {
    attachments: import('@prisma/client').GuaranteeAttachment[];
  })[];
  milestones: import('@prisma/client').ContractMilestone[];
  attachments: import('@prisma/client').ContractAttachment[];
  paymentInstallments: import('@prisma/client').ContractPaymentInstallment[];
  client: { id: string; name: string; taxNumber: string | null };
};

// ADR-023: structural input for a payment installment (mirrors PaymentInstallmentDto without a
// presentation-layer import). `percentage` is a fraction (0..1).
export interface PaymentInstallmentInput {
  sortOrder: number;
  name: string;
  percentage: number;
  triggerType: PaymentTrigger;
  dueOffsetDays?: number;
  dueDate?: string;
  milestoneLabel?: string;
}

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
        paymentInstallments: { orderBy: { sortOrder: 'asc' } },
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
      // ADR-029 CONST-BOQ-032 / T-2 — base value frozen at creation; drives the milestone % schedule.
      baseContractValue: string;
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
        baseContractValue: data.baseContractValue,
        currency: data.currency,
        billingModel: (data.billingModel ?? 'MEASURED_IPC') as never,
        contractKind: data.contractKind ?? 'CLIENT_CONTRACT',
        startDate: data.startDate,
        expectedEndDate: data.expectedEndDate,
        createdBy: data.createdBy,
      },
    });
  }

  // ADR-023: write a contract's payment schedule. Called inside the create transaction.
  createPaymentInstallments(
    prisma: TenantPrisma,
    contractId: string,
    installments: PaymentInstallmentInput[],
  ) {
    return prisma.contractPaymentInstallment.createMany({
      data: installments.map((i) => ({
        contractId,
        sortOrder: i.sortOrder,
        name: i.name,
        percentage: i.percentage,
        triggerType: i.triggerType,
        dueOffsetDays: i.dueOffsetDays ?? null,
        dueDate: i.dueDate ? new Date(i.dueDate) : null,
        milestoneLabel: i.milestoneLabel ?? null,
      })),
    });
  }

  findInstallmentInContract(prisma: TenantPrisma, contractId: string, installmentId: string) {
    return prisma.contractPaymentInstallment.findFirst({
      where: { id: installmentId, contractId },
      select: { id: true },
    });
  }

  findProjectMilestone(prisma: TenantPrisma, projectId: string, milestoneId: string) {
    return prisma.programmeMilestone.findFirst({
      where: { id: milestoneId, projectId },
      select: { id: true },
    });
  }

  setInstallmentMilestone(
    prisma: TenantPrisma,
    installmentId: string,
    programmeMilestoneId: string | null,
  ) {
    return prisma.contractPaymentInstallment.update({
      where: { id: installmentId },
      data: { programmeMilestoneId },
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

  /**
   * ADR-029 T-3 / V-2 — the contract's frozen base + current value, org-scoped, for the variation
   * raise. Only the two money columns + currency are needed to compute the new current value and to
   * guard tenancy; nothing else is read into the adopt transaction.
   */
  findValueForRaise(prisma: TenantPrisma, organizationId: string, contractId: string) {
    return prisma.contract.findFirst({
      where: { id: contractId, organizationId },
      select: {
        id: true,
        projectId: true,
        contractValue: true,
        baseContractValue: true,
        currency: true,
      },
    });
  }

  /**
   * ADR-029 T-3 / V-2 — set the current `contractValue` to `newContractValue` (base + Σ adopted
   * on-contract variations). Writes ONLY `contractValue`; `baseContractValue` stays frozen (T-2).
   * Runs inside the caller's adopt transaction so the raise commits with the BOQ append + snapshot.
   */
  raiseCurrentContractValue(
    prisma: Prisma.TransactionClient,
    contractId: string,
    newContractValue: string,
  ) {
    return prisma.contract.update({
      where: { id: contractId },
      data: { contractValue: newContractValue },
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

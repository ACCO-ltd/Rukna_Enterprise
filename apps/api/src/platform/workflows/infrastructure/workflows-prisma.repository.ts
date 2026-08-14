import { Injectable } from '@nestjs/common';
import { TenancyService } from '../../tenancy/tenancy.service.js';
import { WorkflowTransactionType } from '@erp/types';

@Injectable()
export class WorkflowsPrismaRepository {
  constructor(private readonly tenancyService: TenancyService) {}

  async findDefinitionByType(organizationId: string, transactionType: WorkflowTransactionType) {
    const prisma = this.tenancyService.getClient();
    return prisma.workflowDefinition.findFirst({
      where: { organizationId, transactionType, isActive: true },
      include: { conditions: true, steps: { orderBy: { stepOrder: 'asc' } } },
    });
  }

  async findDefinitionById(id: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.workflowDefinition.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
  }

  /**
   * Every trigger binding visible to an organization — its own plus the tenant-defaults
   * (organizationId = null) — with the definition (and its steps) each one routes to. This is
   * the read model behind the governance-configuration view: what is wired, and what is active.
   */
  async findBindingsForOrg(organizationId: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.workflowTriggerBinding.findMany({
      where: { OR: [{ organizationId }, { organizationId: null }] },
      include: { definition: { include: { steps: { orderBy: { stepOrder: 'asc' } } } } },
      orderBy: [{ entityType: 'asc' }, { priority: 'desc' }],
    });
  }

  async createInstance(data: {
    workflowDefinitionId: string;
    transactionType: WorkflowTransactionType | null;
    transactionId: string;
    initiatedBy: string;
  }) {
    const prisma = this.tenancyService.getClient();
    return prisma.approvalInstance.create({ data: { ...data, currentStepOrder: 1 } });
  }

  /** Most recent approval instance for a given transaction (loop-back lookup, ADR-015). */
  async findLatestInstanceForTransaction(
    transactionType: WorkflowTransactionType | null,
    transactionId: string,
  ) {
    const prisma = this.tenancyService.getClient();
    return prisma.approvalInstance.findFirst({
      where: { transactionId, transactionType },
      orderBy: { initiatedAt: 'desc' },
    });
  }

  /**
   * Marks an approval instance as consumed once its entity transition has been driven
   * through (ADR-015). There is no dedicated CONSUMED enum value yet — that needs a
   * Prisma client regen — so CANCELLED is the terminal "closed" state. The approver audit
   * trail lives in ApprovalAction rows, which are left intact.
   */
  async markInstanceConsumed(id: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.approvalInstance.update({
      where: { id },
      data: { status: 'CANCELLED' as never },
    });
  }

  async findInstanceById(id: string, organizationId?: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.approvalInstance.findFirst({
      where: { id, ...(organizationId ? { definition: { organizationId } } : {}) },
      include: { definition: { include: { steps: { orderBy: { stepOrder: 'asc' } } } }, actions: true },
    });
  }

  async updateInstanceStep(id: string, nextStepOrder: number, status: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.approvalInstance.update({
      where: { id },
      data: { currentStepOrder: nextStepOrder, status: status as never },
    });
  }

  async recordAction(data: {
    instanceId: string;
    stepOrder: number;
    action: string;
    actorId: string;
    notes?: string;
  }) {
    const prisma = this.tenancyService.getClient();
    return prisma.approvalAction.create({ data: data as never });
  }
}

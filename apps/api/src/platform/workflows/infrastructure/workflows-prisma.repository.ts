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

  async createInstance(data: {
    workflowDefinitionId: string;
    transactionType: WorkflowTransactionType;
    transactionId: string;
    initiatedBy: string;
  }) {
    const prisma = this.tenancyService.getClient();
    return prisma.approvalInstance.create({ data: { ...data, currentStepOrder: 1 } });
  }

  async findInstanceById(id: string) {
    const prisma = this.tenancyService.getClient();
    return prisma.approvalInstance.findUnique({
      where: { id },
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

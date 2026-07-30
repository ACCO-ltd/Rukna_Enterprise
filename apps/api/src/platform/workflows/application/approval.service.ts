import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { WorkflowTransactionType } from '@erp/types';
import { WorkflowsPrismaRepository } from '../infrastructure/workflows-prisma.repository.js';
import { WorkflowsService } from './workflows.service.js';

@Injectable()
export class ApprovalService {
  constructor(
    private readonly repo: WorkflowsPrismaRepository,
    private readonly workflowsService: WorkflowsService,
  ) {}

  async initiate(
    organizationId: string,
    transactionType: WorkflowTransactionType,
    transactionId: string,
    initiatorId: string,
  ) {
    const definition = await this.workflowsService.getDefinitionForTransaction(
      organizationId,
      transactionType,
    );

    return this.repo.createInstance({
      workflowDefinitionId: definition.id,
      transactionType,
      transactionId,
      initiatedBy: initiatorId,
    });
  }

  async approve(instanceId: string, actorId: string, notes?: string) {
    const instance = await this.repo.findInstanceById(instanceId);
    if (!instance) throw new NotFoundException(`Approval instance not found: ${instanceId}`);
    if (instance.status !== 'PENDING') {
      throw new BadRequestException(`Instance is not pending (current status: ${instance.status})`);
    }

    await this.repo.recordAction({
      instanceId,
      stepOrder: instance.currentStepOrder,
      action: 'APPROVE',
      actorId,
      notes,
    });

    const steps = instance.definition.steps;
    const nextStep = steps.find((s) => s.stepOrder === instance.currentStepOrder + 1);

    if (nextStep) {
      await this.repo.updateInstanceStep(instanceId, nextStep.stepOrder, 'PENDING');
    } else {
      await this.repo.updateInstanceStep(instanceId, instance.currentStepOrder, 'APPROVED');
    }
  }

  async reject(instanceId: string, actorId: string, notes?: string) {
    const instance = await this.repo.findInstanceById(instanceId);
    if (!instance) throw new NotFoundException(`Approval instance not found: ${instanceId}`);
    if (instance.status !== 'PENDING') {
      throw new BadRequestException(`Instance is not pending (current status: ${instance.status})`);
    }

    await this.repo.recordAction({
      instanceId,
      stepOrder: instance.currentStepOrder,
      action: 'REJECT',
      actorId,
      notes,
    });

    await this.repo.updateInstanceStep(instanceId, instance.currentStepOrder, 'REJECTED');
  }

  async getCurrentStep(instanceId: string) {
    const instance = await this.repo.findInstanceById(instanceId);
    if (!instance) throw new NotFoundException(`Approval instance not found: ${instanceId}`);
    return instance.definition.steps.find((s) => s.stepOrder === instance.currentStepOrder) ?? null;
  }

  async isFullyApproved(instanceId: string): Promise<boolean> {
    const instance = await this.repo.findInstanceById(instanceId);
    if (!instance) throw new NotFoundException(`Approval instance not found: ${instanceId}`);
    return instance.status === 'APPROVED';
  }
}

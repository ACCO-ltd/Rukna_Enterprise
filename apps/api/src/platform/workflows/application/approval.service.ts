import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { WorkflowTransactionType } from '@erp/types';
import { WorkflowsPrismaRepository } from '../infrastructure/workflows-prisma.repository.js';
import { WorkflowsService } from './workflows.service.js';
import { SegregationOfDutiesService } from './segregation-of-duties.service.js';

// ADR-022 CONST-DOA-001: the System Administrator role has no business-transaction approval
// authority. This is the consolidated role name (see ACCO_ROLES); the tenant super-user 'ADMIN'
// is a different role and is not blocked here.
const SYSTEM_ADMINISTRATOR_ROLE = 'SYSTEM_ADMINISTRATOR';

@Injectable()
export class ApprovalService {
  constructor(
    private readonly repo: WorkflowsPrismaRepository,
    private readonly workflowsService: WorkflowsService,
    private readonly sod: SegregationOfDutiesService,
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

  async approve(instanceId: string, actorId: string, actorRoles: string[], organizationId: string, notes?: string) {
    const instance = await this.repo.findInstanceById(instanceId, organizationId);
    if (!instance) throw new NotFoundException(`Approval instance not found: ${instanceId}`);
    if (instance.status !== 'PENDING') {
      throw new BadRequestException(`Instance is not pending (current status: ${instance.status})`);
    }

    const currentStep = instance.definition.steps.find((s) => s.stepOrder === instance.currentStepOrder);
    if (currentStep?.roleRequired && !actorRoles.includes(currentStep.roleRequired)) {
      throw new ForbiddenException(`Step requires role '${currentStep.roleRequired}'`);
    }

    // ADR-022 CONST-DOA-003: a system administrator cannot approve a business transaction.
    await this.sod.assertAllowed({
      organizationId,
      action: 'APPROVE_BUSINESS_TRANSACTION',
      actorUserId: actorId,
      isSystemAdministrator: actorRoles.includes(SYSTEM_ADMINISTRATOR_ROLE),
    });

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

  async reject(instanceId: string, actorId: string, actorRoles: string[], organizationId: string, notes?: string) {
    const instance = await this.repo.findInstanceById(instanceId, organizationId);
    if (!instance) throw new NotFoundException(`Approval instance not found: ${instanceId}`);
    if (instance.status !== 'PENDING') {
      throw new BadRequestException(`Instance is not pending (current status: ${instance.status})`);
    }

    const currentStep = instance.definition.steps.find((s) => s.stepOrder === instance.currentStepOrder);
    if (currentStep?.roleRequired && !actorRoles.includes(currentStep.roleRequired)) {
      throw new ForbiddenException(`Step requires role '${currentStep.roleRequired}'`);
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

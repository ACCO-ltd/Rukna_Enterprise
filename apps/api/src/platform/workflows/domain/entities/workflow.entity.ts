import { WorkflowTransactionType, ApprovalStatus, ApprovalActionType } from '@erp/types';

export class WorkflowDefinitionEntity {
  constructor(
    public readonly id: string,
    public readonly organizationId: string,
    public readonly transactionType: WorkflowTransactionType,
    public readonly name: string,
    public readonly isActive: boolean,
    public readonly requiresCeoConfirmation: boolean,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}

export class WorkflowStepEntity {
  constructor(
    public readonly id: string,
    public readonly definitionId: string,
    public readonly stepOrder: number,
    public readonly groupOrder: number | null,
    public readonly roleRequired: string,
    public readonly isOptional: boolean,
    public readonly escalateAfterHours: number | null,
    public readonly notifyRoles: string[],
  ) {}
}

export class ApprovalInstanceEntity {
  constructor(
    public readonly id: string,
    public readonly workflowDefinitionId: string,
    public readonly transactionType: WorkflowTransactionType,
    public readonly transactionId: string,
    public readonly status: ApprovalStatus,
    public readonly currentStepOrder: number,
    public readonly initiatedBy: string,
    public readonly initiatedAt: Date,
  ) {}
}

export class ApprovalActionEntity {
  constructor(
    public readonly id: string,
    public readonly instanceId: string,
    public readonly stepOrder: number,
    public readonly action: ApprovalActionType,
    public readonly actorId: string,
    public readonly actedAt: Date,
    public readonly notes: string | null,
  ) {}
}

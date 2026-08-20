import { WorkflowTransactionType } from '@erp/types';

export { WorkflowTransactionType };

export interface WorkflowCondition {
  id: string;
  definitionId: string;
  field: string;
  operator: string;
  value: string;
  currencyCode: string | null;
}

export interface WorkflowStep {
  id: string;
  definitionId: string;
  stepOrder: number;
  groupOrder: number | null;
  roleRequired: string;
  isOptional: boolean;
  escalateAfterHours: number | null;
  notifyRoles: string[];
}

export type WorkflowTriggerKind = 'STATE_TRANSITION' | 'DOCUMENT';

/**
 * `GET /workflows/bindings` — one governance trigger binding with the definition it routes to.
 * `organizationId === null` marks a tenant default rather than an org-specific binding.
 */
export interface WorkflowTriggerBinding {
  id: string;
  organizationId: string | null;
  triggerKind: WorkflowTriggerKind;
  entityType: string;
  transactionType: WorkflowTransactionType | null;
  fromState: string | null;
  toState: string | null;
  workflowDefinitionId: string;
  priority: number;
  isActive: boolean;
  definition: WorkflowDefinition;
}

/** `GET /workflows/definition/:transactionType` */
export interface WorkflowDefinition {
  id: string;
  organizationId: string;
  transactionType: WorkflowTransactionType | null;
  name: string;
  isActive: boolean;
  requiresCeoConfirmation: boolean;
  createdAt: string;
  updatedAt: string;
  conditions: WorkflowCondition[];
  steps: WorkflowStep[];
}

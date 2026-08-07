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

/** `GET /workflows/definition/:transactionType` */
export interface WorkflowDefinition {
  id: string;
  organizationId: string;
  transactionType: WorkflowTransactionType | null;
  name: string;
  nameAr: string;
  isActive: boolean;
  requiresCeoConfirmation: boolean;
  createdAt: string;
  updatedAt: string;
  conditions: WorkflowCondition[];
  steps: WorkflowStep[];
}

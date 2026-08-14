import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkflowTransactionType } from '@erp/types';
import { WorkflowsPrismaRepository } from '../infrastructure/workflows-prisma.repository.js';

@Injectable()
export class WorkflowsService {
  constructor(private readonly repo: WorkflowsPrismaRepository) {}

  async getDefinitionForTransaction(organizationId: string, transactionType: WorkflowTransactionType) {
    const definition = await this.repo.findDefinitionByType(organizationId, transactionType);
    if (!definition) {
      throw new NotFoundException(
        `No active workflow definition for transaction type: ${transactionType}`,
      );
    }
    return definition;
  }

  async getStepsForDefinition(definitionId: string) {
    const definition = await this.repo.findDefinitionById(definitionId);
    if (!definition) throw new NotFoundException(`Workflow definition not found: ${definitionId}`);
    return definition.steps;
  }

  /**
   * The governance configuration an organization is subject to: every trigger binding (its own
   * plus tenant-defaults) with the definition it routes to. Read-only — activation stays a
   * deliberate act, not a UI toggle, until ACCO confirms the policy (ADR-007).
   */
  async listBindings(organizationId: string) {
    return this.repo.findBindingsForOrg(organizationId);
  }
}

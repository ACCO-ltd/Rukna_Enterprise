import { Injectable, ConflictException } from '@nestjs/common';
import type { RequestIdentity, GovernedEntity, WorkflowTransactionType } from '@erp/types';
import { WorkflowTriggerResolverService } from './workflow-trigger-resolver.service.js';
import { WorkflowsPrismaRepository } from '../infrastructure/workflows-prisma.repository.js';

export interface GovernanceGate {
  gated: true;
  approvalInstanceId: string;
}

/**
 * Single seam for command-level governance checks on state transitions.
 *
 * Callers do not import WorkflowTriggerResolverService directly — this service
 * owns the resolver call AND the approval-instance creation so the business
 * mutation never proceeds while an approval is pending.
 *
 * Returns null → transition may proceed immediately.
 * Returns GovernanceGate → approval instance created; caller must stop and
 *   surface the approvalInstanceId to the client.
 */
@Injectable()
export class CommandGovernanceService {
  constructor(
    private readonly triggerResolver: WorkflowTriggerResolverService,
    private readonly repo: WorkflowsPrismaRepository,
  ) {}

  async gateStateTransition(
    identity: RequestIdentity,
    entityType: GovernedEntity,
    fromState: string,
    toState: string,
    resourceId: string,
  ): Promise<null | GovernanceGate> {
    const binding = await this.triggerResolver.resolveForStateTransition(
      identity.activeOrganizationId,
      entityType,
      fromState,
      toState,
    );

    if (!binding) return null;

    const transactionType = (binding.definition.transactionType as WorkflowTransactionType) ?? null;

    // Loop-back (ADR-015, mechanism "re-drive"): reconcile against any prior approval for
    // this resource before opening a new one.
    const existing = await this.repo.findLatestInstanceForTransaction(transactionType, resourceId);

    if (existing?.status === 'APPROVED') {
      // Approval is complete. Consume it (single-use) and let the transition proceed.
      await this.repo.markInstanceConsumed(existing.id);
      return null;
    }

    if (existing?.status === 'PENDING') {
      // Already awaiting approval — return the same instance rather than a duplicate.
      return { gated: true, approvalInstanceId: existing.id };
    }

    // No prior instance, or a terminal (REJECTED/CANCELLED/consumed) one — open a fresh approval.
    const instance = await this.repo.createInstance({
      workflowDefinitionId: binding.workflowDefinitionId,
      transactionType,
      transactionId: resourceId,
      initiatedBy: identity.userId,
    });

    return { gated: true, approvalInstanceId: instance.id };
  }
}

/**
 * Throws ConflictException(409) when a transition is gated by governance.
 * Convenience wrapper: most services call this and return normally when null,
 * or surface the 409 body to the client when gated.
 */
export function throwIfGated(gate: GovernanceGate | null, message: string): asserts gate is null {
  if (gate) {
    throw new ConflictException({ message, approvalInstanceId: gate.approvalInstanceId });
  }
}

import { Injectable, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity, GovernedEntity, WorkflowTransactionType } from '@erp/types';
import { WorkflowTriggerResolverService } from './workflow-trigger-resolver.service.js';
import { WorkflowsPrismaRepository } from '../infrastructure/workflows-prisma.repository.js';

export interface GovernanceGate {
  gated: true;
  approvalInstanceId: string;
}

/** What the gate decided, plus the approval it consumed when a re-drive proceeds. */
export interface GovernanceOutcome {
  gate: GovernanceGate | null;
  consumedApproval: { instanceId: string; finalApproverId: string | null } | null;
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
    // ADR-022 CONST-DOA-005: the document's value, so the resolver can pick the amount band's
    // chain. Omitted by amount-less commands, which then only ever match catch-all bindings.
    amount: Decimal | null = null,
  ): Promise<null | GovernanceGate> {
    const outcome = await this.evaluateStateTransition(
      identity,
      entityType,
      fromState,
      toState,
      resourceId,
      amount,
    );
    return outcome.gate;
  }

  /**
   * Same gate as {@link gateStateTransition}, but also reports the approval it consumed (if any),
   * so a command that records "who approved" on its document can name the real final approver
   * rather than the user who re-drove the transition (ADR-015 re-drive).
   */
  async evaluateStateTransition(
    identity: RequestIdentity,
    entityType: GovernedEntity,
    fromState: string,
    toState: string,
    resourceId: string,
    amount: Decimal | null = null,
  ): Promise<GovernanceOutcome> {
    const binding = await this.triggerResolver.resolveForStateTransition(
      identity.activeOrganizationId,
      entityType,
      fromState,
      toState,
      amount,
    );

    if (!binding) return { gate: null, consumedApproval: null };

    const transactionType = (binding.definition.transactionType as WorkflowTransactionType) ?? null;

    // Loop-back (ADR-015, mechanism "re-drive"): reconcile against any prior approval for
    // this resource before opening a new one.
    const existing = await this.repo.findLatestInstanceForTransaction(transactionType, resourceId);

    if (existing?.status === 'APPROVED') {
      // Approval is complete. Consume it (single-use) and let the transition proceed.
      await this.repo.markInstanceConsumed(existing.id);
      const finalApproverId = await this.repo.findFinalApproverId(existing.id);
      return { gate: null, consumedApproval: { instanceId: existing.id, finalApproverId } };
    }

    if (existing?.status === 'PENDING') {
      // Already awaiting approval — return the same instance rather than a duplicate.
      return { gate: { gated: true, approvalInstanceId: existing.id }, consumedApproval: null };
    }

    // No prior instance, or a terminal (REJECTED/CANCELLED/consumed) one — open a fresh approval.
    // Snapshot why this chain was selected: the evaluated amount and the band that matched. The
    // snapshot is immutable evidence even if the binding's band is re-tuned later (ADR-007).
    const banded = binding.minAmount !== null || binding.maxAmount !== null;
    const instance = await this.repo.createInstance({
      workflowDefinitionId: binding.workflowDefinitionId,
      transactionType,
      transactionId: resourceId,
      initiatedBy: identity.userId,
      evaluatedAmount: amount,
      matchedPolicyId: binding.id,
      conditionSnapshot: {
        bindingId: binding.id,
        entityType,
        fromState,
        toState,
        priority: binding.priority,
        banded,
        minAmount: binding.minAmount ? (binding.minAmount as Decimal).toString() : null,
        maxAmount: binding.maxAmount ? (binding.maxAmount as Decimal).toString() : null,
        evaluatedAmount: amount ? amount.toString() : null,
      },
    });

    return { gate: { gated: true, approvalInstanceId: instance.id }, consumedApproval: null };
  }

  /**
   * The state of the latest approval raised for a document, for commands that must respect it:
   * `PENDING` (approvers are deciding), `APPROVED` (granted, not yet consumed by the gated
   * transition), or `null` (none open). A consumed approval is CANCELLED and counts as none.
   */
  async openApprovalState(
    transactionType: WorkflowTransactionType,
    resourceId: string,
  ): Promise<'PENDING' | 'APPROVED' | null> {
    const latest = await this.repo.findLatestInstanceForTransaction(transactionType, resourceId);
    if (latest?.status === 'PENDING' || latest?.status === 'APPROVED') return latest.status;
    return null;
  }

  /**
   * The latest approval for a document with its chain and recorded actions (null when none) —
   * read-only. ADR-044 §6: the award command vets every approver before the instance is consumed.
   */
  async latestApproval(transactionType: WorkflowTransactionType, resourceId: string) {
    const instance = await this.repo.findLatestInstanceWithChain(transactionType, resourceId);
    if (!instance) return null;
    const steps = instance.definition.steps;
    return {
      id: instance.id,
      status: instance.status,
      currentStepOrder: instance.currentStepOrder,
      currentStepRole: steps.find((s) => s.stepOrder === instance.currentStepOrder)?.roleRequired ?? null,
      steps,
      actions: instance.actions,
    };
  }

  /**
   * For each document with a PENDING approval, the role its current step requires — batched, for
   * "waiting on me" queues (ADR-044 §12 `decide`).
   */
  async pendingStepRoles(transactionType: WorkflowTransactionType, resourceIds: string[]): Promise<Map<string, string>> {
    const instances = await this.repo.findPendingInstancesFor(transactionType, resourceIds);
    const roles = new Map<string, string>();
    for (const instance of instances) {
      const step = instance.definition.steps.find((s) => s.stepOrder === instance.currentStepOrder);
      if (step) roles.set(instance.transactionId, step.roleRequired);
    }
    return roles;
  }

  /**
   * Voids a granted-but-unused approval, so a document edited after approval must be approved
   * again: an approval covers the content the approvers saw, not whatever the document later
   * becomes. Marks it consumed (CANCELLED), exactly as the gate does when it uses one.
   */
  async voidUnconsumedApproval(transactionType: WorkflowTransactionType, resourceId: string): Promise<void> {
    const latest = await this.repo.findLatestInstanceForTransaction(transactionType, resourceId);
    if (latest?.status === 'APPROVED') await this.repo.markInstanceConsumed(latest.id);
  }

  /**
   * Closes whatever approval is still open for a document that will never transition — PENDING
   * (approvers would otherwise decide on a dead document) or APPROVED-but-unused. Used when the
   * document itself is cancelled. Same terminal state as a consumed approval (CANCELLED).
   */
  async voidOpenApproval(transactionType: WorkflowTransactionType, resourceId: string): Promise<void> {
    const latest = await this.repo.findLatestInstanceForTransaction(transactionType, resourceId);
    if (latest?.status === 'PENDING' || latest?.status === 'APPROVED') {
      await this.repo.markInstanceConsumed(latest.id);
    }
  }
}

/**
 * Throws ConflictException(409) when a transition is gated by governance.
 * Convenience wrapper: most services call this and return normally when null,
 * or surface the 409 body to the client when gated.
 */
export function throwIfGated(gate: GovernanceGate | null, message: string): asserts gate is null {
  if (gate) {
    // `approvalInstanceId` goes under `details` so GlobalExceptionFilter forwards it — the filter
    // only propagates message/errorCode/details, so a top-level field would be dropped and the
    // client could not find the instance to drive (ADR-011/015 loop-back).
    throw new ConflictException({
      message,
      details: { approvalInstanceId: gate.approvalInstanceId },
    });
  }
}

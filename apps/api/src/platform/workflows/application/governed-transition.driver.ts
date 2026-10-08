import type { Decimal } from '@prisma/client/runtime/library';
import type { GovernedEntity, RequestIdentity, WorkflowTransactionType } from '@erp/types';

import type { CommandGovernanceService } from './command-governance.service.js';
import type { ApprovalService } from './approval.service.js';

/** Bound on self-approved steps in one call (a chain is never longer than a handful of steps). */
const MAX_SELF_STEPS = 10;

export type LatestApproval = NonNullable<Awaited<ReturnType<CommandGovernanceService['latestApproval']>>>;

export interface GovernedTransitionArgs {
  identity: RequestIdentity;
  entityType: GovernedEntity;
  fromState: string;
  toState: string;
  /** The transaction type the bands' definitions carry (how the instance is found again). */
  transactionType: WorkflowTransactionType;
  resourceId: string;
  /** The document's value; selects the band (ADR-022 CONST-DOA-005). */
  amount: Decimal;
  /** Comment recorded on a step the caller approves by acting (e.g. "Released from QR-00007"). */
  selfApprovalNote: string;
  /**
   * Vets the approvers recorded on a live instance before it is used (SoD the generic engine does
   * not know, e.g. "the advance recipient may not approve it"). Throw to refuse; the vetter decides
   * whether to void the instance first.
   */
  vetApprovers?: (approval: LatestApproval) => Promise<void>;
}

export type GovernedTransitionOutcome =
  | { gated: false; consumed: { instanceId: string; finalApproverId: string | null } | null }
  | { gated: true; approvalInstanceId: string };

/**
 * ADR-045 §2 / §3 — the ADR-044 §7 "acting counts as your approval" pattern, extracted so money
 * commands can share it: evaluate the governed transition; while the open instance's current step
 * requires a role the caller holds, the caller's command is recorded as their approval of that
 * step; a fully approved chain is consumed (ADR-015), otherwise the caller gets the gate.
 *
 * No active binding → `{ gated: false, consumed: null }` (backward-compatible: bands seeded inactive).
 * The quotation award keeps its own loop (it also binds the instance to the proposal it approves).
 */
export async function driveGovernedTransition(
  deps: { governance: CommandGovernanceService; approvals: ApprovalService },
  args: GovernedTransitionArgs,
): Promise<GovernedTransitionOutcome> {
  const { identity } = args;
  let lastGateId: string | null = null;
  for (let i = 0; ; i++) {
    const approval = await deps.governance.latestApproval(args.transactionType, args.resourceId);
    const live = approval && (approval.status === 'PENDING' || approval.status === 'APPROVED') ? approval : null;
    if (live && args.vetApprovers) await args.vetApprovers(live);

    if (
      live?.status === 'PENDING' &&
      i < MAX_SELF_STEPS &&
      live.currentStepRole !== null &&
      identity.roles.includes(live.currentStepRole)
    ) {
      await deps.approvals.approve(live.id, identity.userId, identity.roles, identity.activeOrganizationId, args.selfApprovalNote);
      continue;
    }

    const outcome = await deps.governance.evaluateStateTransition(
      identity,
      args.entityType,
      args.fromState,
      args.toState,
      args.resourceId,
      args.amount,
    );
    if (!outcome.gate) return { gated: false, consumed: outcome.consumedApproval };
    // A freshly opened instance may start with the caller's own step: look once more.
    if (outcome.gate.approvalInstanceId !== lastGateId && outcome.gate.approvalInstanceId !== live?.id) {
      lastGateId = outcome.gate.approvalInstanceId;
      continue;
    }
    return { gated: true, approvalInstanceId: outcome.gate.approvalInstanceId };
  }
}

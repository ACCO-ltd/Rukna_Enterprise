/**
 * Read model for a document's approval chain (ADR-036 backend request 1).
 *
 * Pure: turns an approval instance's definition steps and recorded actions into one row per
 * step with a state a reader can act on. No Prisma, so the derivation is unit-tested alone.
 */

export type ApprovalStepState = 'APPROVED' | 'REJECTED' | 'CURRENT' | 'UPCOMING' | 'SKIPPED' | 'CANCELLED';

export interface ApprovalActorRef {
  id: string;
  name: string;
}

export interface ApprovalStepView {
  stepOrder: number;
  /** The role that must act, as stored — e.g. `FINANCE_MANAGER`. */
  roleRequired: string;
  isOptional: boolean;
  state: ApprovalStepState;
  actor: ApprovalActorRef | null;
  actedAt: string | null;
  notes: string | null;
}

export interface ApprovalInstanceView {
  id: string;
  status: string;
  policyName: string;
  initiatedAt: string;
  initiatedBy: ApprovalActorRef;
  /** The amount the policy was evaluated against — why these steps were required. */
  evaluatedAmount: string | null;
  steps: ApprovalStepView[];
}

export interface DeriveInput {
  status: string;
  currentStepOrder: number;
  steps: Array<{ stepOrder: number; roleRequired: string; isOptional: boolean }>;
  actions: Array<{ stepOrder: number; action: string; actorId: string; actedAt: Date; notes: string | null }>;
}

/**
 * One row per definition step. A step's latest APPROVE/REJECT action decides it; otherwise its
 * position relative to the instance's current step does:
 *
 *  - before the current step, with no decision → SKIPPED (an optional step the chain passed)
 *  - the current step of a PENDING instance → CURRENT
 *  - after it → UPCOMING, or CANCELLED once the instance stopped without reaching it
 *
 * DELEGATE/ESCALATE actions move a step between people but do not decide it.
 */
export function deriveApprovalSteps(
  input: DeriveInput,
  actorName: (id: string) => string,
): ApprovalStepView[] {
  const pending = input.status === 'PENDING';
  return [...input.steps]
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map((step) => {
      const decision = input.actions
        .filter((a) => a.stepOrder === step.stepOrder && (a.action === 'APPROVE' || a.action === 'REJECT'))
        .sort((a, b) => b.actedAt.getTime() - a.actedAt.getTime())[0];

      let state: ApprovalStepState;
      if (decision) state = decision.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      else if (step.stepOrder < input.currentStepOrder) state = 'SKIPPED';
      else if (pending && step.stepOrder === input.currentStepOrder) state = 'CURRENT';
      else state = pending ? 'UPCOMING' : 'CANCELLED';

      return {
        stepOrder: step.stepOrder,
        roleRequired: step.roleRequired,
        isOptional: step.isOptional,
        state,
        actor: decision ? { id: decision.actorId, name: actorName(decision.actorId) } : null,
        actedAt: decision ? decision.actedAt.toISOString() : null,
        notes: decision?.notes ?? null,
      };
    });
}

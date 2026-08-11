import type { WorkflowStep } from './types';

/**
 * ─── Who may act on an approval step ────────────────────────────────────────────
 *
 * `WorkflowStep.roleRequired` names the role a step is reserved for. **The server never reads
 * it.** `approval.service.ts:32` checks that the instance exists and is PENDING, records the
 * action against the caller's user id, and advances — with no comparison against the step's
 * required role, and no organization scope on the lookup either
 * ([#45](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/45)).
 *
 * The controller advertises `403 Actor is not authorized to approve this step`. Nothing in the
 * service can produce it.
 *
 * So `canActOnStep` is the frontend's mirror of a guard that does not exist. It is an
 * affordance and not a control: `POST /workflows/instance/:id/approve` is callable directly by
 * anyone holding a token, and the panel says so on screen rather than implying otherwise.
 *
 * Not building the panel would secure nothing — the endpoints are already open. Offering the
 * action to the wrong person, silently, would make it worse.
 */

/**
 * Whether `roles` satisfies the step.
 *
 * Case-insensitive, because `roleRequired` is a free `String` on the step while the JWT's
 * `roles` are seeded elsewhere, and nothing guarantees the two agree on casing. A comparison
 * that fails on case would hide the action from precisely the person meant to take it.
 */
export function canActOnStep(step: WorkflowStep | null, roles: readonly string[]): boolean {
  if (!step) return false;

  const required = step.roleRequired.trim().toLocaleLowerCase();
  if (!required) return false;

  return roles.some((role) => role.trim().toLocaleLowerCase() === required);
}

export type ApprovalBlockReason = 'no-pending-step' | 'wrong-role';

export function approvalBlockReason(
  step: WorkflowStep | null,
  roles: readonly string[],
): ApprovalBlockReason | null {
  if (!step) return 'no-pending-step';
  if (!canActOnStep(step, roles)) return 'wrong-role';
  return null;
}

/**
 * Where this step sits in the chain, for the "step 2 of 3" line.
 *
 * `steps` comes from the workflow definition, which the panel already fetches to name the
 * chain. Returns null when the step is not in the definition — possible if the definition was
 * edited after the instance was raised, and worth rendering as unknown rather than as "1 of 1".
 */
export function stepPosition(
  step: WorkflowStep | null,
  steps: readonly WorkflowStep[],
): { position: number; total: number } | null {
  if (!step || steps.length === 0) return null;

  const ordered = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
  const index = ordered.findIndex((candidate) => candidate.id === step.id);
  if (index === -1) return null;

  return { position: index + 1, total: ordered.length };
}

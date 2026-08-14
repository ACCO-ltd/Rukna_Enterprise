import { ApiError, apiClient } from '@/lib/api-client';

import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowTransactionType,
  WorkflowTriggerBinding,
} from '../types';

/**
 * `GET /workflows/bindings` — the governance configuration the organization is subject to: every
 * trigger binding (its own plus tenant defaults) with the definition it routes to. Read-only.
 */
export function getWorkflowBindings(): Promise<WorkflowTriggerBinding[]> {
  return apiClient<WorkflowTriggerBinding[]>('/workflows/bindings');
}

/**
 * Returns null when no definition exists for this transaction type (404).
 * Throws for any other error.
 */
export async function getWorkflowDefinition(
  transactionType: WorkflowTransactionType,
): Promise<WorkflowDefinition | null> {
  try {
    return await apiClient<WorkflowDefinition>(`/workflows/definition/${transactionType}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * `GET /workflows/instance/:instanceId/step` — the step currently awaiting a decision.
 *
 * Returns `null` when the instance has no pending step, which is what an approved or rejected
 * instance looks like: the service returns `steps.find(...) ?? null` rather than an error.
 *
 * **This endpoint takes no identity and is not organization-scoped** (B15, folded into
 * [#45](https://github.com/ACCO-ltd/Rukna_Enterprise/issues/45)). Any instance id reveals any
 * tenant's pending step. It is called here only with ids that arrived on an org-scoped
 * document payload, which is a property of the caller and not a control.
 */
export async function getApprovalStep(instanceId: string): Promise<WorkflowStep | null> {
  try {
    return await apiClient<WorkflowStep | null>(`/workflows/instance/${instanceId}/step`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * `POST /workflows/instance/:instanceId/approve`
 *
 * Records the approval against the caller's user id and advances to the next step, or marks the
 * instance APPROVED when there is none.
 *
 * **The server does not check that the caller holds the step's `roleRequired`** (#45). The
 * controller documents a 403 for exactly that and the service cannot produce it. `canActOnStep`
 * is the frontend's mirror of the missing guard — an affordance, not a control.
 *
 * Answers 400 when the instance is not PENDING. The body carries notes only; identity comes
 * from the token, which was B4's fix.
 */
export function approveStep(instanceId: string, notes?: string): Promise<void> {
  return apiClient<void>(`/workflows/instance/${instanceId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(notes ? { notes } : {}),
  });
}

/** `POST /workflows/instance/:instanceId/reject` — terminal; nothing returns an instance to PENDING. */
export function rejectStep(instanceId: string, notes?: string): Promise<void> {
  return apiClient<void>(`/workflows/instance/${instanceId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(notes ? { notes } : {}),
  });
}

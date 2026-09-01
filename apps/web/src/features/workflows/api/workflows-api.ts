import { ApiError, apiClient } from '@/lib/api-client';

import type {
  ApprovalPolicyComparison,
  ApprovalPolicyVersionHistory,
} from '@erp/types';

import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowTransactionType,
  WorkflowTriggerBinding,
} from '../types';

export interface ApprovalPolicySummary {
  id: string;
  policyKey: string;
  version: number;
  status: 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'ACTIVE' | 'SUPERSEDED' | 'RETIRED';
  effectiveFrom: string | null;
  effectiveTo: string | null;
  amountBasis: string;
  notes: string | null;
  ruleCount: number;
  updatedAt: string;
}
export interface ApprovalPolicyDetail extends ApprovalPolicySummary { rules: { id: string; ruleKey: string; transactionType: string | null; priority: number; status: string; configuration: { requiredRole?: string; minAmount?: string | null; maxAmount?: string | null; fromState?: string | null; toState?: string | null } }[]; }
export interface DraftValidation { valid: boolean; ruleCount: number; issues: { code: string; message: string; ruleId?: string; severity: 'ERROR' | 'WARNING' }[]; }
export interface DraftSimulation { policy: { id: string; policyKey: string; version: number }; input: { transactionType: string; amount?: string; fromState?: string; toState?: string }; matched: boolean; roleChain: { ruleId: string; ruleKey: string; priority: number; requiredRole: string | null }[]; notice: string; }
export interface PolicyActivity { id: string; action: string; reason: string | null; createdAt: string; userId: string; }
export interface PolicySodRule { id: string; code: string; description: string; isActive: boolean; }

/** `GET /workflows/policies` — governed policy-version inventory for administration. */
export function getApprovalPolicies(): Promise<ApprovalPolicySummary[]> {
  return apiClient<ApprovalPolicySummary[]>('/workflows/policies');
}

export function createApprovalPolicyDraft(payload: { policyKey: string; notes?: string }): Promise<ApprovalPolicySummary> {
  return apiClient<ApprovalPolicySummary>('/workflows/policies', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
}
export function getApprovalPolicy(id: string): Promise<ApprovalPolicyDetail> { return apiClient<ApprovalPolicyDetail>(`/workflows/policies/${id}`); }
export function addApprovalPolicyRule(id: string, payload: { ruleKey: string; transactionType: string; requiredRole: string; priority?: number; minAmount?: string; maxAmount?: string; fromState?: string; toState?: string }): Promise<void> { return apiClient<void>(`/workflows/policies/${id}/rules`, { method: 'POST', body: JSON.stringify(payload) }); }
export function validateApprovalPolicyDraft(id: string): Promise<DraftValidation> { return apiClient<DraftValidation>(`/workflows/policies/${id}/validate`, { method: 'POST' }); }
export function simulateApprovalPolicyDraft(id: string, payload: { transactionType: string; amount?: string; fromState?: string; toState?: string }): Promise<DraftSimulation> { return apiClient<DraftSimulation>(`/workflows/policies/${id}/simulate`, { method: 'POST', body: JSON.stringify(payload) }); }
export function deleteApprovalPolicyRule(policyId: string, ruleId: string): Promise<void> { return apiClient<void>(`/workflows/policies/${policyId}/rules/${ruleId}`, { method: 'DELETE' }); }
export function updateApprovalPolicyRule(policyId: string, ruleId: string, payload: { ruleKey: string; transactionType: string; requiredRole: string; priority: number; minAmount?: string; maxAmount?: string; fromState?: string; toState?: string }): Promise<void> { return apiClient<void>(`/workflows/policies/${policyId}/rules/${ruleId}`, { method: 'PATCH', body: JSON.stringify(payload) }); }
export function reorderApprovalPolicyRules(id: string, ruleIds: string[]): Promise<void> { return apiClient<void>(`/workflows/policies/${id}/rules/reorder`, { method: 'POST', body: JSON.stringify({ ruleIds }) }); }
export function transitionApprovalPolicy(id: string, action: 'submit-review' | 'schedule' | 'activate' | 'retire', payload: { reason: string; effectiveFrom?: string }): Promise<void> { return apiClient<void>(`/workflows/policies/${id}/${action}`, { method: 'POST', body: JSON.stringify(payload) }); }
export function getApprovalPolicyHistory(id: string): Promise<PolicyActivity[]> { return apiClient<PolicyActivity[]>(`/workflows/policies/${id}/history`); }
export function cloneApprovalPolicy(id: string, reason: string): Promise<ApprovalPolicySummary> { return apiClient<ApprovalPolicySummary>(`/workflows/policies/${id}/clone`, { method: 'POST', body: JSON.stringify({ reason }) }); }
export function getApprovalPolicySodRules(id: string): Promise<PolicySodRule[]> { return apiClient<PolicySodRule[]>(`/workflows/policies/${id}/sod-rules`); }
export function upsertApprovalPolicySodRule(id: string, payload: Omit<PolicySodRule, 'id'>): Promise<PolicySodRule> { return apiClient<PolicySodRule>(`/workflows/policies/${id}/sod-rules`, { method: 'POST', body: JSON.stringify(payload) }); }

/**
 * `GET /workflows/policies/by-key/:policyKey/versions` — every version of one policyKey, newest
 * first (ADR-027 GOV-ADM-005). Backs the version-history list and the two version pickers in the
 * comparison view. Read-only.
 */
export function getApprovalPolicyVersionsByKey(policyKey: string): Promise<ApprovalPolicyVersionHistory> {
  return apiClient<ApprovalPolicyVersionHistory>(`/workflows/policies/by-key/${encodeURIComponent(policyKey)}/versions`);
}

/**
 * `GET /workflows/policies/compare?base=<id>&target=<id>` — the rule- and SoD-level diff between two
 * versions of the same policyKey. Used both by the free comparison view and by the rollback preview,
 * where `base` is the currently ACTIVE version and `target` is the older version being rolled back to,
 * so the diff reads as "what activating this rollback would change". Read-only.
 */
export function compareApprovalPolicyVersions(baseId: string, targetId: string): Promise<ApprovalPolicyComparison> {
  const query = new URLSearchParams({ base: baseId, target: targetId }).toString();
  return apiClient<ApprovalPolicyComparison>(`/workflows/policies/compare?${query}`);
}

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

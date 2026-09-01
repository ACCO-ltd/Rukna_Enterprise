'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { addApprovalPolicyRule, cloneApprovalPolicy, createApprovalPolicyDraft, deleteApprovalPolicyRule, getApprovalPolicies, getApprovalPolicy, getApprovalPolicyHistory, getApprovalPolicySodRules, reorderApprovalPolicyRules, simulateApprovalPolicyDraft, transitionApprovalPolicy, updateApprovalPolicyRule, upsertApprovalPolicySodRule, validateApprovalPolicyDraft } from '../api/workflows-api';

export function useApprovalPolicies() {
  return useQuery({ queryKey: ['approval-policies'], queryFn: getApprovalPolicies });
}
export function useApprovalPolicy(id: string | null) { return useQuery({ queryKey: ['approval-policies', id], queryFn: () => getApprovalPolicy(id as string), enabled: Boolean(id) }); }
export function useAddApprovalPolicyRule() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...payload }: { id: string; ruleKey: string; transactionType: string; requiredRole: string; priority?: number; minAmount?: string; maxAmount?: string; fromState?: string; toState?: string }) => addApprovalPolicyRule(id, payload), onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['approval-policies', v.id] }) }); }
export function useValidateApprovalPolicyDraft() { return useMutation({ mutationFn: validateApprovalPolicyDraft }); }
export function useSimulateApprovalPolicyDraft() { return useMutation({ mutationFn: ({ id, ...payload }: { id: string; transactionType: string; amount?: string; fromState?: string; toState?: string }) => simulateApprovalPolicyDraft(id, payload) }); }
export function useDeleteApprovalPolicyRule() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ policyId, ruleId }: { policyId: string; ruleId: string }) => deleteApprovalPolicyRule(policyId, ruleId), onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['approval-policies', v.policyId] }) }); }
export function useUpdateApprovalPolicyRule() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ policyId, ruleId, ...payload }: { policyId: string; ruleId: string; ruleKey: string; transactionType: string; requiredRole: string; priority: number; minAmount?: string; maxAmount?: string; fromState?: string; toState?: string }) => updateApprovalPolicyRule(policyId, ruleId, payload), onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['approval-policies', v.policyId] }) }); }
export function useReorderApprovalPolicyRules() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ruleIds }: { id: string; ruleIds: string[] }) => reorderApprovalPolicyRules(id, ruleIds), onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['approval-policies', v.id] }) }); }
export function useTransitionApprovalPolicy() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, action, reason, effectiveFrom }: { id: string; action: 'submit-review' | 'schedule' | 'activate' | 'retire'; reason: string; effectiveFrom?: string }) => transitionApprovalPolicy(id, action, { reason, effectiveFrom }), onSuccess: () => qc.invalidateQueries({ queryKey: ['approval-policies'] }) }); }
export function useApprovalPolicyHistory(id: string | null) { return useQuery({ queryKey: ['approval-policy-history', id], queryFn: () => getApprovalPolicyHistory(id as string), enabled: Boolean(id) }); }
export function useApprovalPolicySodRules(id: string | null) { return useQuery({ queryKey: ['approval-policy-sod', id], queryFn: () => getApprovalPolicySodRules(id as string), enabled: Boolean(id) }); }
export function useUpsertApprovalPolicySodRule() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, ...data }: { id: string; code: string; description: string; isActive: boolean }) => upsertApprovalPolicySodRule(id, data), onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['approval-policy-sod', v.id] }) }); }
export function useCloneApprovalPolicy() { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => cloneApprovalPolicy(id, reason), onSuccess: () => qc.invalidateQueries({ queryKey: ['approval-policies'] }) }); }

export function useCreateApprovalPolicyDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createApprovalPolicyDraft,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['approval-policies'] }),
  });
}

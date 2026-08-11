'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { approveStep, getApprovalStep, rejectStep } from '../api/workflows-api';
import type { WorkflowStep } from '../types';

export const approvalKeys = {
  step: (instanceId: string) => ['workflows', 'instance', instanceId, 'step'] as const,
};

export function useApprovalStep(
  instanceId: string | null,
): UseQueryResult<WorkflowStep | null, Error> {
  return useQuery({
    queryKey: approvalKeys.step(instanceId ?? 'none'),
    queryFn: () => getApprovalStep(instanceId!),
    enabled: Boolean(instanceId),
  });
}

/**
 * Approving or rejecting invalidates the step **and the document that owns the instance**.
 *
 * The document is the part that matters: `material-request.service.ts` and
 * `purchase-order.service.ts` move the record's own status as the chain advances, so a panel
 * that refetched only the step would show "approved" above a document still reading SUBMITTED.
 *
 * Both endpoints answer with an empty body, so there is nothing to write back and a refetch is
 * required either way.
 */
export function useApprovalAction(instanceId: string, onSettled?: () => void) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: { decision: 'approve' | 'reject'; notes?: string }) =>
      input.decision === 'approve'
        ? approveStep(instanceId, input.notes)
        : rejectStep(instanceId, input.notes),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: approvalKeys.step(instanceId) });
      void qc.invalidateQueries({ queryKey: ['procurement'] });
      onSettled?.();
    },
  });
}

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { GuaranteeStatus } from '@erp/types';

import {
  addAdvanceTerm,
  addGuarantee,
  addMilestone,
  completeMilestone,
  removeAdvanceTerm,
  setRetentionTerms,
  updateGuarantee,
  type AddAdvanceTermPayload,
  type AddGuaranteePayload,
  type AddMilestonePayload,
  type SetRetentionTermsPayload,
} from '../api/contracts-api';
import { contractKeys } from './use-contracts';

/**
 * Every commercial-term mutation invalidates the contract's detail query.
 *
 * The detail response is the only place these sub-entities exist — `GET /contracts` returns
 * bare rows with no terms — so there is nothing else to keep in step, and none of these
 * endpoints returns the reshaped contract. Refetching is the only way to see the result.
 */
function useTermMutation<TArgs>(contractId: string, run: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: contractKeys.detail(contractId) });
    },
  });
}

export function useSetRetentionTerms(contractId: string) {
  return useTermMutation(contractId, (payload: SetRetentionTermsPayload) =>
    setRetentionTerms(contractId, payload),
  );
}

export function useAddAdvanceTerm(contractId: string) {
  return useTermMutation(contractId, (payload: AddAdvanceTermPayload) =>
    addAdvanceTerm(contractId, payload),
  );
}

export function useRemoveAdvanceTerm(contractId: string) {
  return useTermMutation(contractId, (termId: string) => removeAdvanceTerm(contractId, termId));
}

export function useAddGuarantee(contractId: string) {
  return useTermMutation(contractId, (payload: AddGuaranteePayload) =>
    addGuarantee(contractId, payload),
  );
}

export function useUpdateGuarantee(contractId: string) {
  return useTermMutation(
    contractId,
    ({ guaranteeId, ...payload }: { guaranteeId: string; status?: GuaranteeStatus; notes?: string }) =>
      updateGuarantee(contractId, guaranteeId, payload),
  );
}

export function useAddMilestone(contractId: string) {
  return useTermMutation(contractId, (payload: AddMilestonePayload) =>
    addMilestone(contractId, payload),
  );
}

export function useCompleteMilestone(contractId: string) {
  return useTermMutation(contractId, (milestoneId: string) =>
    completeMilestone(contractId, milestoneId),
  );
}

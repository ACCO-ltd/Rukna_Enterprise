'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { useLifecycleCommand } from '@/features/lifecycle/use-lifecycle-command';

import {
  addIpaDeduction,
  addIpaItem,
  cancelIpa,
  createIpa,
  getIpa,
  listIpas,
  removeIpaDeduction,
  removeIpaItem,
  runIpaCommand,
  type AddIpaDeductionPayload,
  type AddIpaItemPayload,
  type CreateIpaPayload,
} from '../api/ipa-api';
import type { IpaCommand } from '../ipa-actions';
import type { Ipa, IpaDetail } from '../types';

export const ipaKeys = {
  all: ['ipa'] as const,
  list: (contractId?: string) => [...ipaKeys.all, 'list', contractId ?? 'all'] as const,
  detail: (id: string) => [...ipaKeys.all, 'detail', id] as const,
};

export function useIpas(contractId?: string): UseQueryResult<Ipa[], Error> {
  return useQuery({
    queryKey: ipaKeys.list(contractId),
    queryFn: () => listIpas(contractId),
  });
}

export function useIpa(id: string): UseQueryResult<IpaDetail, Error> {
  return useQuery({
    queryKey: ipaKeys.detail(id),
    queryFn: () => getIpa(id),
  });
}

export function useCreateIpa(contractId: string) {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateIpaPayload) => createIpa(payload),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ipaKeys.all });
      router.push(`/contracts/${contractId}/applications/${created.id}`);
    },
  });
}

/**
 * Lifecycle commands run through the shared hook, which classifies failures identically
 * across every status machine — including the `422` that means the approval workflow is
 * not configured.
 *
 * This is the aggregate that seam was built for. `ipa.service.ts:99` resolves the workflow
 * policy and then transitions directly, because creating an approval instance is Sprint 4+
 * work. When that lands, `submit-for-approval` will stop completing the transition and
 * start opening a pending approval — and the change belongs in the shared hook, not in
 * this screen.
 */
export function useIpaCommand(id: string) {
  return useLifecycleCommand((command: IpaCommand) => runIpaCommand(id, command), ipaKeys.all);
}

export function useCancelIpa(id: string) {
  return useLifecycleCommand(() => cancelIpa(id), ipaKeys.all);
}

/**
 * Line mutations invalidate the application's detail query.
 *
 * The three totals — `totalPeriodAmount`, `totalDeductions`, `netPayable` — are computed
 * per request from the items and deductions, so adding a line changes figures that are not
 * in the response of the call that added it. Refetching is the only way to see them.
 */
function useLineMutation<TArgs>(ipaId: string, run: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ipaKeys.detail(ipaId) });
    },
  });
}

export function useAddIpaItem(ipaId: string) {
  return useLineMutation(ipaId, (payload: AddIpaItemPayload) => addIpaItem(ipaId, payload));
}

export function useRemoveIpaItem(ipaId: string) {
  return useLineMutation(ipaId, (itemId: string) => removeIpaItem(ipaId, itemId));
}

export function useAddIpaDeduction(ipaId: string) {
  return useLineMutation(ipaId, (payload: AddIpaDeductionPayload) =>
    addIpaDeduction(ipaId, payload),
  );
}

export function useRemoveIpaDeduction(ipaId: string) {
  return useLineMutation(ipaId, (deductionId: string) => removeIpaDeduction(ipaId, deductionId));
}

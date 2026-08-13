'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

import { useLifecycleCommand } from '@/features/lifecycle/use-lifecycle-command';
import { projectKeys } from '@/features/projects/hooks/use-projects';

import {
  cancelContract,
  createContract,
  getContract,
  listContracts,
  runContractCommand,
  terminateContract,
  updateContract,
  type CreateContractPayload,
  type UpdateContractPayload,
} from '../api/contracts-api';
import type { ContractCommand } from '../contract-actions';
import type { Contract, ContractDetail } from '../types';

export const contractKeys = {
  all: ['contracts'] as const,
  list: (projectId?: string) => [...contractKeys.all, 'list', projectId ?? 'all'] as const,
  detail: (id: string) => [...contractKeys.all, 'detail', id] as const,
};

/** Pass a project id to scope the list server-side — the one filter this endpoint offers. */
export function useContracts(projectId?: string): UseQueryResult<Contract[], Error> {
  return useQuery({
    queryKey: contractKeys.list(projectId),
    queryFn: () => listContracts(projectId),
  });
}

export function useContract(id: string): UseQueryResult<ContractDetail, Error> {
  return useQuery({
    queryKey: contractKeys.detail(id),
    queryFn: () => getContract(id),
  });
}

export function useCreateContract() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateContractPayload) => createContract(payload),
    onSuccess: async (contract) => {
      await queryClient.invalidateQueries({ queryKey: contractKeys.all });
      await queryClient.invalidateQueries({ queryKey: projectKeys.detail(contract.projectId) });
      router.push(`/contracts/${contract.id}`);
    },
  });
}

export function useUpdateContract(id: string) {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateContractPayload) => updateContract(id, payload),
    onSuccess: async (contract) => {
      await queryClient.invalidateQueries({ queryKey: contractKeys.all });
      await queryClient.invalidateQueries({ queryKey: projectKeys.detail(contract.projectId) });
      router.push(`/contracts/${id}`);
    },
  });
}

/**
 * Lifecycle commands run through the shared hook, which classifies failures identically
 * across projects, contracts and payment applications.
 *
 * `projectKeys` is invalidated alongside `contractKeys` because the two aggregates move
 * together in one direction the user can see: a project's `practical-completion` moves
 * every ACTIVE contract on it to FINAL_ACCOUNT_PENDING server-side. Invalidating only
 * contracts would leave a project page showing contracts in a state the server has already
 * left behind.
 */
export function useAdvanceContract(id: string) {
  return useLifecycleCommand(
    (command: ContractCommand) => runContractCommand(id, command),
    [contractKeys.all, ['projects']],
  );
}

export function useCancelContract(id: string) {
  return useLifecycleCommand((reason: string) => cancelContract(id, reason), [
    contractKeys.all,
    ['projects'],
  ]);
}

export function useTerminateContract(id: string) {
  return useLifecycleCommand((reason: string) => terminateContract(id, reason), [
    contractKeys.all,
    ['projects'],
  ]);
}

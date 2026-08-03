'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { ApiError } from '@/lib/api-client';

import { getBoq, getBoqTree, initializeBoq } from '../api/boq-api';
import type { Boq, BoqTreeNode } from '../types';

export const boqKeys = {
  all: (projectId: string) => ['boq', projectId] as const,
  summary: (projectId: string) => [...boqKeys.all(projectId), 'summary'] as const,
  tree: (projectId: string, versionId: string) =>
    [...boqKeys.all(projectId), 'tree', versionId] as const,
};

export function useBoq(projectId: string): UseQueryResult<Boq | null, Error> {
  return useQuery({
    queryKey: boqKeys.summary(projectId),
    queryFn: async () => {
      try {
        return await getBoq(projectId);
      } catch (error) {
        // A project without a BOQ answers 404. That is a legitimate state — "not
        // initialized yet" — not a failure, so it resolves to null and the UI offers to
        // create one. Anything else is a real error and propagates.
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}

export function useBoqTree(
  projectId: string,
  versionId: string | null,
): UseQueryResult<BoqTreeNode[], Error> {
  return useQuery({
    queryKey: boqKeys.tree(projectId, versionId ?? 'none'),
    queryFn: () => getBoqTree(projectId, versionId!),
    enabled: versionId !== null,
  });
}

export function useInitializeBoq(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => initializeBoq(projectId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: boqKeys.all(projectId) });
    },
  });
}

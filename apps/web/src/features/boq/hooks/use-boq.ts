'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { ApiError } from '@/lib/api-client';
import { projectKeys } from '@/features/projects/hooks/use-projects';

import {
  addBoqNode,
  baselineVersion,
  cancelDraftVersion,
  createDraftVersion,
  deleteBoqNode,
  getBoq,
  getBoqTree,
  initializeBoq,
  moveBoqNode,
  updateBoqNode,
  type CreateNodePayload,
  type UpdateNodePayload,
} from '../api/boq-api';
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
  // `void` so callers can write `mutate()` — this command takes no variables.
  return useBoqMutation<void>(projectId, () => initializeBoq(projectId));
}

/**
 * Every versioning command reshuffles which version is the draft and which is approved, and
 * can change node membership (creating a draft copies the approved nodes). Invalidating the
 * whole BOQ key rather than patching the cache keeps the summary, the version list and
 * every cached tree consistent with each other.
 */
function useBoqMutation<TArgs>(projectId: string, run: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: boqKeys.all(projectId) });
      await queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}

export function useBaselineVersion(projectId: string) {
  return useBoqMutation(projectId, (versionId: string) => baselineVersion(projectId, versionId));
}

export function useCancelDraftVersion(projectId: string) {
  return useBoqMutation(projectId, (versionId: string) => cancelDraftVersion(projectId, versionId));
}

export function useCreateDraftVersion(projectId: string) {
  return useBoqMutation(projectId, (notes: string) => createDraftVersion(projectId, notes));
}

// ─── Node editing ──────────────────────────────────────────────────────────────

export function useAddNode(projectId: string, versionId: string) {
  return useBoqMutation(projectId, (payload: CreateNodePayload) =>
    addBoqNode(projectId, versionId, payload),
  );
}

export function useUpdateNode(projectId: string, versionId: string) {
  return useBoqMutation(projectId, (args: { nodeId: string; payload: UpdateNodePayload }) =>
    updateBoqNode(projectId, versionId, args.nodeId, args.payload),
  );
}

export function useDeleteNode(projectId: string, versionId: string) {
  return useBoqMutation(projectId, (nodeId: string) =>
    deleteBoqNode(projectId, versionId, nodeId),
  );
}

/**
 * Reorders a node among its siblings.
 *
 * Two writes, because `moveNode` never reindexes siblings (B13) — see planReorder. They run
 * in sequence rather than in parallel: both touch the same sibling set, and a failure
 * halfway is easier to reason about than two racing writes.
 */
export function useReorderNode(projectId: string, versionId: string) {
  return useBoqMutation(
    projectId,
    async (plan: {
      moved: { id: string; sortOrder: number };
      displaced: { id: string; sortOrder: number };
      parentId: string | null;
    }) => {
      const parent = plan.parentId ? { newParentId: plan.parentId } : {};

      await moveBoqNode(projectId, versionId, plan.moved.id, {
        ...parent,
        newSortOrder: plan.moved.sortOrder,
      });
      await moveBoqNode(projectId, versionId, plan.displaced.id, {
        ...parent,
        newSortOrder: plan.displaced.sortOrder,
      });
    },
  );
}

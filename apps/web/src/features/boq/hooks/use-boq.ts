'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  BoqCompareResponse,
  BoqTreeNodeResponse,
  BoqWorkspaceResponse,
} from '@erp/types';

import { projectKeys } from '@/features/projects/hooks/use-projects';

import {
  addBoqNode,
  baselineVersion,
  cancelDraftVersion,
  compareBoqVersions,
  createDraftVersion,
  deleteBoqNode,
  getBoqTree,
  getBoqWorkspace,
  initializeBoq,
  moveBoqNode,
  updateBoqNode,
  type CreateNodePayload,
  type UpdateNodePayload,
} from '../api/boq-api';

export const boqKeys = {
  all: (projectId: string) => ['boq', projectId] as const,
  workspace: (projectId: string) => [...boqKeys.all(projectId), 'workspace'] as const,
  tree: (projectId: string, versionId: string) =>
    [...boqKeys.all(projectId), 'tree', versionId] as const,
  compare: (projectId: string, leftId: string, rightId: string) =>
    [...boqKeys.all(projectId), 'compare', leftId, rightId] as const,
};

/**
 * The workspace read model.
 *
 * A project with no BOQ is not a 404 here — the server answers with `boq: null`, which is
 * the "not initialized" state the screen renders an offer to fix. The old `useBoq` had to
 * catch a 404 and translate it, which meant a genuine 404 (wrong project id) looked
 * identical to a legitimate starting state.
 */
export function useBoqWorkspace(projectId: string): UseQueryResult<BoqWorkspaceResponse, Error> {
  return useQuery({
    queryKey: boqKeys.workspace(projectId),
    queryFn: () => getBoqWorkspace(projectId),
  });
}

export function useBoqTree(
  projectId: string,
  versionId: string | null,
): UseQueryResult<BoqTreeNodeResponse[], Error> {
  return useQuery({
    queryKey: boqKeys.tree(projectId, versionId ?? 'none'),
    queryFn: () => getBoqTree(projectId, versionId!),
    enabled: versionId !== null,
  });
}

/** Enabled only once both versions are chosen — comparing a version with itself is a 400. */
export function useBoqCompare(
  projectId: string,
  leftId: string | null,
  rightId: string | null,
): UseQueryResult<BoqCompareResponse, Error> {
  return useQuery({
    queryKey: boqKeys.compare(projectId, leftId ?? 'none', rightId ?? 'none'),
    queryFn: () => compareBoqVersions(projectId, leftId!, rightId!),
    enabled: leftId !== null && rightId !== null && leftId !== rightId,
  });
}

/**
 * Every versioning command reshuffles which version is draft and which is approved, and can
 * change node membership (creating a draft copies the approved nodes). Invalidating the
 * whole BOQ key rather than patching the cache keeps the workspace, the version list and
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

export function useInitializeBoq(projectId: string) {
  // `void` so callers can write `mutate()` — this command takes no variables.
  return useBoqMutation<void>(projectId, () => initializeBoq(projectId));
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
 * Moves a node among its siblings or under a new parent.
 *
 * One request. This used to issue two writes and compute a displacing position itself,
 * because the server did not reindex siblings (B13); it does now, so the client states the
 * destination and the server owns the ordering.
 */
export function useMoveNode(projectId: string, versionId: string) {
  return useBoqMutation(
    projectId,
    (args: { nodeId: string; newParentId?: string; newSortOrder: number }) =>
      moveBoqNode(projectId, versionId, args.nodeId, {
        ...(args.newParentId ? { newParentId: args.newParentId } : {}),
        newSortOrder: args.newSortOrder,
      }),
  );
}

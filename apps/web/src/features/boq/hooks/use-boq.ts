'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  BoqChangeEventResponse,
  BoqCompareResponse,
  BoqCompareToSignedResponse,
  BoqImportRequest,
  BoqTimelineResponse,
  BoqTreeNodeResponse,
  BoqWorkspaceResponse,
} from '@erp/types';

import { projectKeys } from '@/features/projects/hooks/use-projects';

import {
  addBoqNode,
  addExtraWork,
  cancelDraftVersion,
  commitVersion,
  compareBoqVersions,
  createDraftVersion,
  deleteBoqNode,
  drawContingency,
  getBoqCompareToSigned,
  getBoqHistory,
  getBoqTimeline,
  getBoqTree,
  getBoqWorkspace,
  importBoq,
  initializeBoq,
  moveBoqNode,
  previewBoqImport,
  updateBoqNode,
  type AddExtraWorkPayload,
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
  compareToSigned: (projectId: string) =>
    [...boqKeys.all(projectId), 'compare-to-signed'] as const,
  timeline: (projectId: string) => [...boqKeys.all(projectId), 'timeline'] as const,
  history: (projectId: string, versionId: string, nodeId: string) =>
    [...boqKeys.all(projectId), 'history', versionId, nodeId] as const,
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

/**
 * The version's change log. Enabled by the caller (the panel is collapsed by default, so it does
 * not fetch until opened). Keyed under `boqKeys.all`, so any node mutation's invalidation refreshes
 * the feed. `nodeId` narrows it to one line.
 */
export function useBoqHistory(
  projectId: string,
  versionId: string | null,
  options: { nodeId?: string | null; enabled: boolean },
): UseQueryResult<BoqChangeEventResponse[], Error> {
  return useQuery({
    queryKey: boqKeys.history(projectId, versionId ?? 'none', options.nodeId ?? 'all'),
    queryFn: () =>
      getBoqHistory(projectId, versionId!, options.nodeId ? { nodeId: options.nodeId } : {}),
    enabled: options.enabled && versionId !== null,
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
 * ADR-029 R-2 — the compare-to-signed diff lens (live vs the as-committed snapshot). Gated by
 * the caller (the lens is summoned on demand, so it does not fetch until opened) and by
 * `compareToSignedAvailable` — before a commit there is nothing signed to compare against.
 */
export function useBoqCompareToSigned(
  projectId: string,
  enabled: boolean,
): UseQueryResult<BoqCompareToSignedResponse, Error> {
  return useQuery({
    queryKey: boqKeys.compareToSigned(projectId),
    queryFn: () => getBoqCompareToSigned(projectId),
    enabled,
  });
}

/**
 * ADR-029 R-3 — the BOQ timeline feed. Enabled by the caller (the drawer is closed by default,
 * so it does not fetch until opened). Keyed under `boqKeys.all`, so any mutation's invalidation
 * refreshes it.
 */
export function useBoqTimeline(
  projectId: string,
  enabled: boolean,
): UseQueryResult<BoqTimelineResponse, Error> {
  return useQuery({
    queryKey: boqKeys.timeline(projectId),
    queryFn: () => getBoqTimeline(projectId),
    enabled,
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

/**
 * ADR-029 CONST-BOQ-034 — commit the working draft to contract (WORKING → COMMITTED). Replaces
 * baseline as the primary WORKING action. A `409` is the governance gate ("sent for sign-off"),
 * not a failure; the caller reads `ApiError.status` to phrase it.
 */
export function useCommitVersion(projectId: string) {
  return useBoqMutation(projectId, (versionId: string) => commitVersion(projectId, versionId));
}

/**
 * ADR-029 CONST-BOQ-028 — draw contingency budget onto a chosen target line, holding the
 * contract value constant. Initiated from the contingency line (M1/M2), not from a fabricated
 * overrun signal.
 */
export function useDrawContingency(projectId: string, versionId: string) {
  return useBoqMutation(projectId, (args: { toNodeId: string; amount: string }) =>
    drawContingency(projectId, versionId, args),
  );
}

export function useCancelDraftVersion(projectId: string) {
  return useBoqMutation(projectId, (versionId: string) => cancelDraftVersion(projectId, versionId));
}

export function useCreateDraftVersion(projectId: string) {
  return useBoqMutation(projectId, (notes: string) => createDraftVersion(projectId, notes));
}

// ─── Import (ADR-016 Phase 2) ────────────────────────────────────────────────────

/**
 * Dry-run preview. A plain mutation, deliberately NOT wrapped in `useBoqMutation`: it changes
 * nothing on the server, so invalidating the workspace after it would be wasteful — and would
 * refetch the tree the user is still deciding whether to replace.
 */
export function useBoqImportPreview(projectId: string) {
  return useMutation({ mutationFn: (body: BoqImportRequest) => previewBoqImport(projectId, body) });
}

/**
 * The commit. Invalidates the BOQ so the workspace, versions and tree all reflect the new nodes.
 * Written out rather than via `useBoqMutation` so the `BoqImportResult` return type survives to
 * the caller's `onSuccess` (the shared helper widens it to `unknown`).
 */
export function useImportBoq(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BoqImportRequest) => importBoq(projectId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: boqKeys.all(projectId) });
      await queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
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

/**
 * ADR-029 R5 — the who-pays extra-work classifier (`POST .../boq/extra-work`). ABSORB adds an
 * ABSORBED leaf funded net-zero from contingency; SEPARATE adds a SEPARATE_CHARGE leaf; VARIATION
 * creates a DRAFT VariationOrder. Invalidates the BOQ so the money band, tree and tags refresh. A
 * `400` (e.g. contingency insufficient) / `403` / `409` surfaces via the caller's error handling.
 */
export function useAddExtraWork(projectId: string) {
  return useBoqMutation(projectId, (payload: AddExtraWorkPayload) =>
    addExtraWork(projectId, payload),
  );
}

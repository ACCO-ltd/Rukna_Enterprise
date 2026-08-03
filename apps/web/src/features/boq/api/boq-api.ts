import { apiClient } from '@/lib/api-client';

import type { Boq, BoqTreeNode } from '../types';

/**
 * Creates the BOQ and its first DRAFT version. Idempotent — returns the existing BOQ if
 * one is already initialized, so a double click is harmless.
 */
export function initializeBoq(projectId: string): Promise<Boq> {
  return apiClient<Boq>(`/projects/${projectId}/boq`, { method: 'POST' });
}

/** 404 when the project has no BOQ yet — that is the "not initialized" state, not an error. */
export function getBoq(projectId: string): Promise<Boq> {
  return apiClient<Boq>(`/projects/${projectId}/boq`);
}

/** Full recursive tree for one version, with server-computed totals. */
export function getBoqTree(projectId: string, versionId: string): Promise<BoqTreeNode[]> {
  return apiClient<BoqTreeNode[]>(`/projects/${projectId}/boq/versions/${versionId}/tree`);
}

/**
 * Body for `POST .../nodes`, mirroring CreateNodeDto.
 *
 * `sortOrder` is required and the server never allocates it — the client picks a position
 * among the destination siblings. Optional fields are omitted rather than sent empty, for
 * the same reason as the project payloads: the pipeline runs `forbidNonWhitelisted` and
 * `currency` is `@Length(3, 3)`, so `""` is an invalid code rather than an absent one.
 */
export interface CreateNodePayload {
  parentId?: string;
  sortOrder: number;
  code: string;
  description: string;
  descriptionAr?: string;
  isLeaf?: boolean;
  unit?: string;
  quantity?: number;
  unitRate?: number;
  currency?: string;
}

/** Body for `PATCH .../nodes/:id`. `parentId` and `sortOrder` are not accepted — use move. */
export type UpdateNodePayload = Omit<CreateNodePayload, 'parentId' | 'sortOrder'>;

export function addBoqNode(
  projectId: string,
  versionId: string,
  payload: CreateNodePayload,
): Promise<BoqTreeNode> {
  return apiClient<BoqTreeNode>(`/projects/${projectId}/boq/versions/${versionId}/nodes`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateBoqNode(
  projectId: string,
  versionId: string,
  nodeId: string,
  payload: UpdateNodePayload,
): Promise<BoqTreeNode> {
  return apiClient<BoqTreeNode>(
    `/projects/${projectId}/boq/versions/${versionId}/nodes/${nodeId}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  );
}

/** Hard delete. The server refuses a node that still has children. Returns an empty body. */
export function deleteBoqNode(
  projectId: string,
  versionId: string,
  nodeId: string,
): Promise<void> {
  return apiClient<void>(`/projects/${projectId}/boq/versions/${versionId}/nodes/${nodeId}`, {
    method: 'DELETE',
  });
}

/**
 * Repositions a node and its descendants. Returns an empty body (B6).
 *
 * The server writes the given `sortOrder` onto this node alone and does NOT reindex its
 * siblings (B13), so callers are responsible for keeping sibling order values distinct.
 */
export function moveBoqNode(
  projectId: string,
  versionId: string,
  nodeId: string,
  payload: { newParentId?: string; newSortOrder: number },
): Promise<void> {
  return apiClient<void>(
    `/projects/${projectId}/boq/versions/${versionId}/nodes/${nodeId}/move`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

/**
 * Locks the open draft in as the approved BOQ.
 *
 * The previously approved version becomes SUPERSEDED, and on the first baseline the BOQ's
 * `originalBaselineVersionId` is set and is immutable thereafter — that pointer is the
 * original contract BOQ every later variation is measured against.
 */
export function baselineVersion(projectId: string, versionId: string): Promise<Boq> {
  return apiClient<Boq>(`/projects/${projectId}/boq/versions/${versionId}/baseline`, {
    method: 'POST',
  });
}

/** Discards the open draft. The approved version is untouched. */
export function cancelDraftVersion(projectId: string, versionId: string): Promise<Boq> {
  return apiClient<Boq>(`/projects/${projectId}/boq/versions/${versionId}/cancel`, {
    method: 'POST',
  });
}

/**
 * Starts a revision by copying every node from the approved version into a new draft.
 * Requires an approved version (400 otherwise) and no draft already open (409).
 */
export function createDraftVersion(projectId: string, notes: string): Promise<Boq> {
  return apiClient<Boq>(`/projects/${projectId}/boq/draft`, {
    method: 'POST',
    // `notes` is optional server-side; omit rather than send an empty string.
    body: JSON.stringify(notes ? { notes } : {}),
  });
}

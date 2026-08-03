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

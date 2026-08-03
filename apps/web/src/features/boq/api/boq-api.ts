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

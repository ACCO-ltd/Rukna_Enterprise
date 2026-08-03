import type { ProjectStatus } from '@erp/types';

import { apiClient } from '@/lib/api-client';

import type { Project } from '../types';

/**
 * Lists projects for the authenticated organization, newest first.
 *
 * The endpoint returns a bare array with no pagination, search or sort (B8). At ACCO's
 * current scale that is fine and the dashboard aggregates client-side; past a few hundred
 * projects this needs a server-side summary endpoint (B10).
 */
export function listProjects(status?: ProjectStatus): Promise<Project[]> {
  return apiClient<Project[]>('/projects', {
    ...(status ? { params: { status } } : {}),
  });
}

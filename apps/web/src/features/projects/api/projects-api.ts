import type { ProjectStatus } from '@erp/types';

import { apiClient } from '@/lib/api-client';

import type { ProjectCommand } from '../project-actions';
import type { Project, ProjectDetail } from '../types';

/**
 * Body accepted by `POST /projects`, mirroring CreateProjectDto.
 *
 * The API's ValidationPipe runs with `forbidNonWhitelisted: true`, so an unrecognised
 * property is a 400 rather than being ignored. Optional fields must therefore be OMITTED
 * when empty, not sent as `""` or `null` — see `toCreateProjectPayload`.
 *
 * `contractValue` is a number here, not the string the API returns. That asymmetry is the
 * API's: it accepts `@IsNumber` on the way in and serializes a Decimal on the way out.
 */
export interface CreateProjectPayload {
  code: string;
  name: string;
  nameAr?: string;
  description?: string;
  clientName?: string;
  contractValue?: number;
  currency?: string;
  startDate?: string;
  expectedEndDate?: string;
}

export function listProjects(status?: ProjectStatus): Promise<Project[]> {
  return apiClient<Project[]>('/projects', {
    ...(status ? { params: { status } } : {}),
  });
}

export function createProject(payload: CreateProjectPayload): Promise<Project> {
  return apiClient<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getProject(id: string): Promise<ProjectDetail> {
  return apiClient<ProjectDetail>(`/projects/${id}`);
}

/**
 * Body accepted by `PATCH /projects/:id`.
 *
 * `null` is meaningful here and distinct from omission: it clears the column, where an
 * omitted key leaves it unchanged. `code` is absent because it is immutable after
 * creation.
 */
export interface UpdateProjectPayload {
  name?: string;
  nameAr?: string | null;
  description?: string | null;
  clientName?: string | null;
  contractValue?: number | null;
  currency?: string | null;
  startDate?: string | null;
  expectedEndDate?: string | null;
}

/** Editing is accepted only while the project is in DRAFT. */
export function updateProject(id: string, payload: UpdateProjectPayload): Promise<Project> {
  return apiClient<Project>(`/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** Advances the project one step. Returns the updated project. */
export function runProjectCommand(id: string, command: ProjectCommand): Promise<Project> {
  return apiClient<Project>(`/projects/${id}/${command}`, { method: 'POST' });
}

export function cancelProject(id: string, reason: string): Promise<Project> {
  return apiClient<Project>(`/projects/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * Suspend and resume both answer 200 with an EMPTY body (B6) — they return void here
 * rather than a project, so callers must refetch to see the change. The mutation hooks
 * invalidate the cache for exactly that reason.
 */
export function suspendProject(id: string, reason: string): Promise<void> {
  return apiClient<void>(`/projects/${id}/suspend`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function resumeProject(id: string): Promise<void> {
  return apiClient<void>(`/projects/${id}/resume`, { method: 'POST' });
}

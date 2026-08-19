import type { ProjectRole, ProjectStatus } from '@erp/types';

import { apiClient } from '@/lib/api-client';

import type { ProjectCommand } from '../project-actions';
import type {
  Project,
  ProjectWorkspaceGuidanceItem,
  ProjectDetail,
  ProjectMember,
  ProjectWorkspaceSummary,
} from '../types';

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
  code?: string;
  name: string;
  nameAr?: string;
  description?: string;
  clientName?: string;
  clientId?: string;
  commercialModel?: 'CLIENT_CONTRACT' | 'INTERNAL_CAPITAL';
  participationModel?: 'SOLE' | 'JOINT_VENTURE';
  location?: string;
  contractValue?: number;
  currency?: string;
  startDate?: string;
  expectedEndDate?: string;
}

/**
 * Body of `POST /projects/:id/members`.
 *
 * `roles` is `@ArrayMinSize(1)` and `@IsEnum(ProjectRole, { each: true })`, so a member must
 * be given at least one role at the moment they are added — there is no bare "add to project".
 * A member's roles CAN be corrected afterwards via `setProjectMemberRoles` (PATCH …/roles),
 * so a mistyped role no longer forces a remove/re-add.
 */
export interface AddProjectMemberPayload {
  userId: string;
  roles: ProjectRole[];
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

export function getProjectWorkspaceSummary(id: string): Promise<ProjectWorkspaceSummary> {
  return apiClient<ProjectWorkspaceSummary>(`/projects/${id}/workspace-summary`);
}

export function getProjectWorkspaceGuidance(id: string): Promise<ProjectWorkspaceGuidanceItem[]> {
  return apiClient<ProjectWorkspaceGuidanceItem[]>(`/projects/${id}/workspace-guidance`);
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
  clientId?: string | null;
  location?: string | null;
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

// ─── Members ─────────────────────────────────────────────────────────────────────

/**
 * `GET /projects/:id/members` — active members only, with their roles and user embedded.
 *
 * `findAllMembers` selects `user { id, firstName, lastName, email }` and the member's live
 * roles, so this response renders on its own. That is unusual in this API and worth noting:
 * the equivalent AP and AR list endpoints embed nothing.
 *
 * Live since `e85bab9`. It was recorded as deferred on B1 and B2 for a week after both were
 * fixed — the page behind it stayed a placeholder the whole time.
 */
export function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  return apiClient<ProjectMember[]>(`/projects/${projectId}/members`);
}

/**
 * `POST /projects/:id/members`
 *
 * **Only an existing member of the project may call this.** `project.service.ts:250` runs
 * `assertMember(projectId, identity.userId)` before anything else and answers `403` otherwise
 * — an organisation administrator who is not on the project cannot add anyone to it. B1's fix
 * auto-enrols the creator as PROJECT_MANAGER, which is what stops that being a deadlock.
 *
 * `409` when the user is already an active member.
 *
 * The response is `findActiveMember`, which includes `roles` but **not** `user` — unlike the
 * list. Callers should refetch rather than write this into a list cache.
 */
export function addProjectMember(
  projectId: string,
  payload: AddProjectMemberPayload,
): Promise<ProjectMember> {
  return apiClient<ProjectMember>(`/projects/${projectId}/members`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * `DELETE /projects/:id/members/:userId` — a soft delete; the row is kept with `removedAt` set.
 *
 * Keyed on the **user** id, not the member id. Answers `200` with an EMPTY body (B6), so
 * callers must refetch.
 *
 * Carries the same membership guard as `addProjectMember`, and no guard at all against
 * removing the last PROJECT_MANAGER — a project can be left with no one able to administer it.
 */
export function removeProjectMember(projectId: string, userId: string): Promise<void> {
  return apiClient<void>(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' });
}

/**
 * `PATCH /projects/:id/members/:userId/roles` — corrects a member's roles.
 *
 * Keyed on the user id (like remove). A versioned edit server-side: the current active role
 * rows are closed and the new set opened in one transaction, so `@ArrayMinSize(1)` still holds
 * — a member is never left with no roles. Returns the updated member.
 */
export function setProjectMemberRoles(
  projectId: string,
  userId: string,
  roles: ProjectRole[],
): Promise<ProjectMember> {
  return apiClient<ProjectMember>(`/projects/${projectId}/members/${userId}/roles`, {
    method: 'PATCH',
    body: JSON.stringify({ roles }),
  });
}

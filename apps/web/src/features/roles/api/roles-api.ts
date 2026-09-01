import { apiClient } from '@/lib/api-client';
import type {
  CreateRoleRequest,
  RoleSummary,
  RoleWithPermissionsResponse,
  SetRolePermissionsRequest,
  UpdateRoleRequest,
} from '@erp/types';

export interface RoleImpact {
  id: string; name: string; kind: 'SYSTEM' | 'CUSTOM'; memberCount: number;
  permissions: { id: string; action: string; resource: string; domain: string; riskClass: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }[];
  warnings: { code: string; permissionId: string; riskClass: 'HIGH' | 'CRITICAL'; message: string }[];
}
export interface RoleAccessReview { id: string; reviewerUserId: string; decision: 'CONFIRMED' | 'CHANGES_REQUIRED'; notes: string | null; createdAt: string; }

/** `GET /roles` — role summaries with permission and member counts. */
export async function listRoles(): Promise<RoleSummary[]> {
  return apiClient<RoleSummary[]>('/roles');
}

/** `GET /roles/:id` — a role with its full permission set (used to pre-check the picker). */
export async function getRole(id: string): Promise<RoleWithPermissionsResponse> {
  return apiClient<RoleWithPermissionsResponse>(`/roles/${id}`);
}

/** `POST /roles` — create a role with an optional permission set. */
export async function createRole(
  payload: CreateRoleRequest,
): Promise<RoleWithPermissionsResponse> {
  return apiClient<RoleWithPermissionsResponse>('/roles', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** `PATCH /roles/:id` — rename or re-describe a role. */
export async function updateRole(
  id: string,
  payload: UpdateRoleRequest,
): Promise<RoleWithPermissionsResponse> {
  return apiClient<RoleWithPermissionsResponse>(`/roles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** `PUT /roles/:id/permissions` — replace the role's permission set. */
export async function setRolePermissions(
  id: string,
  payload: SetRolePermissionsRequest,
): Promise<RoleWithPermissionsResponse> {
  return apiClient<RoleWithPermissionsResponse>(`/roles/${id}/permissions`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/** `DELETE /roles/:id` — 204, or 409 when the role is in use or is the ADMIN role. */
export async function deleteRole(id: string): Promise<void> {
  return apiClient<void>(`/roles/${id}`, { method: 'DELETE' });
}

export function getRoleImpact(id: string): Promise<RoleImpact> { return apiClient<RoleImpact>(`/roles/${id}/impact`); }
export function getRoleAccessReviews(id: string): Promise<RoleAccessReview[]> { return apiClient<RoleAccessReview[]>(`/roles/${id}/access-reviews`); }
export function reassignRoleOwner(id: string, ownerUserId: string): Promise<void> { return apiClient<void>(`/roles/${id}/owner`, { method: 'POST', body: JSON.stringify({ ownerUserId }) }); }
export function createRoleAccessReview(id: string, payload: { decision: 'CONFIRMED' | 'CHANGES_REQUIRED'; notes?: string }): Promise<void> { return apiClient<void>(`/roles/${id}/access-reviews`, { method: 'POST', body: JSON.stringify(payload) }); }

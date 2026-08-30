import { apiClient } from '@/lib/api-client';
import type {
  CreateRoleRequest,
  RoleSummary,
  RoleWithPermissionsResponse,
  SetRolePermissionsRequest,
  UpdateRoleRequest,
} from '@erp/types';

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

import { apiClient } from '@/lib/api-client';
import type {
  CreateUserRequest,
  SetUserPasswordRequest,
  SetUserRolesRequest,
  UpdateUserRequest,
  ProvisionTemporaryUserRequest,
  ProvisionTemporaryUserResponse,
  UserWithRolesResponse,
} from '@erp/types';

/** `GET /users` — org users with their roles and membership status. */
export async function listUsers(): Promise<UserWithRolesResponse[]> {
  return apiClient<UserWithRolesResponse[]>('/users');
}

export async function provisionTemporaryUser(payload: ProvisionTemporaryUserRequest): Promise<ProvisionTemporaryUserResponse> {
  return apiClient<ProvisionTemporaryUserResponse>('/users/provision-temporary', {
    method: 'POST', body: JSON.stringify(payload),
  });
}

/** `POST /users` — provisions a user, membership and roles in one transaction. */
export async function createUser(payload: CreateUserRequest): Promise<UserWithRolesResponse> {
  return apiClient<UserWithRolesResponse>('/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** `PATCH /users/:id` — update the profile (first / last name). */
export async function updateUser(
  id: string,
  payload: UpdateUserRequest,
): Promise<UserWithRolesResponse> {
  return apiClient<UserWithRolesResponse>(`/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** `POST /users/:id/deactivate` — suspends the user's membership. */
export async function deactivateUser(id: string): Promise<UserWithRolesResponse> {
  return apiClient<UserWithRolesResponse>(`/users/${id}/deactivate`, { method: 'POST' });
}

/** `POST /users/:id/reactivate` — restores the user's membership. */
export async function reactivateUser(id: string): Promise<UserWithRolesResponse> {
  return apiClient<UserWithRolesResponse>(`/users/${id}/reactivate`, { method: 'POST' });
}

export interface RegeneratedTemporaryCredential { temporaryPassword: string; expiresAt: string; }
export function regenerateTemporaryPassword(id: string): Promise<RegeneratedTemporaryCredential> {
  return apiClient<RegeneratedTemporaryCredential>(`/users/${id}/regenerate-temporary-password`, { method: 'POST' });
}

/** `POST /users/:id/set-password` — admin-set a new password. Returns 204. */
export async function setUserPassword(
  id: string,
  payload: SetUserPasswordRequest,
): Promise<void> {
  return apiClient<void>(`/users/${id}/set-password`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** `PUT /users/:id/roles` — replace the user's role set on their membership. */
export async function setUserRoles(
  id: string,
  payload: SetUserRolesRequest,
): Promise<UserWithRolesResponse> {
  return apiClient<UserWithRolesResponse>(`/users/${id}/roles`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

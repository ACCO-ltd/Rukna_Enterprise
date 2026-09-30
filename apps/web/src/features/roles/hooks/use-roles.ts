'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  CreateRoleRequest,
  RoleWithPermissionsResponse,
  SetRolePermissionsRequest,
  UpdateRoleRequest,
} from '@erp/types';

import type { MutationFeedbackMeta } from '@/lib/mutation-feedback';

import {
  createRole,
  deleteRole,
  getRole,
  listRoles,
  setRolePermissions,
  updateRole,
  getRoleImpact, getRoleAccessReviews, reassignRoleOwner, createRoleAccessReview,
} from '../api/roles-api';

const roleKeys = {
  all: ['roles'] as const,
  detail: (id: string) => ['roles', id] as const,
};

export function useRoles() {
  return useQuery({ queryKey: roleKeys.all, queryFn: listRoles });
}

export function useRoleImpact(id: string | null) { return useQuery({ queryKey: ['roles', id, 'impact'], queryFn: () => getRoleImpact(id as string), enabled: Boolean(id) }); }
export function useRoleAccessReviews(id: string | null) { return useQuery({ queryKey: ['roles', id, 'reviews'], queryFn: () => getRoleAccessReviews(id as string), enabled: Boolean(id) }); }
export function useReassignRoleOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ownerUserId }: { id: string; ownerUserId: string }) => reassignRoleOwner(id, ownerUserId),
    onSuccess: () => qc.invalidateQueries({ queryKey: roleKeys.all }),
    meta: { successToast: 'platform.feedback.roleOwnerReassigned', flashRow: (_d, v) => (v as { id: string }).id },
  });
}
export function useCreateRoleAccessReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, notes }: { id: string; decision: 'CONFIRMED' | 'CHANGES_REQUIRED'; notes?: string }) =>
      createRoleAccessReview(id, { decision, notes }),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['roles', v.id, 'reviews'] }),
    meta: { successToast: 'platform.feedback.roleAccessReviewRecorded', flashRow: false },
  });
}

/** Feedback for a command that answers with the saved role — named, and its row tinted. */
function roleSaved(key: string): MutationFeedbackMeta {
  return {
    successToast: { key, values: (data) => ({ name: (data as RoleWithPermissionsResponse).name }) },
  };
}

/** Loads a role's full permission set. Enabled only when an id is supplied. */
export function useRole(id: string | null) {
  return useQuery({
    queryKey: roleKeys.detail(id ?? ''),
    queryFn: () => getRole(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateRoleRequest) => createRole(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: roleKeys.all }),
    meta: roleSaved('platform.feedback.roleCreated'),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateRoleRequest }) =>
      updateRole(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: roleKeys.all });
      void qc.invalidateQueries({ queryKey: roleKeys.detail(id) });
    },
    meta: roleSaved('platform.feedback.roleSaved'),
  });
}

export function useSetRolePermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SetRolePermissionsRequest }) =>
      setRolePermissions(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: roleKeys.all });
      void qc.invalidateQueries({ queryKey: roleKeys.detail(id) });
    },
    meta: roleSaved('platform.feedback.rolePermissionsSaved'),
  });
}

/** Takes the role's name as well as its id — the delete answers 204, and the toast names it. */
export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (role: { id: string; name: string }) => deleteRole(role.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: roleKeys.all }),
    meta: {
      successToast: {
        key: 'platform.feedback.roleDeleted',
        values: (_data, variables) => ({ name: (variables as { name: string }).name }),
      },
      flashRow: false,
    },
  });
}

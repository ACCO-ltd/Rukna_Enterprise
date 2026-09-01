'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  CreateUserRequest,
  SetUserPasswordRequest,
  SetUserRolesRequest,
  UpdateUserRequest,
  ProvisionTemporaryUserRequest,
} from '@erp/types';

import {
  createUser,
  deactivateUser,
  listUsers,
  reactivateUser,
  setUserPassword,
  setUserRoles,
  updateUser,
  provisionTemporaryUser,
  regenerateTemporaryPassword,
} from '../api/users-api';

const userKeys = {
  all: ['users'] as const,
};

export function useUsers() {
  return useQuery({ queryKey: userKeys.all, queryFn: listUsers });
}

export function useRegenerateTemporaryPassword() {
  return useMutation({ mutationFn: regenerateTemporaryPassword });
}

export function useProvisionTemporaryUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProvisionTemporaryUserRequest) => provisionTemporaryUser(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateUserRequest) => createUser(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateUserRequest }) =>
      updateUser(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deactivateUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useReactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reactivateUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useSetUserPassword() {
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SetUserPasswordRequest }) =>
      setUserPassword(id, payload),
  });
}

export function useSetUserRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SetUserRolesRequest }) =>
      setUserRoles(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export interface BulkStatusResult {
  succeeded: number;
  failed: number;
}

/**
 * Bulk (de)activate over a set of ids. There is no bulk endpoint, so each id is a per-user
 * call fired in parallel; `allSettled` means one rejection does not abandon the rest. The list
 * is invalidated once, after the whole batch, so the table reflects whatever actually applied
 * — including partial success. Self-exclusion is enforced by the caller (`bulkTargets`), not
 * here, because it is a selection rule, not a request rule.
 */
export function useBulkUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ids,
      intent,
    }: {
      ids: string[];
      intent: 'deactivate' | 'reactivate';
    }): Promise<BulkStatusResult> => {
      const run = intent === 'deactivate' ? deactivateUser : reactivateUser;
      const results = await Promise.allSettled(ids.map((id) => run(id)));
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      return { succeeded, failed: results.length - succeeded };
    },
    onSettled: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

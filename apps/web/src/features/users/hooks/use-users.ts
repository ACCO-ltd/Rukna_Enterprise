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

'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import {
  getIpc,
  issueIpc,
  listIpcs,
  listIpcsByProject,
  supersedeIpc,
} from '../api/ipc-api';
import type { SupersedeIpcPayload } from '../api/ipc-api';
import type { Ipc, IpcDetail, IssueIpcPayload } from '../types';

export const ipcKeys = {
  all: ['ipc'] as const,
  list: (applicationId?: string) => [...ipcKeys.all, 'list', applicationId ?? 'all'] as const,
  listByProject: (projectId: string) => [...ipcKeys.all, 'project', projectId] as const,
  detail: (id: string) => [...ipcKeys.all, 'detail', id] as const,
  payment: (id: string) => [...ipcKeys.all, 'payment', id] as const,
};

export function useIpcs(applicationId?: string): UseQueryResult<Ipc[], Error> {
  return useQuery({
    queryKey: ipcKeys.list(applicationId),
    queryFn: () => listIpcs(applicationId),
  });
}

export function useIpcsByProject(projectId: string): UseQueryResult<Ipc[], Error> {
  return useQuery({
    queryKey: ipcKeys.listByProject(projectId),
    queryFn: () => listIpcsByProject(projectId),
  });
}

export function useIpc(id: string): UseQueryResult<IpcDetail, Error> {
  return useQuery({
    queryKey: ipcKeys.detail(id),
    queryFn: () => getIpc(id),
  });
}

export function useIssueIpc(applicationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: IssueIpcPayload) => issueIpc(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ipcKeys.list(applicationId) });
    },
  });
}

export function useSupersede(applicationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SupersedeIpcPayload) => supersedeIpc(applicationId, payload),
    onSuccess: () => {
      // Invalidate the whole IPC namespace so both list and detail queries refresh.
      void qc.invalidateQueries({ queryKey: ipcKeys.all });
    },
  });
}


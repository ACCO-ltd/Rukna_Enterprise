'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { getIpc, listIpcs } from '../api/ipc-api';
import type { Ipc, IpcDetail } from '../types';

export const ipcKeys = {
  all: ['ipc'] as const,
  list: (applicationId?: string) => [...ipcKeys.all, 'list', applicationId ?? 'all'] as const,
  detail: (id: string) => [...ipcKeys.all, 'detail', id] as const,
};

export function useIpcs(applicationId?: string): UseQueryResult<Ipc[], Error> {
  return useQuery({
    queryKey: ipcKeys.list(applicationId),
    queryFn: () => listIpcs(applicationId),
  });
}

export function useIpc(id: string): UseQueryResult<IpcDetail, Error> {
  return useQuery({
    queryKey: ipcKeys.detail(id),
    queryFn: () => getIpc(id),
  });
}

'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listClients, listClientSummaries } from '../api/clients-api';
import type { Client, ClientListItem } from '../types';

export const clientKeys = {
  all: ['clients'] as const,
  list: () => [...clientKeys.all, 'list'] as const,
  detail: (id: string) => [...clientKeys.all, 'detail', id] as const,
};

export function useClients(): UseQueryResult<Client[], Error> {
  return useQuery({
    queryKey: clientKeys.list(),
    queryFn: () => listClients(),
  });
}

export function useClientSummaries(): UseQueryResult<ClientListItem[], Error> {
  return useQuery({
    queryKey: [...clientKeys.list(), 'summary'],
    queryFn: () => listClientSummaries(),
  });
}

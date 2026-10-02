'use client';

import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listClients, listClientSummaries } from '../api/clients-api';
import type { Client, ClientSummaryPage, ClientSummaryQuery } from '../types';

export const clientKeys = {
  all: ['clients'] as const,
  list: () => [...clientKeys.all, 'list'] as const,
  summary: (query: ClientSummaryQuery) => [...clientKeys.list(), 'summary', query] as const,
  detail: (id: string) => [...clientKeys.all, 'detail', id] as const,
  overview: (id: string) => [...clientKeys.detail(id), 'overview'] as const,
  activity: (id: string) => [...clientKeys.detail(id), 'activity'] as const,
};

export function useClients(): UseQueryResult<Client[], Error> {
  return useQuery({
    queryKey: clientKeys.list(),
    queryFn: () => listClients(),
  });
}

/**
 * One page of the Clients list. The previous page stays on screen while the next loads, so
 * typing in search or changing a filter does not flash the table back to a skeleton.
 */
export function useClientSummaries(
  query: ClientSummaryQuery,
): UseQueryResult<ClientSummaryPage, Error> {
  return useQuery({
    queryKey: clientKeys.summary(query),
    queryFn: () => listClientSummaries(query),
    placeholderData: keepPreviousData,
  });
}

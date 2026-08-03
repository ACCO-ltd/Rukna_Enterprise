'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listProjects } from '../api/projects-api';
import type { Project } from '../types';

export const projectKeys = {
  all: ['projects'] as const,
  list: () => [...projectKeys.all, 'list'] as const,
  detail: (id: string) => [...projectKeys.all, 'detail', id] as const,
};

export function useProjects(): UseQueryResult<Project[], Error> {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: () => listProjects(),
  });
}

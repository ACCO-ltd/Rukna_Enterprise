'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import {
  cancelProject,
  getProject,
  resumeProject,
  runProjectCommand,
  suspendProject,
} from '../api/projects-api';
import type { ProjectCommand } from '../project-actions';
import type { ProjectDetail } from '../types';
import { projectKeys } from './use-projects';

export function useProject(id: string): UseQueryResult<ProjectDetail, Error> {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => getProject(id),
  });
}

/**
 * Every project mutation invalidates the whole `projects` key rather than patching the
 * cache by hand.
 *
 * Two reasons this is the right default here. Suspend and resume return an empty body
 * (B6), so there is no updated resource to write back. And a status change alters the
 * dashboard's counts as well as this project's row — one invalidation keeps every view
 * consistent, where a targeted cache write would leave the counts stale.
 */
function useProjectMutation<TArgs>(run: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

export function useAdvanceProject(id: string) {
  return useProjectMutation((command: ProjectCommand) => runProjectCommand(id, command));
}

export function useCancelProject(id: string) {
  return useProjectMutation((reason: string) => cancelProject(id, reason));
}

export function useSuspendProject(id: string) {
  return useProjectMutation((reason: string) => suspendProject(id, reason));
}

export function useResumeProject(id: string) {
  return useProjectMutation(() => resumeProject(id));
}

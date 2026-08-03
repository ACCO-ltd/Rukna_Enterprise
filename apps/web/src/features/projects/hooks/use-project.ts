'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useLifecycleCommand } from '@/features/lifecycle/use-lifecycle-command';

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
 * Project commands run through the shared lifecycle hook, which contracts and payment
 * applications use too. It invalidates the whole `projects` key rather than patching the
 * cache — suspend and resume return an empty body (B6) so there is nothing to write back,
 * and a status change moves the dashboard's counts as well as this project's row.
 *
 * It also classifies failures, so `failure.kind` distinguishes a stale status from a
 * missing approval-workflow configuration.
 */
export function useAdvanceProject(id: string) {
  return useLifecycleCommand(
    (command: ProjectCommand) => runProjectCommand(id, command),
    projectKeys.all,
  );
}

export function useCancelProject(id: string) {
  return useLifecycleCommand((reason: string) => cancelProject(id, reason), projectKeys.all);
}

export function useSuspendProject(id: string) {
  return useLifecycleCommand((reason: string) => suspendProject(id, reason), projectKeys.all);
}

export function useResumeProject(id: string) {
  return useLifecycleCommand(() => resumeProject(id), projectKeys.all);
}

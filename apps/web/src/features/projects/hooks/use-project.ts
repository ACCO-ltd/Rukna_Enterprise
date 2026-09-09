'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useLifecycleCommand } from '@/features/lifecycle/use-lifecycle-command';
import type { ProjectLifecycleCommand } from '@erp/types';

import {
  cancelProject,
  getProject,
  getProjectWorkspaceSummary,
  getProjectReadiness,
  getProjectGuidance,
  type ProjectTransition,
  resumeProject,
  runProjectCommand,
  suspendProject,
} from '../api/projects-api';
import type { ProjectDetail, ProjectWorkspaceSummary } from '../types';
import { projectKeys } from './use-projects';

export function useProject(id: string): UseQueryResult<ProjectDetail, Error> {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => getProject(id),
  });
}

export function useProjectWorkspaceSummary(
  id: string,
): UseQueryResult<ProjectWorkspaceSummary, Error> {
  return useQuery({
    queryKey: [...projectKeys.detail(id), 'workspace-summary'],
    queryFn: () => getProjectWorkspaceSummary(id),
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
    (transition: ProjectTransition) => runProjectCommand(id, transition),
    projectKeys.all,
  );
}

export function useProjectReadiness(id: string, command: ProjectLifecycleCommand = 'start', enabled = true) {
  return useQuery({ queryKey: [...projectKeys.detail(id), 'readiness', command], queryFn: () => getProjectReadiness(id, command), enabled });
}

export function useProjectGuidance(id: string) {
  return useQuery({ queryKey: [...projectKeys.detail(id), 'guidance'], queryFn: () => getProjectGuidance(id) });
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

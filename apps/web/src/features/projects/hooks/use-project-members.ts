'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import {
  addProjectMember,
  listProjectMembers,
  removeProjectMember,
  type AddProjectMemberPayload,
} from '../api/projects-api';
import type { ProjectMember } from '../types';
import { projectKeys } from './use-projects';

/**
 * Members are a separate cache entry from the project detail even though `GET /projects/:id`
 * embeds them too.
 *
 * Two reasons. The members page is reachable directly, so it must not depend on the detail
 * query having been run; and both mutations return either nothing useful or nothing at all —
 * `removeMember` answers 200 with an empty body (B6) — so a refetch is required regardless
 * and a dedicated key keeps it from refetching the whole project.
 */
export const memberKeys = {
  list: (projectId: string) => [...projectKeys.detail(projectId), 'members'] as const,
};

export function useProjectMembers(projectId: string): UseQueryResult<ProjectMember[], Error> {
  return useQuery({
    queryKey: memberKeys.list(projectId),
    queryFn: () => listProjectMembers(projectId),
    enabled: Boolean(projectId),
  });
}

/**
 * Both mutations invalidate the members list **and** the project detail, because the detail
 * response embeds its own copy of `members`. Leaving that stale is how the overview tab keeps
 * showing someone who was just removed.
 */
function useMemberMutation<TArgs>(projectId: string, mutationFn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: memberKeys.list(projectId) });
      void qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}

export function useAddProjectMember(projectId: string) {
  return useMemberMutation(projectId, (payload: AddProjectMemberPayload) =>
    addProjectMember(projectId, payload),
  );
}

/** Keyed on the user id, not the member id — that is what the endpoint takes. */
export function useRemoveProjectMember(projectId: string) {
  return useMemberMutation(projectId, (userId: string) =>
    removeProjectMember(projectId, userId),
  );
}

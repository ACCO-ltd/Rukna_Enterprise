'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { ProgrammeMilestoneResponse } from '@erp/types';

import {
  createMilestone,
  listMilestones,
  verifyMilestone,
  type CreateMilestoneBody,
} from '../api/programme-api';

export const programmeKeys = {
  milestones: (projectId: string) => ['programme', projectId, 'milestones'] as const,
};

export function useMilestones(
  projectId: string,
): UseQueryResult<ProgrammeMilestoneResponse[], Error> {
  return useQuery({
    queryKey: programmeKeys.milestones(projectId),
    queryFn: () => listMilestones(projectId),
    enabled: Boolean(projectId),
  });
}

export function useCreateMilestone(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMilestoneBody) => createMilestone(projectId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: programmeKeys.milestones(projectId) });
    },
  });
}

/** Verify a milestone. Invalidates the project's milestone list. */
export function useVerifyMilestone(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ milestoneId, actualDate }: { milestoneId: string; actualDate: string }) =>
      verifyMilestone(milestoneId, actualDate),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: programmeKeys.milestones(projectId) });
    },
  });
}

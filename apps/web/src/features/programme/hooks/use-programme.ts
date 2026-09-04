'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { ProgrammeMilestoneResponse } from '@erp/types';

import {
  createActivity,
  createMilestone,
  deleteActivity,
  listActivities,
  listMilestones,
  updateActivity,
  verifyMilestone,
  type CreateActivityBody,
  type CreateMilestoneBody,
  type ProgrammeActivityResponse,
  type UpdateActivityBody,
} from '../api/programme-api';

export const programmeKeys = {
  milestones: (projectId: string) => ['programme', projectId, 'milestones'] as const,
  activities: (projectId: string) => ['programme', projectId, 'activities'] as const,
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

// ── Programme activities (WBS time layer) ──────────────────────────────────────────────────
export function useProgrammeActivities(
  projectId: string,
): UseQueryResult<ProgrammeActivityResponse[], Error> {
  return useQuery({
    queryKey: programmeKeys.activities(projectId),
    queryFn: () => listActivities(projectId),
    enabled: Boolean(projectId),
  });
}

export function useCreateActivity(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workPackageId, body }: { workPackageId: string; body: CreateActivityBody }) =>
      createActivity(workPackageId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: programmeKeys.activities(projectId) });
    },
  });
}

export function useUpdateActivity(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ activityId, body }: { activityId: string; body: UpdateActivityBody }) =>
      updateActivity(activityId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: programmeKeys.activities(projectId) });
    },
  });
}

export function useDeleteActivity(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (activityId: string) => deleteActivity(activityId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: programmeKeys.activities(projectId) });
    },
  });
}

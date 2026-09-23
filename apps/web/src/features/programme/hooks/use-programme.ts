'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { ProgrammeMilestoneResponse } from '@erp/types';

import type { ScheduleTemplateKey } from '@erp/types';

import { progressKeys } from '@/features/progress/hooks/use-progress';

import {
  applyScheduleTemplate,
  createActivity,
  createMilestone,
  deleteActivity,
  downloadMasterSchedule,
  listActivities,
  listMilestones,
  suggestWeights,
  updateActivity,
  updateWorkPackage,
  verifyMilestone,
  type CreateActivityBody,
  type CreateMilestoneBody,
  type ProgrammeActivityResponse,
  type UpdateActivityBody,
  type UpdateWorkPackageBody,
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

// ── Master Schedule P1-d (ADR-029): the guided schedule builder ─────────────────────────────
//
// Applying the template creates the phase work packages; setting weights/dates/schedule-only via
// the WP PATCH moves the roll-up (the project figure + the schedule window it draws). Both refresh
// the progress roll-up and the work-package list so the Plan & Setup table and the Schedule view
// update the moment the wizard writes. `suggest-weights` is read-only — no cache to invalidate.

export function useApplyScheduleTemplate(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateKey: ScheduleTemplateKey) => applyScheduleTemplate(projectId, templateKey),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: progressKeys.rollup(projectId) }),
        queryClient.invalidateQueries({ queryKey: progressKeys.workPackages(projectId) }),
      ]);
    },
  });
}

export function useSuggestWeights(projectId: string) {
  return useMutation({
    mutationFn: () => suggestWeights(projectId),
  });
}

/**
 * Master Schedule P4 (ADR-029) — download the branded PDF report.
 *
 * A mutation (not a query) because it is a one-shot user action with a side effect — the browser
 * download — and never caches; `isPending` drives the button's generating state and `onError`
 * surfaces a toast. `fallbackProjectCode` names the file when the server's `Content-Disposition`
 * is not readable by the browser.
 */
export function useDownloadMasterSchedule(projectId: string) {
  return useMutation({
    mutationFn: (fallbackProjectCode: string) =>
      downloadMasterSchedule(projectId, fallbackProjectCode),
  });
}

export function useUpdateWorkPackage(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workPackageId, body }: { workPackageId: string; body: UpdateWorkPackageBody }) =>
      updateWorkPackage(workPackageId, body),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: progressKeys.rollup(projectId) }),
        queryClient.invalidateQueries({ queryKey: progressKeys.workPackages(projectId) }),
        queryClient.invalidateQueries({ queryKey: programmeKeys.activities(projectId) }),
      ]);
    },
  });
}

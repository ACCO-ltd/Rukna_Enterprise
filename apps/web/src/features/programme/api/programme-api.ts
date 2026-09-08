import type {
  ApplyScheduleTemplateResponse,
  ProgrammeMilestoneResponse,
  ScheduleTemplateKey,
  SuggestWeightsResponse,
} from '@erp/types';

import type { WorkPackageResponse } from '@/features/progress/api/progress-api';
import { apiClient } from '@/lib/api-client';

/**
 * Programme milestones (ADR-021 phase 2). A milestone is a named construction stage with a baseline
 * date; an authorized member verifies it (records the actual date) when the stage is complete.
 */

export interface CreateMilestoneBody {
  code: string;
  name: string;
  /** ISO date, YYYY-MM-DD. */
  baselineDate: string;
  forecastDate?: string;
  sortOrder?: number;
}

export function listMilestones(projectId: string): Promise<ProgrammeMilestoneResponse[]> {
  return apiClient<ProgrammeMilestoneResponse[]>(`/projects/${projectId}/programme/milestones`);
}

export function createMilestone(
  projectId: string,
  body: CreateMilestoneBody,
): Promise<ProgrammeMilestoneResponse> {
  return apiClient<ProgrammeMilestoneResponse>(`/projects/${projectId}/programme/milestones`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Verify a milestone — the stage is complete. `actualDate` is ISO YYYY-MM-DD. */
export function verifyMilestone(
  milestoneId: string,
  actualDate: string,
): Promise<ProgrammeMilestoneResponse> {
  return apiClient<ProgrammeMilestoneResponse>(`/programme/milestones/${milestoneId}/verify`, {
    method: 'POST',
    body: JSON.stringify({ actualDate }),
  });
}

/**
 * Programme activities (ADR-021 CONST-PROG-005) — the time layer under a work package: planned
 * dates + an optional milestone flag. No dependency network (deliberately deferred). Dates come back
 * as ISO datetime strings (the column is @db.Date); slice to YYYY-MM-DD in the UI.
 */
export interface ProgrammeActivityResponse {
  id: string;
  workPackageId: string;
  code: string;
  name: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  durationDays: number | null;
  isMilestone: boolean;
  sortOrder: number;
}

export interface CreateActivityBody {
  code: string;
  name: string;
  /** ISO date, YYYY-MM-DD. */
  plannedStart?: string;
  plannedEnd?: string;
  isMilestone?: boolean;
}

/** Code is immutable after creation (the API has no code field on update). */
export interface UpdateActivityBody {
  name?: string;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  isMilestone?: boolean;
}

export function listActivities(projectId: string): Promise<ProgrammeActivityResponse[]> {
  return apiClient<ProgrammeActivityResponse[]>(`/projects/${projectId}/programme/activities`);
}

export function createActivity(
  workPackageId: string,
  body: CreateActivityBody,
): Promise<ProgrammeActivityResponse> {
  return apiClient<ProgrammeActivityResponse>(`/work-packages/${workPackageId}/activities`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateActivity(
  activityId: string,
  body: UpdateActivityBody,
): Promise<ProgrammeActivityResponse> {
  return apiClient<ProgrammeActivityResponse>(`/programme/activities/${activityId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function deleteActivity(activityId: string): Promise<void> {
  return apiClient<void>(`/programme/activities/${activityId}`, { method: 'DELETE' });
}

/**
 * Master Schedule P1-d (ADR-029) — the two helpers that power the guided schedule builder.
 *
 * `apply-schedule-template` seeds a project's phases from a server-side template so the user edits
 * rather than invents (409 when the project already has any work packages). `suggest-weights`
 * derives each phase's progress weight from its assigned BOQ value so the user does not guess; it
 * only suggests — the work-package PATCH persists a chosen weight.
 */
export function applyScheduleTemplate(
  projectId: string,
  templateKey: ScheduleTemplateKey,
): Promise<ApplyScheduleTemplateResponse> {
  return apiClient<ApplyScheduleTemplateResponse>(
    `/projects/${projectId}/programme/apply-schedule-template`,
    { method: 'POST', body: JSON.stringify({ templateKey }) },
  );
}

export function suggestWeights(projectId: string): Promise<SuggestWeightsResponse> {
  return apiClient<SuggestWeightsResponse>(
    `/projects/${projectId}/programme/suggest-weights`,
    { method: 'POST' },
  );
}

/**
 * Partially update a work package, including its master-schedule window (the work package IS the
 * phase row). Dates are ISO `YYYY-MM-DD`; pass `null` to clear one. % complete and actual dates are
 * derived on read and are never accepted here.
 */
export interface UpdateWorkPackageBody {
  name?: string;
  responsibleOwner?: string | null;
  /** Fraction of project weight, 0..1 (≤ 4 dp). */
  progressWeight?: number;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  durationDays?: number | null;
  forecastEnd?: string | null;
  /** A non-measurable phase (no BOQ scope); tracked by dates only. */
  scheduleOnly?: boolean;
}

export function updateWorkPackage(
  workPackageId: string,
  body: UpdateWorkPackageBody,
): Promise<WorkPackageResponse> {
  return apiClient<WorkPackageResponse>(`/work-packages/${workPackageId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

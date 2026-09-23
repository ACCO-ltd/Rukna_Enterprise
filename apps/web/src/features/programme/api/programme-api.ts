import type {
  ApplyScheduleTemplateResponse,
  ProgrammeMilestoneResponse,
  ScheduleTemplateKey,
  SuggestWeightsResponse,
} from '@erp/types';

import type { WorkPackageResponse } from '@/features/progress/api/progress-api';
import { apiClient, ApiError, endSession } from '@/lib/api-client';
import { sessionStore } from '@/features/auth/session/session-store';
import { getApiBaseUrl } from '@/lib/tenant';

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

/**
 * Master Schedule P4 (ADR-029) — download the branded, server-generated PDF.
 *
 * The endpoint returns a `StreamableFile` (a binary `application/pdf` attachment), not JSON, so
 * `apiClient` cannot carry it — that pipeline reads every body as text/JSON. And the endpoint is
 * bearer-authenticated, so a plain `<a href>` would not carry the token. This helper therefore
 * fetches the URL directly with the Authorization header (mirroring `executeRequest` in
 * `api-client.ts`), reads the response as a blob, and hands the browser a file via a temporary
 * `<a download>` click. The object URL is revoked immediately after the click so a leaked blob
 * does not pin the whole PDF in memory.
 *
 * The attachment filename is read from the response's `Content-Disposition` header when the browser
 * exposes it (`master-schedule-<code>-<asOf>.pdf`); otherwise it falls back to a sensible default
 * built from the project code the caller passes in.
 */
export async function downloadMasterSchedule(
  projectId: string,
  fallbackProjectCode: string,
): Promise<void> {
  const token = sessionStore.getState().accessToken;

  const res = await fetch(`${getApiBaseUrl()}/projects/${projectId}/programme/master-schedule.pdf`, {
    method: 'GET',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  // A read the user is not (or no longer) authorized for. Match the JSON pipeline: a 401 tears the
  // session down and routes to login rather than surfacing a confusing "download failed".
  if (res.status === 401) {
    endSession();
    throw new ApiError(401, 'Session expired', 'SESSION_EXPIRED');
  }

  if (!res.ok) {
    throw new ApiError(res.status, 'Could not generate the master schedule PDF');
  }

  const blob = await res.blob();
  const filename =
    filenameFromContentDisposition(res.headers.get('Content-Disposition')) ??
    `master-schedule-${fallbackProjectCode}.pdf`;

  triggerBlobDownload(blob, filename);
}

/**
 * Pull the filename out of a `Content-Disposition: attachment; filename="…"` header. Returns null
 * when the header is absent (a cross-origin fetch can hide it unless the API sets
 * `Access-Control-Expose-Headers`) or unparseable, so the caller can fall back to a default.
 */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  // Prefer RFC 5987 `filename*=UTF-8''…` when present, else the plain quoted/bare `filename=`.
  const extended = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // Malformed percent-encoding — fall through to the plain form.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || null;
}

/** Hand the browser a file from a blob, then revoke the object URL so it is not pinned in memory. */
function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

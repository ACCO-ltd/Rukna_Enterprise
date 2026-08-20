import type { ProgrammeMilestoneResponse } from '@erp/types';

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

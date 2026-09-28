import type { ProjectReadinessCallerResponse, ProjectReadinessResponse } from '@erp/types';

const CANNOT_RUN: ProjectReadinessCallerResponse = { canRun: false, waivableConditions: [] };

/**
 * What the readiness means for the signed-in user, as the server computed it (`caller`). The UI
 * never re-derives it from role names: who may waive what is the API's decision.
 *
 * Fails closed — no data yet, or a response without `caller`, reads as "cannot run, nothing
 * waivable", so a Start button can only ever appear on the server's say-so.
 */
export function readinessCaller(
  data: ProjectReadinessResponse | undefined,
): ProjectReadinessCallerResponse {
  return (data as Partial<ProjectReadinessResponse> | undefined)?.caller ?? CANNOT_RUN;
}

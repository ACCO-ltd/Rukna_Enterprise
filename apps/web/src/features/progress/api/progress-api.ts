import type {
  CollectionProgressSignalResponse,
  DailyProgressReportResponse,
  PhysicalFinancialSignalResponse,
  ProgressCurveResponse,
  ProgressMeasurementResponse,
  ProgressPeriodComparisonResponse,
  ProgressSnapshotResponse,
  ProjectProgressLine,
  ProjectRollupResponse,
} from '@erp/types';

import { apiClient } from '@/lib/api-client';

/**
 * Progress / Daily Progress Reports (ADR-021).
 *
 * Lifecycle: DRAFT → SUBMITTED → APPROVED (or → RETURNED for revision). Measurements are editable
 * ONLY while DRAFT/RETURNED. On approve, measurements become verified progress and the report is
 * immutable; approve enforces cumulative ≤ BOQ scope (CONST-PROG-002/009). Measure against BOQ
 * LEAF nodes only.
 *
 * Quantities/weights are decimal **strings**; percentages are **numbers** (and can be null).
 */

// ─── Request payloads (mirror the API DTOs; no shared input types exist) ─────────────────
export interface CreateDprBody {
  /** ISO date, YYYY-MM-DD. */
  reportDate: string;
  weather?: string;
  labourCount?: number;
  equipmentNote?: string;
  narrative?: string;
  delayReason?: string;
}

export interface AddMeasurementBody {
  /** BOQ leaf node id. */
  boqNodeId: string;
  /** Quantity measured this report (≤ 3 dp). */
  quantity: number;
  notes?: string;
}

export interface CreateWorkPackageBody {
  code: string;
  name: string;
  responsibleOwner?: string;
  /** Fraction of project weight, 0..1 (≤ 4 dp). */
  progressWeight?: number;
}

// ─── Response shapes without a shared @erp/types definition ───────────────────────────────
/** A DPR with its measurements + evidence (the getDpr detail). */
export interface DailyProgressReportDetail extends DailyProgressReportResponse {
  measurements: ProgressMeasurementResponse[];
  attachments: Array<{ id: string; platformFileId: string; createdBy: string }>;
}

/** A work-package row. Mirrors the Prisma model; move to @erp/types if the API adds a mapper. */
export interface WorkPackageResponse {
  id: string;
  projectId: string;
  code: string;
  name: string;
  responsibleOwner: string | null;
  /** Decimal string, 0..1. */
  progressWeight: string;
  createdBy: string;
  createdAt: string;
}

// ─── Daily Progress Reports ───────────────────────────────────────────────────────────────
export function listDprs(projectId: string): Promise<DailyProgressReportResponse[]> {
  return apiClient<DailyProgressReportResponse[]>(`/projects/${projectId}/progress/reports`);
}

export function createDpr(
  projectId: string,
  body: CreateDprBody,
): Promise<DailyProgressReportResponse> {
  return apiClient<DailyProgressReportResponse>(`/projects/${projectId}/progress/reports`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getDpr(dprId: string): Promise<DailyProgressReportDetail> {
  return apiClient<DailyProgressReportDetail>(`/progress/reports/${dprId}`);
}

export function addMeasurement(
  dprId: string,
  body: AddMeasurementBody,
): Promise<ProgressMeasurementResponse> {
  return apiClient<ProgressMeasurementResponse>(`/progress/reports/${dprId}/measurements`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Attach a READY PlatformFile as evidence (upload it via files-api first). */
export function attachEvidence(dprId: string, platformFileId: string): Promise<unknown> {
  return apiClient<unknown>(`/progress/reports/${dprId}/evidence`, {
    method: 'POST',
    body: JSON.stringify({ platformFileId }),
  });
}

export function submitDpr(dprId: string): Promise<DailyProgressReportResponse> {
  return apiClient<DailyProgressReportResponse>(`/progress/reports/${dprId}/submit`, {
    method: 'POST',
  });
}

export function approveDpr(dprId: string): Promise<DailyProgressReportResponse> {
  return apiClient<DailyProgressReportResponse>(`/progress/reports/${dprId}/approve`, {
    method: 'POST',
  });
}

export function returnDpr(dprId: string, reason: string): Promise<DailyProgressReportResponse> {
  return apiClient<DailyProgressReportResponse>(`/progress/reports/${dprId}/return`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

// ─── Verified progress + roll-up + signal (read models) ──────────────────────────────────
/** Verified physical % per BOQ leaf (approved DPRs only). */
export function getProjectProgress(projectId: string): Promise<ProjectProgressLine[]> {
  return apiClient<ProjectProgressLine[]>(`/projects/${projectId}/progress`);
}

/** Weighted project physical % (work-package roll-up). `weightsComplete` false ⇒ % understated. */
export function getProjectRollup(projectId: string): Promise<ProjectRollupResponse> {
  return apiClient<ProjectRollupResponse>(`/projects/${projectId}/progress/rollup`);
}

/** Physical-vs-financial early warning (built % vs cost consumed %). */
export function getPhysicalFinancialSignal(
  projectId: string,
): Promise<PhysicalFinancialSignalResponse> {
  return apiClient<PhysicalFinancialSignalResponse>(`/projects/${projectId}/progress/signal`);
}

/** Collection-vs-progress early warning (collected % vs built %). */
export function getCollectionProgressSignal(
  projectId: string,
): Promise<CollectionProgressSignalResponse> {
  return apiClient<CollectionProgressSignalResponse>(
    `/projects/${projectId}/progress/collection-signal`,
  );
}

// ─── Progress over time — snapshots + curve + period comparison (BE-1) ────────────────────
/** Optional capture body. `periodEndDate` defaults to today (server-side) when omitted. */
export interface CaptureProgressSnapshotBody {
  /** ISO date, YYYY-MM-DD. The "as of" period this reading is reported against. */
  periodEndDate?: string;
}

/**
 * Capture an immutable MANUAL progress snapshot, freezing the live physical/verified/cost
 * numbers at `periodEndDate`. Returns `409` when a snapshot already exists for that period
 * (one per project per period) — the caller surfaces that as a friendly message, not a crash.
 */
export function captureProgressSnapshot(
  projectId: string,
  body: CaptureProgressSnapshotBody,
): Promise<ProgressSnapshotResponse> {
  return apiClient<ProgressSnapshotResponse>(`/projects/${projectId}/progress/snapshots`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Planned-vs-actual S-curve + schedule status. Baseline is provisional (Option-C) for BE-1. */
export function getProgressCurve(projectId: string): Promise<ProgressCurveResponse> {
  return apiClient<ProgressCurveResponse>(`/projects/${projectId}/progress/curve`);
}

/** Overall period-over-period comparison from the two most-recent snapshots. */
export function getProgressPeriodComparison(
  projectId: string,
): Promise<ProgressPeriodComparisonResponse> {
  return apiClient<ProgressPeriodComparisonResponse>(
    `/projects/${projectId}/progress/period-comparison`,
  );
}

// ─── Planned baseline — the approved progress-target curve (CONST-PROG-011) ────────────────
/** One point on the planned-progress curve. */
export interface ProgressTargetItem {
  /** ISO date, YYYY-MM-DD. */
  targetDate: string;
  /** Cumulative planned %, 0..100. Non-decreasing over time. */
  cumulativePercent: number;
}

export function getProgressTargets(projectId: string): Promise<ProgressTargetItem[]> {
  return apiClient<ProgressTargetItem[]>(`/projects/${projectId}/programme/targets`);
}

/** Replace the whole baseline curve. Empty array clears it (the curve falls back to provisional). */
export function setProgressTargets(
  projectId: string,
  targets: ProgressTargetItem[],
): Promise<ProgressTargetItem[]> {
  return apiClient<ProgressTargetItem[]>(`/projects/${projectId}/programme/targets`, {
    method: 'PUT',
    body: JSON.stringify({ targets }),
  });
}

// ─── Work packages ────────────────────────────────────────────────────────────────────────
export function listWorkPackages(projectId: string): Promise<WorkPackageResponse[]> {
  return apiClient<WorkPackageResponse[]>(`/projects/${projectId}/work-packages`);
}

export function createWorkPackage(
  projectId: string,
  body: CreateWorkPackageBody,
): Promise<WorkPackageResponse> {
  return apiClient<WorkPackageResponse>(`/projects/${projectId}/work-packages`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Allocate a BOQ leaf to a work package. */
export function allocateBoqNode(workPackageId: string, boqNodeId: string): Promise<unknown> {
  return apiClient<unknown>(`/work-packages/${workPackageId}/boq-nodes`, {
    method: 'POST',
    body: JSON.stringify({ boqNodeId }),
  });
}

'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  CollectionProgressSignalResponse,
  DailyProgressReportResponse,
  PhysicalFinancialSignalResponse,
  ProgressCurveResponse,
  ProgressPeriodComparisonResponse,
  ProgressSnapshotResponse,
  ProjectProgressLine,
  ProjectRollupResponse,
} from '@erp/types';

import {
  addMeasurement,
  allocateBoqNode,
  approveDpr,
  attachEvidence,
  captureProgressSnapshot,
  createDpr,
  createWorkPackage,
  getCollectionProgressSignal,
  getDpr,
  getPhysicalFinancialSignal,
  getProgressCurve,
  getProgressPeriodComparison,
  getProgressTargets,
  getProjectProgress,
  getProjectRollup,
  listDprs,
  listWorkPackages,
  returnDpr,
  setProgressTargets,
  submitDpr,
  type AddMeasurementBody,
  type CaptureProgressSnapshotBody,
  type CreateDprBody,
  type CreateWorkPackageBody,
  type DailyProgressReportDetail,
  type ProgressTargetItem,
  type WorkPackageResponse,
} from '../api/progress-api';

export const progressKeys = {
  all: (projectId: string) => ['progress', projectId] as const,
  reports: (projectId: string) => [...progressKeys.all(projectId), 'reports'] as const,
  verified: (projectId: string) => [...progressKeys.all(projectId), 'verified'] as const,
  rollup: (projectId: string) => [...progressKeys.all(projectId), 'rollup'] as const,
  signal: (projectId: string) => [...progressKeys.all(projectId), 'signal'] as const,
  collectionSignal: (projectId: string) =>
    [...progressKeys.all(projectId), 'collection-signal'] as const,
  curve: (projectId: string) => [...progressKeys.all(projectId), 'curve'] as const,
  periodComparison: (projectId: string) =>
    [...progressKeys.all(projectId), 'period-comparison'] as const,
  targets: (projectId: string) => [...progressKeys.all(projectId), 'targets'] as const,
  workPackages: (projectId: string) => [...progressKeys.all(projectId), 'work-packages'] as const,
  /** A DPR detail is keyed by its own id, not the project. */
  report: (dprId: string) => ['progress-report', dprId] as const,
};

/**
 * Approving a DPR is what turns measurements into VERIFIED progress, so it changes the verified
 * lines, the roll-up and the physical-vs-financial signal — not just the report. This invalidates
 * the whole derived set for a project.
 */
function invalidateVerifiedDerived(queryClient: QueryClient, projectId: string): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: progressKeys.verified(projectId) }),
    queryClient.invalidateQueries({ queryKey: progressKeys.rollup(projectId) }),
    queryClient.invalidateQueries({ queryKey: progressKeys.signal(projectId) }),
    queryClient.invalidateQueries({ queryKey: progressKeys.collectionSignal(projectId) }),
  ]).then(() => undefined);
}

// ─── Queries ────────────────────────────────────────────────────────────────────────────
export function useDprs(projectId: string): UseQueryResult<DailyProgressReportResponse[], Error> {
  return useQuery({
    queryKey: progressKeys.reports(projectId),
    queryFn: () => listDprs(projectId),
    enabled: Boolean(projectId),
  });
}

export function useDpr(dprId: string): UseQueryResult<DailyProgressReportDetail, Error> {
  return useQuery({
    queryKey: progressKeys.report(dprId),
    queryFn: () => getDpr(dprId),
    enabled: Boolean(dprId),
  });
}

export function useProjectProgress(
  projectId: string,
): UseQueryResult<ProjectProgressLine[], Error> {
  return useQuery({
    queryKey: progressKeys.verified(projectId),
    queryFn: () => getProjectProgress(projectId),
    enabled: Boolean(projectId),
  });
}

export function useProjectRollup(projectId: string): UseQueryResult<ProjectRollupResponse, Error> {
  return useQuery({
    queryKey: progressKeys.rollup(projectId),
    queryFn: () => getProjectRollup(projectId),
    enabled: Boolean(projectId),
  });
}

export function usePhysicalFinancialSignal(
  projectId: string,
): UseQueryResult<PhysicalFinancialSignalResponse, Error> {
  return useQuery({
    queryKey: progressKeys.signal(projectId),
    queryFn: () => getPhysicalFinancialSignal(projectId),
    enabled: Boolean(projectId),
  });
}

export function useCollectionProgressSignal(
  projectId: string,
): UseQueryResult<CollectionProgressSignalResponse, Error> {
  return useQuery({
    queryKey: progressKeys.collectionSignal(projectId),
    queryFn: () => getCollectionProgressSignal(projectId),
    enabled: Boolean(projectId),
  });
}

export function useWorkPackages(
  projectId: string,
): UseQueryResult<WorkPackageResponse[], Error> {
  return useQuery({
    queryKey: progressKeys.workPackages(projectId),
    queryFn: () => listWorkPackages(projectId),
    enabled: Boolean(projectId),
  });
}

/** Planned-vs-actual S-curve + schedule status (Performance view). */
export function useProgressCurve(
  projectId: string,
): UseQueryResult<ProgressCurveResponse, Error> {
  return useQuery({
    queryKey: progressKeys.curve(projectId),
    queryFn: () => getProgressCurve(projectId),
    enabled: Boolean(projectId),
  });
}

/** Overall period-over-period comparison from the two most-recent snapshots (Verified view). */
export function useProgressPeriodComparison(
  projectId: string,
): UseQueryResult<ProgressPeriodComparisonResponse, Error> {
  return useQuery({
    queryKey: progressKeys.periodComparison(projectId),
    queryFn: () => getProgressPeriodComparison(projectId),
    enabled: Boolean(projectId),
  });
}

/** The approved planned-baseline target curve (CONST-PROG-011), for the Plan & Setup editor. */
export function useProgressTargets(projectId: string): UseQueryResult<ProgressTargetItem[], Error> {
  return useQuery({
    queryKey: progressKeys.targets(projectId),
    queryFn: () => getProgressTargets(projectId),
    enabled: Boolean(projectId),
  });
}

// ─── DPR mutations ────────────────────────────────────────────────────────────────────────
// Navigation is left to the caller (these return the created/updated report) so no UX/route
// decision is baked into the data layer.

export function useCreateDpr(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDprBody) => createDpr(projectId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: progressKeys.reports(projectId) });
    },
  });
}

export function useAddMeasurement(dprId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddMeasurementBody) => addMeasurement(dprId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) });
    },
  });
}

export function useAttachDprEvidence(dprId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (platformFileId: string) => attachEvidence(dprId, platformFileId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) });
    },
  });
}

export function useSubmitDpr(projectId: string, dprId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => submitDpr(dprId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) }),
        queryClient.invalidateQueries({ queryKey: progressKeys.reports(projectId) }),
      ]);
    },
  });
}

/** Approve verifies the report's measurements → also refresh verified progress, roll-up, signal. */
export function useApproveDpr(projectId: string, dprId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => approveDpr(dprId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) }),
        queryClient.invalidateQueries({ queryKey: progressKeys.reports(projectId) }),
        invalidateVerifiedDerived(queryClient, projectId),
      ]);
    },
  });
}

export function useReturnDpr(projectId: string, dprId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => returnDpr(dprId, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) }),
        queryClient.invalidateQueries({ queryKey: progressKeys.reports(projectId) }),
      ]);
    },
  });
}

// ─── Progress snapshot capture (BE-1) ────────────────────────────────────────────────────
/**
 * Capture a manual progress snapshot. Freezing today's numbers changes the S-curve and the
 * period comparison (and the roll-up/signal are the live figures the snapshot froze), so all
 * four are invalidated on success. A `409` (a snapshot already exists for the period) is left
 * for the caller to surface as a friendly message via `ApiError.status` — it is a normal
 * outcome ("already recorded"), not a failure to swallow here.
 */
export function useCaptureProgressSnapshot(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<ProgressSnapshotResponse, Error, CaptureProgressSnapshotBody>({
    mutationFn: (body: CaptureProgressSnapshotBody) => captureProgressSnapshot(projectId, body),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: progressKeys.curve(projectId) }),
        queryClient.invalidateQueries({ queryKey: progressKeys.periodComparison(projectId) }),
        queryClient.invalidateQueries({ queryKey: progressKeys.rollup(projectId) }),
        queryClient.invalidateQueries({ queryKey: progressKeys.signal(projectId) }),
      ]);
    },
  });
}

/**
 * Replace the baseline target curve. Setting a real baseline un-provisions the S-curve, so the curve
 * (and its schedule status/variance) is invalidated alongside the targets.
 */
export function useSetProgressTargets(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (targets: ProgressTargetItem[]) => setProgressTargets(projectId, targets),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: progressKeys.targets(projectId) }),
        queryClient.invalidateQueries({ queryKey: progressKeys.curve(projectId) }),
      ]);
    },
  });
}

// ─── Work-package mutations ──────────────────────────────────────────────────────────────
// Weights and allocations move the roll-up (and therefore the signal), so both are refreshed.

export function useCreateWorkPackage(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkPackageBody) => createWorkPackage(projectId, body),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: progressKeys.workPackages(projectId) }),
        invalidateVerifiedDerived(queryClient, projectId),
      ]);
    },
  });
}

export function useAllocateBoqNode(projectId: string, workPackageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (boqNodeId: string) => allocateBoqNode(workPackageId, boqNodeId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: progressKeys.workPackages(projectId) }),
        invalidateVerifiedDerived(queryClient, projectId),
      ]);
    },
  });
}

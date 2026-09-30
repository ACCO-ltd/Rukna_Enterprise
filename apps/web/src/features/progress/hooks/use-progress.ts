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
  ProgrammeBaselineResponse,
  ProgressCurveResponse,
  ProgressPeriodComparisonResponse,
  ProgressSnapshotResponse,
  ProjectProgressLine,
  ProjectRollupResponse,
} from '@erp/types';

import {
  addMeasurement,
  weighProposedPackages,
  allocateBoqNode,
  approveDpr,
  approveProgrammeBaseline,
  attachEvidence,
  captureProgressSnapshot,
  createDpr,
  createWorkPackage,
  getCollectionProgressSignal,
  getDpr,
  getPhysicalFinancialSignal,
  getProgrammeBaseline,
  getProgressCurve,
  getProgressPeriodComparison,
  getProgressTargets,
  getProjectProgress,
  getProjectRollup,
  listDprs,
  listWorkPackages,
  rebaselineProgramme,
  removeMeasurement,
  returnDpr,
  saveDeliveryPlan,
  setProgressTargets,
  submitDpr,
  patchDprContext,
  addLabourRow,
  removeLabourRow,
  addEquipmentRow,
  removeEquipmentRow,
  addObservation,
  removeObservation,
  type AddMeasurementBody,
  type CaptureProgressSnapshotBody,
  type CreateDprBody,
  type CreateWorkPackageBody,
  type DailyProgressReportDetail,
  type PatchDprContextBody,
  type AddLabourRowBody,
  type AddEquipmentRowBody,
  type AddObservationBody,
  type ProgressTargetItem,
  type RebaselineBody,
  type SaveDeliveryPlanBody,
  type SaveDeliveryPlanResponse,
  type WorkPackageResponse,
} from '../api/progress-api';
import { programmeKeys } from '@/features/programme/hooks/programme-keys';
import { formatDate } from '@/lib/format';
import type { MutationFeedbackMeta } from '@/lib/mutation-feedback';

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
  baseline: (projectId: string) => [...progressKeys.all(projectId), 'baseline'] as const,
  workPackages: (projectId: string) => [...progressKeys.all(projectId), 'work-packages'] as const,
  proposedWeights: (projectId: string, grouping: string) =>
    [...progressKeys.all(projectId), 'proposed-weights', grouping] as const,
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

/** "Daily report for 30 Sep 2026 …" — a DPR has no number of its own; its date names it. */
function dprToast(key: string): MutationFeedbackMeta {
  return {
    successToast: {
      key,
      values: (data) => {
        const reportDate = (data as DailyProgressReportResponse).reportDate;
        return { date: formatDate(reportDate) ?? reportDate };
      },
    },
  };
}

/**
 * A row edit inside an open report. `silent` is for a caller that runs it as one step of a larger
 * save (the entry dialog's Save/Submit flushes typed rows first) and confirms the whole save itself.
 */
export interface RowEditOptions {
  silent?: boolean;
}

function rowToast(key: string, options: RowEditOptions = {}): MutationFeedbackMeta | undefined {
  // The row appears in (or leaves) the open report; there is no list row to tint.
  return options.silent ? undefined : { successToast: key, flashRow: false };
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

/**
 * The governing programme baseline (Master Schedule P3, ADR-029). `null` — not an error — is the
 * "no baseline approved yet" state the Plan & Setup card renders. Distinct from `useProgressTargets`:
 * that is the editable working curve; this is the frozen snapshot that drives variance.
 */
export function useProgrammeBaseline(
  projectId: string,
): UseQueryResult<ProgrammeBaselineResponse | null, Error> {
  return useQuery({
    queryKey: progressKeys.baseline(projectId),
    queryFn: () => getProgrammeBaseline(projectId),
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
    meta: dprToast('progress.feedback.dprStarted'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: progressKeys.reports(projectId) });
    },
  });
}

export function useAddMeasurement(dprId: string, options: RowEditOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddMeasurementBody) => addMeasurement(dprId, body),
    meta: rowToast('progress.feedback.quantityRecorded', options),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) });
    },
  });
}

/** Remove a measurement from an editable report. The report and the roll-up both move. */
export function useRemoveMeasurement(projectId: string, dprId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (measurementId: string) => removeMeasurement(dprId, measurementId),
    meta: rowToast('progress.feedback.quantityRemoved'),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) }),
        queryClient.invalidateQueries({ queryKey: progressKeys.rollup(projectId) }),
      ]);
    },
  });
}

export function useAttachDprEvidence(dprId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ platformFileId, measurementId }: { platformFileId: string; measurementId?: string }) =>
      attachEvidence(dprId, platformFileId, measurementId),
    meta: rowToast('progress.feedback.evidenceAttached'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) });
    },
  });
}

export function useSubmitDpr(projectId: string, dprId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => submitDpr(dprId),
    meta: dprToast('progress.feedback.dprSubmitted'),
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
    meta: dprToast('progress.feedback.dprApproved'),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) }),
        queryClient.invalidateQueries({ queryKey: progressKeys.reports(projectId) }),
        invalidateVerifiedDerived(queryClient, projectId),
        // Verified quantities move package %, and with it a milestone's readyToVerify.
        queryClient.invalidateQueries({ queryKey: programmeKeys.milestones(projectId) }),
      ]);
    },
  });
}

export function useReturnDpr(projectId: string, dprId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => returnDpr(dprId, reason),
    meta: dprToast('progress.feedback.dprReturned'),
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
    meta: { successToast: 'progress.feedback.snapshotCaptured', flashRow: false },
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
    meta: { successToast: 'progress.feedback.targetsSaved', flashRow: false },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: progressKeys.targets(projectId) }),
        queryClient.invalidateQueries({ queryKey: progressKeys.curve(projectId) }),
      ]);
    },
  });
}

// ─── Programme baseline freeze (Master Schedule P3, ADR-029) ───────────────────────────────
/**
 * Publishing a governing baseline re-anchors what actuals are measured against, so it moves the
 * baseline record, the S-curve (its `baselineSource`/`baselineVersion` and drawn planned line) and
 * the variance-bearing reads. Both approve (v1) and re-baseline (v2+) invalidate the same set.
 */
function invalidateBaselineDerived(
  queryClient: QueryClient,
  projectId: string,
): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: progressKeys.baseline(projectId) }),
    queryClient.invalidateQueries({ queryKey: progressKeys.curve(projectId) }),
    invalidateVerifiedDerived(queryClient, projectId),
  ]).then(() => undefined);
}

/** Approve the initial governing baseline (v1). PM act (`manage:project`). */
export function useApproveBaseline(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<ProgrammeBaselineResponse, Error, void>({
    mutationFn: () => approveProgrammeBaseline(projectId),
    meta: {
      successToast: {
        key: 'progress.feedback.baselineLocked',
        values: (data) => ({ version: (data as ProgrammeBaselineResponse).version }),
      },
      flashRow: false,
    },
    onSuccess: () => invalidateBaselineDerived(queryClient, projectId),
  });
}

/** Re-baseline (v2+), citing a Variation. Senior/governed act (`approve:project`). */
export function useRebaseline(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation<ProgrammeBaselineResponse, Error, RebaselineBody>({
    mutationFn: (body: RebaselineBody) => rebaselineProgramme(projectId, body),
    meta: {
      successToast: {
        key: 'progress.feedback.rebaselined',
        values: (data) => ({ version: (data as ProgrammeBaselineResponse).version }),
      },
      flashRow: false,
    },
    onSuccess: () => invalidateBaselineDerived(queryClient, projectId),
  });
}

// ─── Work-package mutations ──────────────────────────────────────────────────────────────
// Weights and allocations move the roll-up (and therefore the signal), so both are refreshed.

export function useCreateWorkPackage(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkPackageBody) => createWorkPackage(projectId, body),
    meta: {
      successToast: {
        key: 'progress.feedback.workPackageCreated',
        values: (data) => ({ name: (data as WorkPackageResponse).name }),
      },
    },
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
    meta: { successToast: 'progress.feedback.scopeAllocated', flashRow: () => workPackageId },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: progressKeys.workPackages(projectId) }),
        invalidateVerifiedDerived(queryClient, projectId),
      ]);
    },
  });
}

/** Saves a reviewed Delivery Plan — every package + its leaf allocations, created atomically. */
/**
 * Server-side value weights for the Delivery Plan's proposed grouping. `packages` should already be
 * debounced by the caller — each change of grouping is a request. Disabled while empty.
 */
export function useProposedPackageWeights(
  projectId: string,
  packages: { key: string; boqNodeIds: string[] }[],
  enabled: boolean,
) {
  const grouping = JSON.stringify(packages);
  return useQuery({
    queryKey: progressKeys.proposedWeights(projectId, grouping),
    queryFn: () => weighProposedPackages(projectId, { packages }),
    enabled: enabled && packages.length > 0,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}

export function useSaveDeliveryPlan(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveDeliveryPlanBody) => saveDeliveryPlan(projectId, body),
    meta: {
      successToast: {
        key: 'progress.feedback.deliveryPlanSaved',
        values: (data) => ({ count: (data as SaveDeliveryPlanResponse).packages.length }),
      },
      flashRow: false,
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: progressKeys.workPackages(projectId) }),
        invalidateVerifiedDerived(queryClient, projectId),
      ]);
    },
  });
}

/**
 * Allocate a BOQ leaf to any work package (the target is chosen per call, not fixed at hook time).
 * The guided schedule wizard assigns scope across several phases from one surface, so it needs to
 * name the work package in the mutation rather than bind one hook per package.
 *
 * No success toast: in the wizard each pick is an inline edit that shows up in place at once.
 */
export function useAllocateToWorkPackage(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workPackageId, boqNodeId }: { workPackageId: string; boqNodeId: string }) =>
      allocateBoqNode(workPackageId, boqNodeId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: progressKeys.workPackages(projectId) }),
        invalidateVerifiedDerived(queryClient, projectId),
      ]);
    },
  });
}

// ─── Phase 3: structured DPR row mutations ────────────────────────────────────────────────

export function usePatchDprContext(dprId: string, options: RowEditOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PatchDprContextBody) => patchDprContext(dprId, body),
    meta: rowToast('progress.feedback.detailsSaved', options),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) });
    },
  });
}

export function useAddLabourRow(dprId: string, options: RowEditOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddLabourRowBody) => addLabourRow(dprId, body),
    meta: rowToast('progress.feedback.labourAdded', options),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) });
    },
  });
}

export function useRemoveLabourRow(dprId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rowId: string) => removeLabourRow(dprId, rowId),
    meta: rowToast('progress.feedback.labourRemoved'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) });
    },
  });
}

export function useAddEquipmentRow(dprId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddEquipmentRowBody) => addEquipmentRow(dprId, body),
    meta: rowToast('progress.feedback.equipmentAdded'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) });
    },
  });
}

export function useRemoveEquipmentRow(dprId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rowId: string) => removeEquipmentRow(dprId, rowId),
    meta: rowToast('progress.feedback.equipmentRemoved'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) });
    },
  });
}

export function useAddObservation(dprId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddObservationBody) => addObservation(dprId, body),
    meta: rowToast('progress.feedback.observationAdded'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) });
    },
  });
}

export function useRemoveObservation(dprId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (obsId: string) => removeObservation(dprId, obsId),
    meta: rowToast('progress.feedback.observationRemoved'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: progressKeys.report(dprId) });
    },
  });
}

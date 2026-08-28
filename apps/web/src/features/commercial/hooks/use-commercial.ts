'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  AtRiskCommencementResponse,
  CertifiedInvoicedByVariationResponse,
  CommercialApplicationsResponse,
  CommercialCurrentCycleResponse,
  CommercialSummaryResponse,
  ExtensionOfTimeListResponse,
  GrantExtensionOfTimeRequest,
  RecordAtRiskCommencementRequest,
  VariationOrderListResponse,
  VariationOrderResponse,
} from '@erp/types';

import {
  addVariationLine,
  clientApproveVariation,
  createVariation,
  getCertifiedInvoicedByVariation,
  getCommercialApplications,
  getCommercialCurrentCycle,
  getCommercialSummary,
  getVariation,
  grantExtensionOfTime,
  internalApproveVariation,
  listAtRiskCommencements,
  listExtensionsOfTime,
  listVariations,
  recordAtRiskCommencement,
  rejectVariation,
  removeVariationLine,
  submitVariation,
  updateVariationLine,
  withdrawVariation,
  type ClientApproveVariationPayload,
  type CreateVariationPayload,
  type UpdateVariationLinePayload,
  type VariationLinePayload,
} from '../api/commercial-api';

export const commercialKeys = {
  all: (projectId: string) => ['commercial', projectId] as const,
  summary: (projectId: string) => [...commercialKeys.all(projectId), 'summary'] as const,
  applications: (projectId: string) => [...commercialKeys.all(projectId), 'applications'] as const,
  currentCycle: (projectId: string) => [...commercialKeys.all(projectId), 'current-cycle'] as const,
};

/** Variations are contract-scoped, so their cache is keyed by contract, not project. */
export const variationKeys = {
  all: ['variations'] as const,
  list: (contractId: string) => [...variationKeys.all, 'list', contractId] as const,
  detail: (id: string) => [...variationKeys.all, 'detail', id] as const,
  extensions: (contractId: string) => [...variationKeys.all, 'eot', contractId] as const,
  /** Certified/invoiced trace is contract-scoped (base + per-VO). */
  certifiedInvoiced: (contractId: string) =>
    [...variationKeys.all, 'certified-invoiced', contractId] as const,
  /** At-risk authorisations are VO-scoped (list per variation). */
  atRisk: (variationId: string) => [...variationKeys.all, 'at-risk', variationId] as const,
};

/**
 * The commercial summary read model. A project with no main contract is not an error here —
 * the server answers with `mainContract: null` and `UNAVAILABLE` metrics, which is the
 * "no contract yet" state the workspace renders rather than a failure.
 */
export function useCommercialSummary(
  projectId: string,
): UseQueryResult<CommercialSummaryResponse, Error> {
  return useQuery({
    queryKey: commercialKeys.summary(projectId),
    queryFn: () => getCommercialSummary(projectId),
  });
}

export function useCommercialCurrentCycle(
  projectId: string,
): UseQueryResult<CommercialCurrentCycleResponse, Error> {
  return useQuery({
    queryKey: commercialKeys.currentCycle(projectId),
    queryFn: () => getCommercialCurrentCycle(projectId),
  });
}

export function useCommercialApplications(
  projectId: string,
): UseQueryResult<CommercialApplicationsResponse, Error> {
  return useQuery({
    queryKey: commercialKeys.applications(projectId),
    queryFn: () => getCommercialApplications(projectId),
  });
}

// ─── Variations (ADR-026 Phase 1) ───────────────────────────────────────────────

export function useVariations(
  contractId: string | null | undefined,
): UseQueryResult<VariationOrderListResponse, Error> {
  return useQuery({
    queryKey: variationKeys.list(contractId ?? 'none'),
    queryFn: () => listVariations(contractId as string),
    enabled: Boolean(contractId),
  });
}

export function useVariation(
  id: string | null | undefined,
): UseQueryResult<VariationOrderResponse, Error> {
  return useQuery({
    queryKey: variationKeys.detail(id ?? 'none'),
    queryFn: () => getVariation(id as string),
    enabled: Boolean(id),
  });
}

/**
 * The certified/invoiced-by-variation read model (Phase 3, CONST-VAR-008). Contract-scoped, and
 * `enabled` only when there is a contract. The server nulls every money field when the caller lacks
 * `financialPositionView` (`canViewFinancials === false`) — the UI renders that as RESTRICTED, never
 * as `$0`. It re-reads whenever a VO mutation invalidates `variationKeys.all`, so the trace moves
 * with the lifecycle without a manual reload.
 */
export function useCertifiedInvoicedByVariation(
  contractId: string | null | undefined,
): UseQueryResult<CertifiedInvoicedByVariationResponse, Error> {
  return useQuery({
    queryKey: variationKeys.certifiedInvoiced(contractId ?? 'none'),
    queryFn: () => getCertifiedInvoicedByVariation(contractId as string),
    enabled: Boolean(contractId),
  });
}

/** At-risk commencement authorisations recorded on a VO (newest first). */
export function useAtRiskCommencements(
  variationId: string | null | undefined,
): UseQueryResult<AtRiskCommencementResponse[], Error> {
  return useQuery({
    queryKey: variationKeys.atRisk(variationId ?? 'none'),
    queryFn: () => listAtRiskCommencements(variationId as string),
    enabled: Boolean(variationId),
  });
}

export function useExtensionsOfTime(
  contractId: string | null | undefined,
): UseQueryResult<ExtensionOfTimeListResponse, Error> {
  return useQuery({
    queryKey: variationKeys.extensions(contractId ?? 'none'),
    queryFn: () => listExtensionsOfTime(contractId as string),
    enabled: Boolean(contractId),
  });
}

/**
 * Every variation mutation moves at least one derived figure the user can see: the VO's own net
 * price/status and the contract's Original/Approved/Governing/Pending value on the commercial
 * summary. So each one invalidates the variations cache (list + detail) AND the project's
 * commercial summary — the header refreshes without a manual reload. Contract-scoped list and
 * project-scoped summary are separate cache trees, which is why both ids are threaded through.
 */
function useVariationMutation<TArgs, TResult>(
  contractId: string,
  projectId: string,
  run: (args: TArgs) => Promise<TResult>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: variationKeys.all }),
        qc.invalidateQueries({ queryKey: commercialKeys.summary(projectId) }),
      ]);
    },
  });
}

export function useCreateVariation(contractId: string, projectId: string) {
  return useVariationMutation(contractId, projectId, (payload: CreateVariationPayload) =>
    createVariation(contractId, payload),
  );
}

export function useAddVariationLine(variationId: string, contractId: string, projectId: string) {
  return useVariationMutation(
    contractId,
    projectId,
    (payload: VariationLinePayload & { sortOrder?: number }) =>
      addVariationLine(variationId, payload),
  );
}

export function useUpdateVariationLine(variationId: string, contractId: string, projectId: string) {
  return useVariationMutation(
    contractId,
    projectId,
    ({ lineId, payload }: { lineId: string; payload: UpdateVariationLinePayload }) =>
      updateVariationLine(variationId, lineId, payload),
  );
}

export function useRemoveVariationLine(variationId: string, contractId: string, projectId: string) {
  return useVariationMutation(contractId, projectId, (lineId: string) =>
    removeVariationLine(variationId, lineId),
  );
}

export function useSubmitVariation(variationId: string, contractId: string, projectId: string) {
  return useVariationMutation(contractId, projectId, () => submitVariation(variationId));
}

export function useInternalApproveVariation(
  variationId: string,
  contractId: string,
  projectId: string,
) {
  return useVariationMutation(contractId, projectId, () => internalApproveVariation(variationId));
}

export function useClientApproveVariation(
  variationId: string,
  contractId: string,
  projectId: string,
) {
  return useVariationMutation(contractId, projectId, (payload: ClientApproveVariationPayload) =>
    clientApproveVariation(variationId, payload),
  );
}

export function useRejectVariation(variationId: string, contractId: string, projectId: string) {
  return useVariationMutation(contractId, projectId, (reason: string) =>
    rejectVariation(variationId, reason),
  );
}

export function useWithdrawVariation(variationId: string, contractId: string, projectId: string) {
  return useVariationMutation(contractId, projectId, (reason?: string) =>
    withdrawVariation(variationId, reason),
  );
}

/**
 * Records an at-risk commencement (Phase 5, Route 7B). Reuses `useVariationMutation` so it
 * invalidates `variationKeys.all` (which covers the VO-scoped at-risk list key) AND the project
 * commercial summary. The cap rule is enforced server-side: this hook carries the payload and
 * surfaces the server's 400/403 to the caller's `onError` — it re-implements no rule.
 */
export function useRecordAtRiskCommencement(
  variationId: string,
  contractId: string,
  projectId: string,
) {
  return useVariationMutation(contractId, projectId, (payload: RecordAtRiskCommencementRequest) =>
    recordAtRiskCommencement(variationId, payload),
  );
}

export function useGrantExtensionOfTime(contractId: string, projectId: string) {
  return useVariationMutation(contractId, projectId, (payload: GrantExtensionOfTimeRequest) =>
    grantExtensionOfTime(contractId, payload),
  );
}

'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  CertifiedInvoicedByVariationResponse,
  CommercialApplicationsResponse,
  CommercialBillingResponse,
  CommercialBillingPackagesResponse,
  CommercialCurrentCycleResponse,
  CommercialOverviewResponse,
  CommercialSummaryResponse,
  DepositAccountOption,
  ExtensionOfTimeListResponse,
  GrantExtensionOfTimeRequest,
  RecordProjectPaymentResult,
  VariationOrderListResponse,
  VariationOrderResponse,
} from '@erp/types';

import { boqKeys } from '@/features/boq/hooks/use-boq';

import {
  addVariationLine,
  getCertifiedInvoicedByVariation,
  getCommercialApplications,
  getCommercialBilling,
  getCommercialBillingPackages,
  getCommercialCurrentCycle,
  getCommercialOverview,
  getCommercialSummary,
  getProjectDepositAccounts,
  getVariation,
  grantExtensionOfTime,
  listExtensionsOfTime,
  listVariations,
  recordProjectPayment,
  removeVariationLine,
  reverseVariation,
  updateVariationLine,
  type RecordProjectPaymentPayload,
  type UpdateVariationLinePayload,
  type VariationLinePayload,
} from '../api/commercial-api';

export const commercialKeys = {
  all: (projectId: string) => ['commercial', projectId] as const,
  overview: (projectId: string) => [...commercialKeys.all(projectId), 'overview'] as const,
  summary: (projectId: string) => [...commercialKeys.all(projectId), 'summary'] as const,
  applications: (projectId: string) => [...commercialKeys.all(projectId), 'applications'] as const,
  currentCycle: (projectId: string) => [...commercialKeys.all(projectId), 'current-cycle'] as const,
  billing: (projectId: string) => [...commercialKeys.all(projectId), 'billing'] as const,
  /** Grouped stage-billing story (S-VB-7), contract-scoped under the project's commercial tree. */
  billingPackages: (projectId: string, contractId: string) =>
    [...commercialKeys.all(projectId), 'billing-packages', contractId] as const,
  depositAccounts: (projectId: string) =>
    [...commercialKeys.all(projectId), 'deposit-accounts'] as const,
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
};

/** Slice 7 — authoritative commercial overview. Includes financial position, current cycle, and attention items. */
export function useCommercialOverview(
  projectId: string,
): UseQueryResult<CommercialOverviewResponse, Error> {
  return useQuery({
    queryKey: commercialKeys.overview(projectId),
    queryFn: () => getCommercialOverview(projectId),
  });
}

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

/**
 * The project's billing position. Separate from the summary because Billing & Collection is the
 * only screen that needs invoice-by-invoice and receipt-by-receipt detail — loading it on every
 * commercial tab would make Overview pay for a table nobody is looking at.
 */
export function useCommercialBilling(
  projectId: string,
): UseQueryResult<CommercialBillingResponse, Error> {
  return useQuery({
    queryKey: commercialKeys.billing(projectId),
    queryFn: () => getCommercialBilling(projectId),
  });
}

/**
 * The grouped stage-billing story (S-VB-7). Contract-scoped and `enabled` only when there is a
 * contract, so a project with no main contract does not fire a call with an empty id. Feeds the
 * "invoiced?" chip on Variations, the Billing Package view, and the eligible-VO exclusion set in
 * the "Bill this stage" dialog — one read, three consumers, one cache entry. Money fields are
 * nulled server-side (`financialsVisible === false`) for a withheld-money role.
 */
export function useBillingPackages(
  projectId: string,
  contractId: string | null | undefined,
): UseQueryResult<CommercialBillingPackagesResponse, Error> {
  return useQuery({
    queryKey: commercialKeys.billingPackages(projectId, contractId ?? 'none'),
    queryFn: () => getCommercialBillingPackages(projectId, contractId as string),
    enabled: Boolean(projectId) && Boolean(contractId),
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

/**
 * Reverse (un-adopt) an adopted variation (variation-collapse). Un-adopting lowers the contract
 * value AND removes the variation's scope from the BOQ, so this invalidates three cache trees the
 * user can see move: the variations list/detail (`variationKeys.all`), the project commercial
 * summary (the contract-value band), and the project's BOQ workspace (`boqKeys.all` — the money band
 * and tree). The "is this reversible?" rule is server-side (a 409 otherwise), surfaced to `onError`.
 */
export function useReverseVariation(variationId: string, contractId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { reason?: string } = {}) => reverseVariation(variationId, payload),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: variationKeys.all }),
        qc.invalidateQueries({ queryKey: commercialKeys.summary(projectId) }),
        qc.invalidateQueries({ queryKey: boqKeys.all(projectId) }),
      ]);
    },
  });
}

export function useGrantExtensionOfTime(contractId: string, projectId: string) {
  return useVariationMutation(contractId, projectId, (payload: GrantExtensionOfTimeRequest) =>
    grantExtensionOfTime(contractId, payload),
  );
}

// ─── Slice 5B — Deposit accounts + record payment ───────────────────────────

export function useProjectDepositAccounts(
  projectId: string,
): UseQueryResult<DepositAccountOption[], Error> {
  return useQuery({
    queryKey: commercialKeys.depositAccounts(projectId),
    queryFn: () => getProjectDepositAccounts(projectId),
  });
}

export function useRecordProjectPayment(projectId: string) {
  const qc = useQueryClient();
  return useMutation<RecordProjectPaymentResult, Error, RecordProjectPaymentPayload>({
    mutationFn: (payload) => recordProjectPayment(projectId, payload),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: commercialKeys.billing(projectId) });
    },
  });
}

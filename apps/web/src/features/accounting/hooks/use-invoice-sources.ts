'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  CommercialApplicationsResponse,
  CommercialCurrentCycleResponse,
  CommercialSummaryResponse,
  SeparateChargesResponse,
} from '@erp/types';

import {
  getCommercialApplications,
  getCommercialCurrentCycle,
  getCommercialSummary,
  getProjectSeparateCharges,
} from '@/features/commercial/api/commercial-api';
import { commercialKeys } from '@/features/commercial/hooks/use-commercial';

/**
 * ─── What can be invoiced on a project (New invoice source picker, ADR-037) ─────
 *
 * A client invoice is source-bound: it is raised from a certified IPC, a billing milestone or a
 * SEPARATE_CHARGE BOQ leaf, and its amount is copied from that source (ADR-029 CONST-BOQ-030/033).
 * There is no "billable sources" endpoint, so each list is read from the commercial read model
 * that already answers the question for that source:
 *
 *   - IPC             → `GET /projects/:id/commercial/applications` — rows whose effective
 *                       certificate has no invoice yet (`ipcId` set, `invoiceId` null).
 *   - INSTALLMENT     → `GET /projects/:id/commercial/current-cycle` → `paymentSchedule` —
 *                       installments the server says may be invoiced now (`canPrepareInvoice`:
 *                       NEXT, marked ready to bill, no outstanding invoice). The ready-to-bill
 *                       gate is the server's verdict; this never re-derives it.
 *   - SEPARATE_CHARGE → `GET /projects/:id/commercial/separate-charges` — BOQ-leaf items with
 *                       no invoice yet. (VARIATION items are always already invoiced.)
 *
 * The queries reuse the commercial workspace's fetchers and cache keys, so a list read here and
 * on the project's Commercial tab is one cache entry. Each is `enabled` only for the chosen
 * source kind and project, so choosing "IPC" never fetches the payment schedule.
 */

export type InvoiceSourceKind = 'IPC' | 'INSTALLMENT' | 'SEPARATE_CHARGE';

export const INVOICE_SOURCE_KINDS: readonly InvoiceSourceKind[] = [
  'IPC',
  'INSTALLMENT',
  'SEPARATE_CHARGE',
];

/** One billable source, already shaped for the picker and the read-only invoice line. */
export interface InvoiceSourceOption {
  /** The id the create endpoint takes: `ipcId`, `installmentId` or `boqNodeId`. */
  id: string;
  /** What the source is called, without the amount. */
  reference: string;
  /** Quiet trailing text in the picker — a code or a percentage. */
  hint?: string;
  /** The subtotal the server will bill. Null when withheld from this role. */
  amount: string | null;
  currency: string | null;
}

export function useProjectCommercialSummary(
  projectId: string,
): UseQueryResult<CommercialSummaryResponse, Error> {
  return useQuery({
    queryKey: commercialKeys.summary(projectId),
    queryFn: () => getCommercialSummary(projectId),
    enabled: Boolean(projectId),
  });
}

function useApplications(projectId: string, enabled: boolean) {
  return useQuery<CommercialApplicationsResponse, Error>({
    queryKey: commercialKeys.applications(projectId),
    queryFn: () => getCommercialApplications(projectId),
    enabled: enabled && Boolean(projectId),
  });
}

function useCurrentCycle(projectId: string, enabled: boolean) {
  return useQuery<CommercialCurrentCycleResponse, Error>({
    queryKey: commercialKeys.currentCycle(projectId),
    queryFn: () => getCommercialCurrentCycle(projectId),
    enabled: enabled && Boolean(projectId),
  });
}

function useSeparateCharges(projectId: string, enabled: boolean) {
  return useQuery<SeparateChargesResponse, Error>({
    queryKey: commercialKeys.separateCharges(projectId),
    queryFn: () => getProjectSeparateCharges(projectId),
    enabled: enabled && Boolean(projectId),
  });
}

/** IPCs with an effective certificate and no invoice. The invoice bills the certified total. */
export function billableIpcs(
  data: CommercialApplicationsResponse | undefined,
  currency: string | null,
  applicationLabel: (row: { applicationRef: string | null; applicationNumber: number | null }) => string,
): InvoiceSourceOption[] {
  return (data?.applications ?? [])
    .filter((row) => row.ipcId !== null && row.invoiceId === null)
    .map((row) => ({
      id: row.ipcId as string,
      reference: applicationLabel(row),
      // `generateFromIpc` bills `certifiedTotal`, which the read model reports as certifiedGross.
      amount: row.certifiedGross,
      currency,
    }));
}

/** Installments the server allows to be invoiced now (ready to bill, NEXT, nothing outstanding). */
export function billableInstallments(
  data: CommercialCurrentCycleResponse | undefined,
): InvoiceSourceOption[] {
  const schedule = data?.paymentSchedule ?? null;
  if (!schedule) return [];
  return [...schedule.installments]
    .filter((installment) => installment.canPrepareInvoice)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((installment) => ({
      id: installment.id,
      reference: installment.name,
      hint: formatPercent(installment.percentage),
      amount: installment.amount,
      currency: schedule.currency,
    }));
}

/** SEPARATE_CHARGE BOQ leaves with no invoice yet. */
export function billableSeparateCharges(
  data: SeparateChargesResponse | undefined,
): InvoiceSourceOption[] {
  return (data?.items ?? []).flatMap((item) =>
    item.source === 'BOQ_LEAF' && item.invoice === null
      ? [
          {
            id: item.id,
            reference: item.name,
            hint: item.code,
            amount: item.totalAmount,
            currency: item.currency,
          },
        ]
      : [],
  );
}

export interface InvoiceSourcesResult {
  options: InvoiceSourceOption[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  /** The raw payment schedule — the milestone path hands it to the prepare-invoice dialog. */
  currentCycle: CommercialCurrentCycleResponse | undefined;
}

/**
 * The billable sources of one kind on one project. `kind` / `projectId` empty → nothing fetched.
 */
export function useInvoiceSources(
  kind: InvoiceSourceKind | '',
  projectId: string,
  currency: string | null,
  applicationLabel: (row: { applicationRef: string | null; applicationNumber: number | null }) => string,
): InvoiceSourcesResult {
  const applications = useApplications(projectId, kind === 'IPC');
  const cycle = useCurrentCycle(projectId, kind === 'INSTALLMENT');
  const charges = useSeparateCharges(projectId, kind === 'SEPARATE_CHARGE');

  const active =
    kind === 'IPC' ? applications : kind === 'INSTALLMENT' ? cycle : kind === 'SEPARATE_CHARGE' ? charges : null;

  const options =
    kind === 'IPC'
      ? billableIpcs(applications.data, currency, applicationLabel)
      : kind === 'INSTALLMENT'
        ? billableInstallments(cycle.data)
        : kind === 'SEPARATE_CHARGE'
          ? billableSeparateCharges(charges.data)
          : [];

  return {
    options,
    isLoading: Boolean(active && projectId && active.isPending),
    isError: Boolean(active?.isError),
    refetch: () => void active?.refetch(),
    currentCycle: cycle.data,
  };
}

function formatPercent(fraction: string): string {
  const n = Number(fraction);
  if (!Number.isFinite(n)) return fraction;
  return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 }).format(n);
}

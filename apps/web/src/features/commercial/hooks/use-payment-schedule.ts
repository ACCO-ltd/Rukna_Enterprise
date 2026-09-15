'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { generateInvoiceFromInstallment } from '@/features/accounting/api/invoices-api';
import { invoiceKeys } from '@/features/accounting/hooks/use-invoices';
import { setInstallmentMilestone } from '@/features/contracts/api/contracts-api';
import type { GenerateInvoiceFromInstallmentPayload } from '@/features/accounting/types';

import { billStage, type BillStagePayload } from '../api/commercial-api';
import { commercialKeys, variationKeys } from './use-commercial';

/**
 * ADR-023 payment-schedule mutations, scoped to the commercial workspace.
 *
 * Both mutations move the commercial read models (the cycle's payment schedule and the summary),
 * so they invalidate `commercialKeys.all(projectId)`. Generating an invoice also touches the AR
 * invoice lists, so it additionally invalidates `invoiceKeys.all`.
 */

/** Raise a client invoice from a payment installment (surfaces the CONST-COM-011 gate on 400). */
export function useGenerateInvoiceFromInstallment(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: GenerateInvoiceFromInstallmentPayload) =>
      generateInvoiceFromInstallment(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: commercialKeys.all(projectId) });
      void qc.invalidateQueries({ queryKey: invoiceKeys.all });
    },
  });
}

/**
 * Bill a milestone stage plus its included variations in one command (ADR-030 CD10 / C5–C6).
 *
 * The command moves four surfaces the user is looking at: the payment schedule (a stage becomes
 * billed), the current cycle (the ribbon advances), the Billing Packages (a new grouped package),
 * and every variation's "invoiced?" chip. `commercialKeys.all(projectId)` is the whole project
 * commercial tree — billing, current-cycle, summary AND billing-packages all sit under it, so one
 * invalidate refreshes them together; `variationKeys.all` is a separate (contract-scoped) tree, so
 * it is invalidated on its own for the chip to flip. The server owns every money rule and returns
 * the already-invoiced/credit-note 400 verbatim — this hook surfaces it to the caller's `onError`.
 */
export function useBillStage(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: BillStagePayload) => billStage(projectId, payload),
    onSuccess: async () => {
      await Promise.all([
        // Covers billing, current-cycle, summary AND billing-packages (all under this prefix).
        qc.invalidateQueries({ queryKey: commercialKeys.all(projectId) }),
        // Separate tree: the variation list + each VO's "invoiced?" chip.
        qc.invalidateQueries({ queryKey: variationKeys.all }),
        // The AR invoice lists gain the freshly-drafted milestone/VO invoices.
        qc.invalidateQueries({ queryKey: invoiceKeys.all }),
      ]);
    },
  });
}

/** Link (or unlink, with null) a programme milestone as an installment's billing evidence. */
export function useSetInstallmentMilestone(projectId: string, contractId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      installmentId,
      programmeMilestoneId,
    }: {
      installmentId: string;
      programmeMilestoneId: string | null;
    }) => setInstallmentMilestone(contractId, installmentId, programmeMilestoneId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: commercialKeys.all(projectId) });
    },
  });
}

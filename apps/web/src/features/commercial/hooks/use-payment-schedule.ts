'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { generateInvoiceFromInstallment } from '@/features/accounting/api/invoices-api';
import { invoiceKeys } from '@/features/accounting/hooks/use-invoices';
import { setInstallmentMilestone } from '@/features/contracts/api/contracts-api';
import type { GenerateInvoiceFromInstallmentPayload } from '@/features/accounting/types';

import { commercialKeys } from './use-commercial';

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

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  replacePaymentPlan,
  type PaymentInstallmentPayload,
} from '@/features/contracts/api/contracts-api';

import { commercialKeys } from './use-commercial';

/**
 * Replace a DRAFT MILESTONE contract's whole payment schedule
 * (commercial-billing-model-refinement §5 P2 editor → §5 P1 route).
 *
 * The new plan moves both commercial read models a milestone contract reads from — the summary's
 * payment-plan panel and the cycle's payment schedule — so it invalidates the whole project
 * commercial cache, mirroring `use-payment-schedule.ts`. Any server rejection (409 non-DRAFT, 400
 * off-100%) surfaces to the caller's `onError`; this hook re-implements no rule.
 */
export function useReplacePaymentPlan(projectId: string, contractId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (installments: PaymentInstallmentPayload[]) =>
      replacePaymentPlan(contractId, { installments }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: commercialKeys.all(projectId) });
    },
  });
}

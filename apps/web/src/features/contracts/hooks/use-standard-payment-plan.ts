import { useMemo } from 'react';

import { useCompanyTemplates } from '@/features/organization/hooks/use-company-templates';

import type { PaymentPlanRow } from '../contract-form-payload';

/**
 * The company's standard payment plan (Step 1b, ADR-047) as builder rows — the company's own copy
 * from Administration → Templates, else the Rukna default. `undefined` until it has loaded; the
 * builders offer the one-click fill only once it is there. Due dates are per contract, so blank.
 */
export function useStandardPaymentPlan(): PaymentPlanRow[] | undefined {
  const { data } = useCompanyTemplates();
  return useMemo(
    () => data?.paymentPlan.rows.map((row) => ({ ...row, dueDate: '' })),
    [data],
  );
}

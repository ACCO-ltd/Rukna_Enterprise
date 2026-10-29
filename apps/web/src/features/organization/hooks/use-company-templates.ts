import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { UpdatePaymentPlanTemplateInput, UpdateScheduleTemplateInput } from '@erp/types';
import {
  getCompanyTemplates,
  resetCompanyTemplate,
  savePaymentPlanTemplate,
  saveScheduleTemplate,
} from '../api/company-templates-api';

export const companyTemplateKeys = { all: ['company-templates'] as const };

/** The templates in force (the company's copy, else the Rukna default). Rarely changes. */
export function useCompanyTemplates() {
  return useQuery({
    queryKey: companyTemplateKeys.all,
    queryFn: getCompanyTemplates,
    staleTime: 5 * 60_000,
  });
}

function useTemplateMutation<T>(fn: (input: T) => ReturnType<typeof getCompanyTemplates>, toast: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => qc.setQueryData(companyTemplateKeys.all, data),
    meta: { successToast: toast, flashRow: false },
  });
}

export function useSavePaymentPlanTemplate() {
  return useTemplateMutation(
    (input: UpdatePaymentPlanTemplateInput) => savePaymentPlanTemplate(input),
    'platform.feedback.templateSaved',
  );
}

export function useSaveScheduleTemplate() {
  return useTemplateMutation(
    (input: UpdateScheduleTemplateInput) => saveScheduleTemplate(input),
    'platform.feedback.templateSaved',
  );
}

export function useResetCompanyTemplate() {
  return useTemplateMutation(
    (kind: 'payment-plan' | 'schedule') => resetCompanyTemplate(kind),
    'platform.feedback.templateReset',
  );
}

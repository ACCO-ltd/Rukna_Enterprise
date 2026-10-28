import { apiClient } from '@/lib/api-client';
import type {
  CompanyTemplatesResponse,
  UpdatePaymentPlanTemplateInput,
  UpdateScheduleTemplateInput,
} from '@erp/types';

/** `GET /company-templates` — the payment plan and building schedule in force for this company. */
export function getCompanyTemplates(): Promise<CompanyTemplatesResponse> {
  return apiClient<CompanyTemplatesResponse>('/company-templates');
}

/** `PUT /company-templates/payment-plan` — requires manage:organization. */
export function savePaymentPlanTemplate(payload: UpdatePaymentPlanTemplateInput): Promise<CompanyTemplatesResponse> {
  return apiClient<CompanyTemplatesResponse>('/company-templates/payment-plan', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/** `PUT /company-templates/schedule` — requires manage:organization. */
export function saveScheduleTemplate(payload: UpdateScheduleTemplateInput): Promise<CompanyTemplatesResponse> {
  return apiClient<CompanyTemplatesResponse>('/company-templates/schedule', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/** `DELETE /company-templates/:kind` — back to the Rukna default. */
export function resetCompanyTemplate(kind: 'payment-plan' | 'schedule'): Promise<CompanyTemplatesResponse> {
  return apiClient<CompanyTemplatesResponse>(`/company-templates/${kind}`, { method: 'DELETE' });
}

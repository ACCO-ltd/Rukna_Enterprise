import { apiClient } from '@/lib/api-client';
import type { OrganizationDto, UpdateOrganizationBrandingInput } from '@erp/types';

/** `GET /organizations/:id` — the caller may only ever request their own active organization. */
export function getOrganization(id: string): Promise<OrganizationDto> {
  return apiClient<OrganizationDto>(`/organizations/${id}`);
}

/** `PATCH /organizations/:id/branding` — requires manage:organization. */
export function updateOrganizationBranding(
  id: string,
  payload: UpdateOrganizationBrandingInput,
): Promise<OrganizationDto> {
  return apiClient<OrganizationDto>(`/organizations/${id}/branding`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

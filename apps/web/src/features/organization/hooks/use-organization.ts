import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { UpdateOrganizationBrandingInput } from '@erp/types';
import { useSession } from '@/features/auth/session/use-session';
import { getOrganization, updateOrganizationBranding } from '../api/organization-api';

const organizationKeys = {
  detail: (id: string) => ['organization', id] as const,
};

/** The caller's own active organization — `orgId` comes from the session, never a route param. */
export function useOrganization() {
  const { user } = useSession();
  const orgId = user?.orgId ?? '';

  return useQuery({
    queryKey: organizationKeys.detail(orgId),
    queryFn: () => getOrganization(orgId),
    enabled: orgId !== '',
  });
}

export function useUpdateOrganizationBranding() {
  const qc = useQueryClient();
  const { user } = useSession();
  const orgId = user?.orgId ?? '';

  return useMutation({
    mutationFn: (payload: UpdateOrganizationBrandingInput) =>
      updateOrganizationBranding(orgId, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: organizationKeys.detail(orgId) }),
  });
}

'use client';

import { useQuery } from '@tanstack/react-query';

import { listPermissions } from '../api/permissions-api';

/**
 * The permission catalogue that feeds the role permission picker.
 *
 * Named `usePermissionsCatalogue` rather than `usePermissions` to avoid colliding with the
 * authorization hook of the same name in `features/auth/permissions/can`.
 */
export function usePermissionsCatalogue() {
  return useQuery({
    queryKey: ['permissions-catalogue'],
    queryFn: listPermissions,
    // The catalogue is static seeded data; no need to refetch it per screen.
    staleTime: 5 * 60_000,
  });
}

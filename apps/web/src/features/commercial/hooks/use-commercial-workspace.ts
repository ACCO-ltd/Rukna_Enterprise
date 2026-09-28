'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CommercialWorkspaceResponse } from '@erp/types';

import { getCommercialWorkspace } from '../api/commercial-workspace-api';
import { commercialKeys } from './use-commercial';

export const commercialWorkspaceKey = (projectId: string) =>
  [...commercialKeys.all(projectId), 'workspace'] as const;

/**
 * The Commercial tab's read model. Keyed under `commercialKeys.all`, so every commercial mutation
 * (prepare, issue, payment, reopen…) that invalidates the project's commercial tree refreshes the
 * bar facts and the To do list with it.
 */
export function useCommercialWorkspace(
  projectId: string,
): UseQueryResult<CommercialWorkspaceResponse, Error> {
  return useQuery({
    queryKey: commercialWorkspaceKey(projectId),
    queryFn: () => getCommercialWorkspace(projectId),
  });
}

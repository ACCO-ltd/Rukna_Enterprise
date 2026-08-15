'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  CommercialApplicationsResponse,
  CommercialCurrentCycleResponse,
  CommercialSummaryResponse,
} from '@erp/types';

import {
  getCommercialApplications,
  getCommercialCurrentCycle,
  getCommercialSummary,
} from '../api/commercial-api';

export const commercialKeys = {
  all: (projectId: string) => ['commercial', projectId] as const,
  summary: (projectId: string) => [...commercialKeys.all(projectId), 'summary'] as const,
  applications: (projectId: string) => [...commercialKeys.all(projectId), 'applications'] as const,
  currentCycle: (projectId: string) => [...commercialKeys.all(projectId), 'current-cycle'] as const,
};

/**
 * The commercial summary read model. A project with no main contract is not an error here —
 * the server answers with `mainContract: null` and `UNAVAILABLE` metrics, which is the
 * "no contract yet" state the workspace renders rather than a failure.
 */
export function useCommercialSummary(
  projectId: string,
): UseQueryResult<CommercialSummaryResponse, Error> {
  return useQuery({
    queryKey: commercialKeys.summary(projectId),
    queryFn: () => getCommercialSummary(projectId),
  });
}

export function useCommercialCurrentCycle(
  projectId: string,
): UseQueryResult<CommercialCurrentCycleResponse, Error> {
  return useQuery({
    queryKey: commercialKeys.currentCycle(projectId),
    queryFn: () => getCommercialCurrentCycle(projectId),
  });
}

export function useCommercialApplications(
  projectId: string,
): UseQueryResult<CommercialApplicationsResponse, Error> {
  return useQuery({
    queryKey: commercialKeys.applications(projectId),
    queryFn: () => getCommercialApplications(projectId),
  });
}

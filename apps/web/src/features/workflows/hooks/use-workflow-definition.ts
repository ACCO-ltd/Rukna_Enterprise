'use client';

import { useQuery } from '@tanstack/react-query';

import { getWorkflowDefinition } from '../api/workflows-api';
import type { WorkflowTransactionType } from '../types';

/**
 * The active workflow definition for a transaction type. The API answers 404 when the
 * organization has none — the normal state until a policy is activated — so callers that only
 * need it to draw an approval already in flight pass `enabled: false` otherwise.
 */
export function useWorkflowDefinition(
  transactionType?: WorkflowTransactionType,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['workflow-definition', transactionType],
    queryFn: () => getWorkflowDefinition(transactionType!),
    enabled: Boolean(transactionType) && (options?.enabled ?? true),
  });
}

import { ApiError, apiClient } from '@/lib/api-client';

import type { WorkflowDefinition, WorkflowTransactionType } from '../types';

/**
 * Returns null when no definition exists for this transaction type (404).
 * Throws for any other error.
 */
export async function getWorkflowDefinition(
  transactionType: WorkflowTransactionType,
): Promise<WorkflowDefinition | null> {
  try {
    return await apiClient<WorkflowDefinition>(`/workflows/definition/${transactionType}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

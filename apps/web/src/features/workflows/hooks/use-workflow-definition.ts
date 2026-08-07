'use client';

import { useQuery } from '@tanstack/react-query';

import { getWorkflowDefinition } from '../api/workflows-api';
import type { WorkflowTransactionType } from '../types';

export function useWorkflowDefinition(transactionType: WorkflowTransactionType) {
  return useQuery({
    queryKey: ['workflow-definition', transactionType],
    queryFn: () => getWorkflowDefinition(transactionType),
  });
}

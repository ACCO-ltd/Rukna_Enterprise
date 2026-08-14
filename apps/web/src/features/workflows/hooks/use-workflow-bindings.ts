'use client';

import { useQuery } from '@tanstack/react-query';

import { getWorkflowBindings } from '../api/workflows-api';

export function useWorkflowBindings() {
  return useQuery({
    queryKey: ['workflow-bindings'],
    queryFn: getWorkflowBindings,
  });
}

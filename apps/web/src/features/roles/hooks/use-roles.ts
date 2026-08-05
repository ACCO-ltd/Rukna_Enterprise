'use client';

import { useQuery } from '@tanstack/react-query';

import { listRoles } from '../api/roles-api';

export function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: listRoles });
}

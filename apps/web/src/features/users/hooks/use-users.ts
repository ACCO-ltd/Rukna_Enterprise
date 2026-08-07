'use client';

import { useQuery } from '@tanstack/react-query';

import { listUsers } from '../api/users-api';

export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: listUsers });
}

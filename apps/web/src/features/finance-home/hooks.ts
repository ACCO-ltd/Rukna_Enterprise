'use client';

import { useQuery } from '@tanstack/react-query';

import { getFinanceHome } from './api';

export function useFinanceHome() {
  return useQuery({ queryKey: ['finance', 'home'], queryFn: getFinanceHome });
}

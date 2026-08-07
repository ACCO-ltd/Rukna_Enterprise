'use client';

import { useQuery } from '@tanstack/react-query';

import { listAuditLogs } from '../api/audit-api';

export function useAuditLogs() {
  return useQuery({ queryKey: ['audit-logs'], queryFn: listAuditLogs });
}

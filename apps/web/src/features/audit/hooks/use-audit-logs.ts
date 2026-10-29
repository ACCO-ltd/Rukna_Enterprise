'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AuditLogQuery } from '@erp/types';

import { listAuditLogs } from '../api/audit-api';

export function useAuditLogs(query: AuditLogQuery) {
  return useQuery({
    queryKey: ['audit-logs', query],
    queryFn: () => listAuditLogs(query),
    // Paging and filtering keep the last page on screen until the next one answers.
    placeholderData: keepPreviousData,
  });
}

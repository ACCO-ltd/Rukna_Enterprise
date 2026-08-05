import { apiClient } from '@/lib/api-client';

import type { AuditLogEntry } from '../types';

export async function listAuditLogs(): Promise<AuditLogEntry[]> {
  return apiClient<AuditLogEntry[]>('/audit-logs');
}

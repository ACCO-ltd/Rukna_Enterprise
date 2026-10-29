import type { AuditLogPage, AuditLogQuery } from '@erp/types';

import { apiClient } from '@/lib/api-client';

/** `GET /audit-logs` — one page of the trail, newest first, searched and filtered on the server. */
export async function listAuditLogs(query: AuditLogQuery): Promise<AuditLogPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return apiClient<AuditLogPage>(`/audit-logs${qs ? `?${qs}` : ''}`);
}

import { apiClient } from '@/lib/api-client';
import type { SetupImportCheck, SetupImportKind, SetupImportRequest, SetupImportResult } from '@erp/types';

/** Step 5 — `POST /finance/import/:kind/check`: what the import would do. Saves nothing. */
export function checkSetupImport(kind: SetupImportKind, request: SetupImportRequest): Promise<SetupImportCheck> {
  return apiClient<SetupImportCheck>(`/finance/import/${kind}/check`, { method: 'POST', body: JSON.stringify(request) });
}

/** Step 5 — `POST /finance/import/:kind`: create the records and their opening balances. */
export function runSetupImport(kind: SetupImportKind, request: SetupImportRequest): Promise<SetupImportResult> {
  return apiClient<SetupImportResult>(`/finance/import/${kind}`, { method: 'POST', body: JSON.stringify(request) });
}

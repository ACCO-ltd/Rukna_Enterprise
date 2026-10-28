import { apiClient } from '@/lib/api-client';
import type {
  BankStatementSummary,
  BankStatementWorkspace,
  ImportBankStatementRequest,
  PostStatementLineRequest,
} from '@erp/types';

const BASE = '/finance/bank-statements';

/** Step 6 — bank reconciliation (`/finance/bank-statements`). */
export const bankStatementsApi = {
  list: (bankAccountId?: string) =>
    apiClient<BankStatementSummary[]>(bankAccountId ? `${BASE}?bankAccountId=${encodeURIComponent(bankAccountId)}` : BASE),
  import: (body: ImportBankStatementRequest) => apiClient<BankStatementWorkspace>(BASE, { method: 'POST', body: JSON.stringify(body) }),
  workspace: (id: string) => apiClient<BankStatementWorkspace>(`${BASE}/${encodeURIComponent(id)}`),
  acceptSuggestions: (id: string) => apiClient<BankStatementWorkspace>(`${BASE}/${encodeURIComponent(id)}/accept-suggestions`, { method: 'POST' }),
  match: (id: string, lineId: string, journalLineId: string) =>
    apiClient<BankStatementWorkspace>(`${BASE}/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}/match`, { method: 'POST', body: JSON.stringify({ journalLineId }) }),
  unmatch: (id: string, lineId: string) =>
    apiClient<BankStatementWorkspace>(`${BASE}/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}/unmatch`, { method: 'POST' }),
  post: (id: string, lineId: string, body: PostStatementLineRequest) =>
    apiClient<BankStatementWorkspace>(`${BASE}/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}/post`, { method: 'POST', body: JSON.stringify(body) }),
  reconcile: (id: string) => apiClient<BankStatementWorkspace>(`${BASE}/${encodeURIComponent(id)}/reconcile`, { method: 'POST' }),
  remove: (id: string) => apiClient<{ removed: boolean }>(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

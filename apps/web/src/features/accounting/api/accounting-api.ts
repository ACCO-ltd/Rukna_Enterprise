import { apiClient } from '@/lib/api-client';

import type {
  Account,
  ApproveJournalPayload,
  CreateJournalPayload,
  FiscalYear,
  JournalEntry,
  ProfitLoss,
  ReverseJournalPayload,
  TrialBalance,
} from '../types';

// ─── Chart of accounts ───────────────────────────────────────────────────────────

/**
 * `GET /accounts` — every account in the organisation, ordered by code.
 *
 * There is no pagination and no filter. A chart of accounts is a few hundred rows at most and
 * every screen that offers an account picker needs all of them, so it is fetched whole and
 * filtered in the browser.
 */
export function listAccounts(): Promise<Account[]> {
  return apiClient<Account[]>('/accounts');
}

export function getAccount(id: string): Promise<Account> {
  return apiClient<Account>(`/accounts/${id}`);
}

// ─── Fiscal years and periods ────────────────────────────────────────────────────

/**
 * `GET /fiscal-years` — each with its periods embedded, ordered by period number.
 *
 * There is no endpoint that lists periods on their own; the period controller exposes only
 * the lifecycle actions (A10). This is the only way to enumerate them.
 */
export function listFiscalYears(): Promise<FiscalYear[]> {
  return apiClient<FiscalYear[]>('/fiscal-years');
}

export function getFiscalYear(id: string): Promise<FiscalYear> {
  return apiClient<FiscalYear>(`/fiscal-years/${id}`);
}

// ─── Manual journals ─────────────────────────────────────────────────────────────

/**
 * `GET /journals` — manual journals only.
 *
 * The service filters on `sourceDocumentType: 'MANUAL_JOURNAL'`, so entries raised by the
 * posting engine for invoices, bills and payments do not appear. Those are reachable through
 * the account ledger and the drill-down report instead.
 *
 * The endpoint takes no query parameters at all, despite §6.17 documenting
 * `?status=DRAFT&periodId=...` (A7). Status filtering is done in the browser.
 */
export function listJournals(): Promise<JournalEntry[]> {
  return apiClient<JournalEntry[]>('/journals');
}

export function getJournal(id: string): Promise<JournalEntry> {
  return apiClient<JournalEntry>(`/journals/${id}`);
}

/**
 * `POST /journals` — creates a DRAFT.
 *
 * Nothing is validated at this point beyond the DTO's shape: a draft may be unbalanced, and
 * `@ArrayMinSize(2)` is the only structural rule. The double-entry checks — at least two
 * lines, exactly one of debit or credit per line, ∑ debits = ∑ credits — run at POST time in
 * `DoubleEntryValidator`. `journal-entry.ts` mirrors all three so the editor can refuse a
 * journal it knows the server will reject.
 */
export function createJournal(payload: CreateJournalPayload): Promise<JournalEntry> {
  return apiClient<JournalEntry>('/journals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function submitJournal(id: string): Promise<JournalEntry> {
  return apiClient<JournalEntry>(`/journals/${id}/submit`, { method: 'POST' });
}

/** Approve or reject. The server requires `rejectionReason` when `approved` is false. */
export function approveJournal(
  id: string,
  payload: ApproveJournalPayload,
): Promise<JournalEntry> {
  return apiClient<JournalEntry>(`/journals/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Posts an APPROVED journal to the general ledger. Irreversible except by `reverseJournal`. */
export function postJournal(id: string): Promise<JournalEntry> {
  return apiClient<JournalEntry>(`/journals/${id}/post`, { method: 'POST' });
}

/** Raises a new entry with the debits and credits swapped. Neither entry is removed. */
export function reverseJournal(
  id: string,
  payload: ReverseJournalPayload,
): Promise<JournalEntry> {
  return apiClient<JournalEntry>(`/journals/${id}/reverse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ─── Reports ─────────────────────────────────────────────────────────────────────

/**
 * `GET /reports/trial-balance`.
 *
 * A CLOSED period is served from its frozen `PeriodAccountBalance` snapshot rather than
 * recomputed, so the figures for a closed period do not move even if something is later
 * posted against it.
 */
export function getTrialBalance(params: {
  asOfDate: string;
  includeZeroBalance?: boolean;
}): Promise<TrialBalance> {
  return apiClient<TrialBalance>('/reports/trial-balance', {
    params: {
      asOfDate: params.asOfDate,
      // The DTO transforms the string 'true'; sending a boolean would arrive as "false".
      ...(params.includeZeroBalance ? { includeZeroBalance: 'true' } : {}),
    },
  });
}

/** `GET /reports/pl`. Closing entries are excluded, so a closed year still reports its income. */
export function getProfitLoss(params: {
  fromDate: string;
  toDate: string;
  projectId?: string;
  departmentId?: string;
}): Promise<ProfitLoss> {
  return apiClient<ProfitLoss>('/reports/pl', {
    params: {
      fromDate: params.fromDate,
      toDate: params.toDate,
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...(params.departmentId ? { departmentId: params.departmentId } : {}),
    },
  });
}

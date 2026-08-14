import type { ProjectFinancialPositionResponse } from '@erp/types';

import { apiClient } from '@/lib/api-client';

import type { ConfigureBankAccountBody } from '../bank-account-setup';
import type { CreateAccountBody } from '../coa-setup';
import type { OpeningBalanceBody } from '../opening-balance';
import type {
  Account,
  AccountLedger,
  BankAccount,
  AccountingPeriod,
  ApproveJournalPayload,
  BalanceSheet,
  CloseGate,
  CreateFiscalYearPayload,
  CreateJournalPayload,
  FiscalYear,
  JournalEntry,
  MigrationReport,
  MonthlyPL,
  PostingProfile,
  ProfitLoss,
  ReconciliationReport,
  ReverseJournalPayload,
  RunReconciliationPayload,
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

/**
 * `POST /accounts` — creates the account and its first version in one call.
 *
 * 409 when the code already exists, 404 when `parentAccountCode` names an account that does
 * not. Nothing validates that the subtype belongs to the class or that the normal balance
 * matches it — see `coa-setup.ts`.
 */
export function createAccount(payload: CreateAccountBody): Promise<Account> {
  return apiClient<Account>('/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getAccount(id: string): Promise<Account> {
  return apiClient<Account>(`/accounts/${id}`);
}

// ─── Opening balance migration ───────────────────────────────────────────────────

/**
 * `POST /accounting/opening-balance`
 *
 * **Runs once per organisation.** The service looks for an existing `EVT-OPB-001` journal and
 * answers 409 with "Reverse it first to re-import", so this is a cutover rather than a form
 * somebody refines.
 *
 * Three failures are pre-empted in `opening-balance.ts` rather than met one at a time:
 * an out-of-balance trial balance (400 naming both totals), an account code absent from the
 * chart (404 naming one code, then rollback), and a line whose amount is zero (skipped in
 * silence).
 *
 * `openArInvoices` and `openApBills` are accepted by the DTO and not sent here — see the note
 * on the wizard.
 */
export function runOpeningBalance(payload: OpeningBalanceBody): Promise<MigrationReport> {
  return apiClient<MigrationReport>('/accounting/opening-balance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * `POST /accounting/reconcile`
 *
 * Compares the AR and AP control accounts against their subledgers, plus any bank accounts
 * named. A variance over 0.01 marks a check unreconciled and blocks period close.
 *
 * A POST that reads and returns a report rather than changing anything — so it is exposed as
 * an explicit action the user runs, not a query that refetches on its own.
 */
export function runReconciliation(
  payload: RunReconciliationPayload,
): Promise<ReconciliationReport> {
  return apiClient<ReconciliationReport>('/accounting/reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * `GET /bank-accounts`.
 *
 * Returns every account regardless of status. Filtering to the ones a payment may use is the
 * caller's job, because a SUSPENDED or receipts-only account still has to render its name on a
 * payment raised before it was suspended.
 */
export function listBankAccounts(): Promise<BankAccount[]> {
  return apiClient<BankAccount[]>('/bank-accounts');
}

/**
 * `POST /bank-accounts`
 *
 * Better guarded than most of this API: 404 when the GL code resolves to nothing, 400 when its
 * subtype is not `CASH_AND_BANK`, 409 when another bank account already maps to it. All three
 * are mirrored in the picker so they are not discovered by request.
 *
 * `accountNameAr` is accepted by the DTO, has no column on `BankAccount`, and the repository
 * spreads the DTO straight into Prisma — so supplying it fails the request while omitting it
 * succeeds (A19 / #42). `ConfigureBankAccountBody` omits it. Do not add it back until the
 * column exists.
 */
export function configureBankAccount(
  payload: ConfigureBankAccountBody,
): Promise<BankAccount> {
  return apiClient<BankAccount>('/bank-accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * `GET /posting-profiles` — the expense profiles a supplier bill line can name.
 *
 * `status` is a real query parameter the controller reads. It is left absent so INACTIVE
 * profiles arrive too: a bill posted last year against a since-retired profile still has to
 * render its name, and filtering them out server-side would leave it blank.
 */
export function listPostingProfiles(): Promise<PostingProfile[]> {
  return apiClient<PostingProfile[]>('/posting-profiles');
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

/**
 * `POST /fiscal-years` — creates the year and twelve monthly periods in one call.
 *
 * 409 when a year of the same name exists, 404 when the retained-earnings code names no
 * account. It also 404s with "Fiscal calendar policy not configured" if the organisation has
 * no `FiscalCalendarPolicy` row — that is an internal record with no endpoint behind it, so
 * the message names something the user cannot act on. The seed creates one.
 *
 * The months the periods cover come from that policy, not from January. §6.14 says Jan–Dec,
 * which is true only while `fiscalYearStartMonth` is 1 — as the seed sets it.
 */
export function createFiscalYear(payload: CreateFiscalYearPayload): Promise<FiscalYear> {
  return apiClient<FiscalYear>('/fiscal-years', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
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

/**
 * `GET /projects/:id/pl` — Project Actual P&L (ADR-013). Posted GL truth only, scoped to the
 * project; the path id overrides any projectId param. Excludes committed/forecast cost — that is
 * the separate Project Financial Position (`getProjectFinancialPosition`). Do not present this as
 * the full picture.
 */
export function getProjectActualPl(
  projectId: string,
  params: { fromDate: string; toDate: string },
): Promise<ProfitLoss> {
  return apiClient<ProfitLoss>(`/projects/${projectId}/pl`, {
    params: { fromDate: params.fromDate, toDate: params.toDate },
  });
}

/**
 * `GET /projects/:id/financial-position` — Project Financial Position (ADR-013). The PM/control
 * view: posted actual cost plus remaining committed cost, and the forecast margin that follows,
 * alongside contract/certified/invoiced/received revenue. Requires `view:financial-position`.
 * Unlike the Actual P&L, committed cost is included — this is the complete project money picture.
 */
export function getProjectFinancialPosition(
  projectId: string,
): Promise<ProjectFinancialPositionResponse> {
  return apiClient<ProjectFinancialPositionResponse>(`/projects/${projectId}/financial-position`);
}

/**
 * `GET /reports/balance-sheet`.
 *
 * `comparativeDate` adds a second column. Equity carries Current Year Earnings as a live P&L
 * for an open fiscal year, which is why the sheet balances before the year is closed.
 */
export function getBalanceSheet(params: {
  asOfDate: string;
  comparativeDate?: string;
}): Promise<BalanceSheet> {
  return apiClient<BalanceSheet>('/reports/balance-sheet', {
    params: {
      asOfDate: params.asOfDate,
      ...(params.comparativeDate ? { comparativeDate: params.comparativeDate } : {}),
    },
  });
}

/** `GET /reports/ledger/:accountId` — POSTED entries only, with a running balance. */
export function getAccountLedger(params: {
  accountId: string;
  fromDate: string;
  toDate: string;
  projectId?: string;
}): Promise<AccountLedger> {
  return apiClient<AccountLedger>(`/reports/ledger/${params.accountId}`, {
    params: {
      fromDate: params.fromDate,
      toDate: params.toDate,
      ...(params.projectId ? { projectId: params.projectId } : {}),
    },
  });
}

/**
 * `GET /reports/pl/monthly/:fiscalYearId` — one column per period.
 *
 * Returns `null` with a 200 rather than a 404 for an unknown fiscal year
 * (`pl-report.service.ts:180`), so the null is passed through for the caller to interpret.
 */
export function getMonthlyPL(
  fiscalYearId: string,
  projectId?: string,
): Promise<MonthlyPL | null> {
  return apiClient<MonthlyPL | null>(`/reports/pl/monthly/${fiscalYearId}`, {
    params: { ...(projectId ? { projectId } : {}) },
  });
}

// ─── Period management ───────────────────────────────────────────────────────────

/**
 * The period lifecycle.
 *
 * ⚠ None of these endpoints has any authorization: they carry `JwtAuthGuard` and nothing
 * else, and the `permissions` table is never seeded (#25). Any signed-in user in the tenant
 * can close a fiscal year. The UI gates them on `can()` so that a single flag secures them
 * once a guard exists, but that gating is presentation only — the server is the boundary and
 * right now there is none.
 */
export function lockPeriod(periodId: string): Promise<AccountingPeriod> {
  return apiClient<AccountingPeriod>(`/periods/${periodId}/lock`, { method: 'POST' });
}

/** LOCKED → CLOSED. Generates the period's balance snapshot before marking it closed. */
export function closePeriod(periodId: string): Promise<AccountingPeriod> {
  return apiClient<AccountingPeriod>(`/periods/${periodId}/close`, { method: 'POST' });
}

/** CLOSED → REOPENED. Invalidates every downstream snapshot. */
export function reopenPeriod(periodId: string, reason: string): Promise<AccountingPeriod> {
  return apiClient<AccountingPeriod>(`/periods/${periodId}/reopen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
}

/**
 * Pre-flight for closing. Returns the blockers rather than throwing, so the UI can show what
 * stands in the way before anyone presses Close — `closePeriod` itself throws a 400 with the
 * same list joined into one sentence.
 */
export function checkCloseGate(periodId: string): Promise<CloseGate> {
  return apiClient<CloseGate>(`/periods/${periodId}/close-gate`);
}

export function rebuildSnapshot(periodId: string): Promise<unknown> {
  return apiClient<unknown>(`/periods/${periodId}/snapshot/rebuild`, { method: 'POST' });
}

/** Year-end: posts the closing journal, zeroes the P&L into retained earnings, closes the FY. */
export function closeFiscalYear(fiscalYearId: string): Promise<unknown> {
  return apiClient<unknown>(`/periods/fiscal-year/${fiscalYearId}/close`, { method: 'POST' });
}

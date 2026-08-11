'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  approveJournal,
  checkCloseGate,
  closeFiscalYear,
  closePeriod,
  createAccount,
  getAccountLedger,
  getBalanceSheet,
  getMonthlyPL,
  lockPeriod,
  rebuildSnapshot,
  reopenPeriod,
  createJournal,
  getFiscalYear,
  getJournal,
  getProfitLoss,
  getTrialBalance,
  listAccounts,
  listBankAccounts,
  listFiscalYears,
  listPostingProfiles,
  listJournals,
  postJournal,
  reverseJournal,
  submitJournal,
} from '../api/accounting-api';
import type { CreateAccountBody } from '../coa-setup';
import type {
  Account,
  AccountLedger,
  BankAccount,
  BalanceSheet,
  CloseGate,
  MonthlyPL,
  ApproveJournalPayload,
  CreateJournalPayload,
  FiscalYear,
  JournalEntry,
  PostingProfile,
  ProfitLoss,
  ReverseJournalPayload,
  TrialBalance,
} from '../types';

export const accountingKeys = {
  all: ['accounting'] as const,
  accounts: () => [...accountingKeys.all, 'accounts'] as const,
  postingProfiles: () => [...accountingKeys.all, 'posting-profiles'] as const,
  bankAccounts: () => [...accountingKeys.all, 'bank-accounts'] as const,
  fiscalYears: () => [...accountingKeys.all, 'fiscal-years'] as const,
  fiscalYear: (id: string) => [...accountingKeys.all, 'fiscal-year', id] as const,
  journals: () => [...accountingKeys.all, 'journals'] as const,
  journal: (id: string) => [...accountingKeys.all, 'journal', id] as const,
  trialBalance: (asOfDate: string, includeZero: boolean) =>
    [...accountingKeys.all, 'trial-balance', asOfDate, includeZero] as const,
  profitLoss: (fromDate: string, toDate: string, projectId?: string) =>
    [...accountingKeys.all, 'profit-loss', fromDate, toDate, projectId ?? 'all'] as const,
  balanceSheet: (asOfDate: string, comparativeDate?: string) =>
    [...accountingKeys.all, 'balance-sheet', asOfDate, comparativeDate ?? 'none'] as const,
  ledger: (accountId: string, fromDate: string, toDate: string) =>
    [...accountingKeys.all, 'ledger', accountId, fromDate, toDate] as const,
  monthlyPL: (fiscalYearId: string) =>
    [...accountingKeys.all, 'monthly-pl', fiscalYearId] as const,
  closeGate: (periodId: string) => [...accountingKeys.all, 'close-gate', periodId] as const,
};

/**
 * The whole chart of accounts.
 *
 * Held for five minutes rather than refetched per screen: it is master data that changes when
 * someone deliberately edits it, and three screens need it at once — the browser, the journal
 * editor's account picker, and the journal detail's line resolution. Every account is used to
 * turn a draft line's `accountId` into a name, so a partial fetch would leave lines blank.
 */
export function useAccounts(): UseQueryResult<Account[], Error> {
  return useQuery({
    queryKey: accountingKeys.accounts(),
    queryFn: listAccounts,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Posting profiles, held as long as the chart of accounts is.
 *
 * The two are always used together — a profile's `accountId` means nothing until it is
 * resolved against `useAccounts()` — so they share a staleness window. A profile changing
 * without its account changing is not a case worth refetching for.
 */
export function usePostingProfiles(): UseQueryResult<PostingProfile[], Error> {
  return useQuery({
    queryKey: accountingKeys.postingProfiles(),
    queryFn: listPostingProfiles,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Creating an account invalidates the chart and every report drawn from it.
 *
 * The reports matter: `posting-accounts.ts` resolves control accounts by scanning the chart
 * for a subtype, and adding a second account with an existing subtype turns a resolved role
 * into an AMBIGUOUS one. A stale chart would keep offering Post on a screen the new account
 * has just blocked.
 */
export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateAccountBody) => createAccount(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountingKeys.accounts() });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, 'trial-balance'] });
    },
  });
}

/** Configured bank accounts. Master data, so it shares the chart's staleness window. */
export function useBankAccounts(): UseQueryResult<BankAccount[], Error> {
  return useQuery({
    queryKey: accountingKeys.bankAccounts(),
    queryFn: listBankAccounts,
    staleTime: 5 * 60 * 1000,
  });
}

/** Fiscal years with their periods embedded — the only way to enumerate periods (A10). */
export function useFiscalYears(): UseQueryResult<FiscalYear[], Error> {
  return useQuery({
    queryKey: accountingKeys.fiscalYears(),
    queryFn: listFiscalYears,
    staleTime: 5 * 60 * 1000,
  });
}

export function useFiscalYear(id: string): UseQueryResult<FiscalYear, Error> {
  return useQuery({
    queryKey: accountingKeys.fiscalYear(id),
    queryFn: () => getFiscalYear(id),
    enabled: Boolean(id),
  });
}

export function useJournals(): UseQueryResult<JournalEntry[], Error> {
  return useQuery({ queryKey: accountingKeys.journals(), queryFn: listJournals });
}

export function useJournal(id: string): UseQueryResult<JournalEntry, Error> {
  return useQuery({
    queryKey: accountingKeys.journal(id),
    queryFn: () => getJournal(id),
    enabled: Boolean(id),
  });
}

export function useCreateJournal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateJournalPayload) => createJournal(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountingKeys.journals() });
    },
  });
}

/**
 * The four lifecycle transitions, as one mutation.
 *
 * Each changes the journal's status and nothing else, and every one of them invalidates both
 * the detail and the list. Splitting them into four near-identical hooks would put the same
 * invalidation in four places for the reader to compare.
 *
 * Posting additionally invalidates the reports: a posted journal is precisely what the trial
 * balance and the P&L are summing, and leaving a stale report on screen after posting into it
 * is how someone concludes the entry did not take.
 */
export function useJournalAction(id: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (action: JournalActionRequest) => {
      switch (action.type) {
        case 'submit':
          return submitJournal(id);
        case 'approve':
          return approveJournal(id, action.payload);
        case 'post':
          return postJournal(id);
        case 'reverse':
          return reverseJournal(id, action.payload);
      }
    },
    onSuccess: (_result, action) => {
      void qc.invalidateQueries({ queryKey: accountingKeys.journal(id) });
      void qc.invalidateQueries({ queryKey: accountingKeys.journals() });

      if (action.type === 'post' || action.type === 'reverse') {
        void qc.invalidateQueries({ queryKey: [...accountingKeys.all, 'trial-balance'] });
        void qc.invalidateQueries({ queryKey: [...accountingKeys.all, 'profit-loss'] });
      }
    },
  });
}

export type JournalActionRequest =
  | { type: 'submit' }
  | { type: 'approve'; payload: ApproveJournalPayload }
  | { type: 'post' }
  | { type: 'reverse'; payload: ReverseJournalPayload };

/**
 * `enabled` on a falsy date so the report is not requested before one is chosen. The query
 * key carries the parameters, so changing the date is a new cache entry rather than a refetch
 * that briefly shows the previous date's figures under the new heading.
 */
export function useTrialBalance(
  asOfDate: string,
  includeZeroBalance: boolean,
): UseQueryResult<TrialBalance, Error> {
  return useQuery({
    queryKey: accountingKeys.trialBalance(asOfDate, includeZeroBalance),
    queryFn: () => getTrialBalance({ asOfDate, includeZeroBalance }),
    enabled: Boolean(asOfDate),
  });
}

export function useProfitLoss(
  fromDate: string,
  toDate: string,
  projectId?: string,
): UseQueryResult<ProfitLoss, Error> {
  return useQuery({
    queryKey: accountingKeys.profitLoss(fromDate, toDate, projectId),
    queryFn: () => getProfitLoss({ fromDate, toDate, projectId }),
    enabled: Boolean(fromDate && toDate),
  });
}

export function useBalanceSheet(
  asOfDate: string,
  comparativeDate?: string,
): UseQueryResult<BalanceSheet, Error> {
  return useQuery({
    queryKey: accountingKeys.balanceSheet(asOfDate, comparativeDate),
    queryFn: () => getBalanceSheet({ asOfDate, comparativeDate }),
    enabled: Boolean(asOfDate),
  });
}

export function useAccountLedger(
  accountId: string,
  fromDate: string,
  toDate: string,
): UseQueryResult<AccountLedger, Error> {
  return useQuery({
    queryKey: accountingKeys.ledger(accountId, fromDate, toDate),
    queryFn: () => getAccountLedger({ accountId, fromDate, toDate }),
    // No account chosen yet is the screen's opening state, not an error.
    enabled: Boolean(accountId && fromDate && toDate),
  });
}

/** `null` here means the fiscal year was not found — the API answers 200 with a null body. */
export function useMonthlyPL(fiscalYearId: string): UseQueryResult<MonthlyPL | null, Error> {
  return useQuery({
    queryKey: accountingKeys.monthlyPL(fiscalYearId),
    queryFn: () => getMonthlyPL(fiscalYearId),
    enabled: Boolean(fiscalYearId),
  });
}

/** The close-gate pre-flight, fetched only while a close is being considered. */
export function useCloseGate(periodId: string | null): UseQueryResult<CloseGate, Error> {
  return useQuery({
    queryKey: accountingKeys.closeGate(periodId ?? ''),
    queryFn: () => checkCloseGate(periodId!),
    enabled: Boolean(periodId),
  });
}

export type PeriodActionRequest =
  | { type: 'lock'; periodId: string }
  | { type: 'close'; periodId: string }
  | { type: 'reopen'; periodId: string; reason: string }
  | { type: 'rebuild'; periodId: string }
  | { type: 'close-year'; fiscalYearId: string };

/**
 * Period lifecycle transitions.
 *
 * Every one of them changes what the reports say — closing writes a snapshot the trial
 * balance and balance sheet then read from, reopening invalidates every snapshot downstream —
 * so all of them invalidate the whole accounting namespace rather than a narrower key. A
 * period action is rare and deliberate; refetching more than strictly necessary costs a
 * round-trip, while showing a figure computed under the old period state costs trust.
 */
export function usePeriodAction() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (action: PeriodActionRequest) => {
      switch (action.type) {
        case 'lock':
          return lockPeriod(action.periodId);
        case 'close':
          return closePeriod(action.periodId);
        case 'reopen':
          return reopenPeriod(action.periodId, action.reason);
        case 'rebuild':
          return rebuildSnapshot(action.periodId);
        case 'close-year':
          return closeFiscalYear(action.fiscalYearId);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountingKeys.all });
    },
  });
}

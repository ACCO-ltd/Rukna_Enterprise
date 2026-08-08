'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  approveJournal,
  createJournal,
  getFiscalYear,
  getJournal,
  getProfitLoss,
  getTrialBalance,
  listAccounts,
  listFiscalYears,
  listJournals,
  postJournal,
  reverseJournal,
  submitJournal,
} from '../api/accounting-api';
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

export const accountingKeys = {
  all: ['accounting'] as const,
  accounts: () => [...accountingKeys.all, 'accounts'] as const,
  fiscalYears: () => [...accountingKeys.all, 'fiscal-years'] as const,
  fiscalYear: (id: string) => [...accountingKeys.all, 'fiscal-year', id] as const,
  journals: () => [...accountingKeys.all, 'journals'] as const,
  journal: (id: string) => [...accountingKeys.all, 'journal', id] as const,
  trialBalance: (asOfDate: string, includeZero: boolean) =>
    [...accountingKeys.all, 'trial-balance', asOfDate, includeZero] as const,
  profitLoss: (fromDate: string, toDate: string, projectId?: string) =>
    [...accountingKeys.all, 'profit-loss', fromDate, toDate, projectId ?? 'all'] as const,
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

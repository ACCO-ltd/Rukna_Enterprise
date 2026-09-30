'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import {
  approveJournal,
  checkCloseGate,
  closeFiscalYear,
  closePeriod,
  configureBankAccount,
  createAccount,
  importChartOfAccounts,
  createFiscalYear,
  getAccountLedger,
  getBalanceSheet,
  getMonthlyPL,
  lockPeriod,
  rebuildSnapshot,
  reopenPeriod,
  runOpeningBalance,
  runReconciliation,
  updateAccount,
  createJournal,
  getFiscalYear,
  getJournal,
  getProfitLoss,
  getProjectActualPl,
  getProjectFinancialPosition,
  getTrialBalance,
  listAccounts,
  listBankAccounts,
  listFiscalYears,
  listPostingProfiles,
  listJournals,
  listSignatories,
  addSignatory,
  removeSignatory,
  postJournal,
  reverseJournal,
  submitJournal,
  createPostingProfile,
  getAccountingSetupStatus,
  getAccountingSetupTemplate,
  repointPostingProfile,
  runAccountingSetup,
  setPostingProfileActive,
} from '../api/accounting-api';
import type {
  AccountingSetupBody,
  AccountingSetupResult,
  SetupStatus,
  SetupTemplate,
} from '../accounting-setup';
import type {
  CreatePostingProfileBody,
  RepointPostingProfileBody,
} from '../posting-profile-setup';
import type { ConfigureBankAccountBody } from '../bank-account-setup';
import type { CreateAccountBody, ImportChartResult, UpdateAccountBody } from '../coa-setup';
import type { ProjectFinancialPositionResponse } from '@erp/types';

import type { OpeningBalanceBody } from '../opening-balance';
import type {
  Account,
  AccountingPeriod,
  AccountLedger,
  BankAccount,
  BankAccountSignatory,
  BalanceSheet,
  CloseGate,
  MonthlyPL,
  RunReconciliationPayload,
  ApproveJournalPayload,
  CreateFiscalYearPayload,
  CreateJournalPayload,
  FiscalYear,
  JournalEntry,
  MigrationReport,
  PostingProfile,
  ProfitLoss,
  ReverseJournalPayload,
  TrialBalance,
} from '../types';
import { ApiError } from '@/lib/api-client';
import type { MutationFeedbackMeta } from '@/lib/mutation-feedback';

/** An ICU `select` value for a reference that may not be assigned yet (a draft has no number). */
export function refOrNone(ref: string | null | undefined): string {
  return ref ? ref : 'none';
}

export const accountingKeys = {
  all: ['accounting'] as const,
  accounts: () => [...accountingKeys.all, 'accounts'] as const,
  postingProfiles: () => [...accountingKeys.all, 'posting-profiles'] as const,
  bankAccounts: () => [...accountingKeys.all, 'bank-accounts'] as const,
  signatories: (bankAccountId: string) =>
    [...accountingKeys.all, 'signatories', bankAccountId] as const,
  fiscalYears: () => [...accountingKeys.all, 'fiscal-years'] as const,
  fiscalYear: (id: string) => [...accountingKeys.all, 'fiscal-year', id] as const,
  journals: () => [...accountingKeys.all, 'journals'] as const,
  journal: (id: string) => [...accountingKeys.all, 'journal', id] as const,
  trialBalance: (asOfDate: string, includeZero: boolean) =>
    [...accountingKeys.all, 'trial-balance', asOfDate, includeZero] as const,
  profitLoss: (fromDate: string, toDate: string, projectId?: string) =>
    [...accountingKeys.all, 'profit-loss', fromDate, toDate, projectId ?? 'all'] as const,
  projectActualPl: (projectId: string, fromDate: string, toDate: string) =>
    [...accountingKeys.all, 'project-actual-pl', projectId, fromDate, toDate] as const,
  projectFinancialPosition: (projectId: string) =>
    [...accountingKeys.all, 'project-financial-position', projectId] as const,
  balanceSheet: (asOfDate: string, comparativeDate?: string) =>
    [...accountingKeys.all, 'balance-sheet', asOfDate, comparativeDate ?? 'none'] as const,
  ledger: (accountId: string, fromDate: string, toDate: string) =>
    [...accountingKeys.all, 'ledger', accountId, fromDate, toDate] as const,
  monthlyPL: (fiscalYearId: string) => [...accountingKeys.all, 'monthly-pl', fiscalYearId] as const,
  closeGate: (periodId: string) => [...accountingKeys.all, 'close-gate', periodId] as const,
  setupStatus: () => [...accountingKeys.all, 'setup-status'] as const,
  setupTemplate: (vatRate: number, banks: number) =>
    [...accountingKeys.all, 'setup-template', vatRate, banks] as const,
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
    meta: {
      successToast: {
        key: 'accounting.feedback.accountCreated',
        values: (account) => ({ code: (account as Account).code }),
      },
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountingKeys.accounts() });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, 'trial-balance'] });
    },
  });
}

/**
 * Editing an account invalidates the same surfaces as creating one, and for the same reason.
 *
 * A rename changes what every report and ledger prints for the account, and turning posting off
 * (or re-parenting) changes what the journal editor's account picker offers and what the reports
 * roll up — so the chart and the trial balance are both invalidated, exactly as `useCreateAccount`
 * does. Narrower invalidation would leave a stale name or a stale posting flag on screen.
 */
export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAccountBody }) => updateAccount(id, body),
    meta: {
      successToast: {
        key: 'accounting.feedback.accountUpdated',
        values: (account) => ({ code: (account as Account).code }),
      },
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountingKeys.accounts() });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, 'trial-balance'] });
    },
  });
}

/**
 * Bulk-importing the chart invalidates the same as a single create, for the same reason.
 *
 * An import can add many accounts at once, and adding an account with a subtype that already
 * resolves a control role turns that role AMBIGUOUS — which gates Post across every AR and AP
 * screen. So the chart and every report drawn from it are invalidated, exactly as
 * `useCreateAccount` does, rather than a narrower key that would leave a stale chart offering
 * Post the import has just blocked.
 */
export function useImportChartOfAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accounts: CreateAccountBody[]) => importChartOfAccounts(accounts),
    meta: {
      successToast: {
        key: 'accounting.feedback.chartImported',
        values: (result) => {
          const { created, updated } = result as ImportChartResult;
          return { created, updated };
        },
      },
      flashRow: false,
    },
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

/**
 * Creating a fiscal year invalidates the year list and every report.
 *
 * A report is answered against the period covering its date, so a date that had no period a
 * moment ago becomes reportable the instant the year exists. Leaving a report stale after
 * creating the year it needed is how someone concludes the range is still unavailable.
 */
export function useCreateFiscalYear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateFiscalYearPayload) => createFiscalYear(payload),
    meta: {
      successToast: {
        key: 'accounting.feedback.fiscalYearCreated',
        values: (year) => ({ name: (year as FiscalYear).name }),
      },
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountingKeys.fiscalYears() });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, 'trial-balance'] });
      void qc.invalidateQueries({ queryKey: [...accountingKeys.all, 'profit-loss'] });
    },
  });
}

/**
 * Configuring a bank account invalidates the bank list and the chart.
 *
 * The chart matters because the picker filters on which GL accounts are already mapped, and
 * the newly-mapped one has to disappear from it — otherwise the next attempt offers an account
 * that now answers 409.
 */
export function useConfigureBankAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ConfigureBankAccountBody) => configureBankAccount(payload),
    meta: {
      successToast: {
        key: 'accounting.feedback.bankAccountConfigured',
        values: (bank) => ({ name: (bank as BankAccount).accountName }),
      },
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountingKeys.bankAccounts() });
      void qc.invalidateQueries({ queryKey: accountingKeys.accounts() });
    },
  });
}

/**
 * Running the opening balance invalidates everything a balance can appear in.
 *
 * It posts a journal covering the whole chart, so the trial balance, the P&L and the balance
 * sheet are all answered differently a moment later. It also imports AR and AP documents,
 * which is why the invoice and bill lists go too.
 */
export function useRunOpeningBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: OpeningBalanceBody) => runOpeningBalance(payload),
    meta: {
      successToast: {
        key: 'accounting.feedback.openingBalancePosted',
        values: (report) => ({ ref: (report as MigrationReport).openingBalanceJournalNumber }),
      },
      flashRow: false,
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountingKeys.all });
      void qc.invalidateQueries({ queryKey: ['procurement'] });
    },
  });
}

/**
 * Reconciliation reads and returns a report without changing anything, so nothing is
 * invalidated — it is a mutation only because the endpoint is a POST.
 */
export function useRunReconciliation() {
  return useMutation({
    mutationFn: (payload: RunReconciliationPayload) => runReconciliation(payload),
  });
}

export function useSignatories(
  bankAccountId: string,
): UseQueryResult<BankAccountSignatory[], Error> {
  return useQuery({
    queryKey: accountingKeys.signatories(bankAccountId),
    queryFn: () => listSignatories(bankAccountId),
    enabled: Boolean(bankAccountId),
  });
}

export function useAddSignatory(bankAccountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => addSignatory(bankAccountId, userId),
    meta: { successToast: 'accounting.feedback.signatoryAdded' },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountingKeys.signatories(bankAccountId) });
    },
  });
}

export function useRemoveSignatory(bankAccountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeSignatory(bankAccountId, userId),
    meta: { successToast: 'accounting.feedback.signatoryRemoved', flashRow: false },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountingKeys.signatories(bankAccountId) });
    },
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
    meta: {
      successToast: {
        key: 'accounting.feedback.journalSaved',
        values: (journal) => ({ ref: refOrNone((journal as JournalEntry).journalNumber) }),
      },
    },
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
    meta: {
      successToast: {
        key: 'accounting.feedback.journalAction',
        values: (journal, action) => ({
          action: (action as JournalActionRequest).type,
          ref: refOrNone((journal as JournalEntry).journalNumber),
        }),
      },
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

/** Project Actual P&L (ADR-013) — posted GL only, via `GET /projects/:id/pl`. */
export function useProjectActualPl(
  projectId: string,
  fromDate: string,
  toDate: string,
): UseQueryResult<ProfitLoss, Error> {
  return useQuery({
    queryKey: accountingKeys.projectActualPl(projectId, fromDate, toDate),
    queryFn: () => getProjectActualPl(projectId, { fromDate, toDate }),
    enabled: Boolean(projectId && fromDate && toDate),
  });
}

/**
 * Project Financial Position (ADR-013) — the rich PM view: posted actuals plus remaining committed
 * cost and budget, via `GET /projects/:id/financial-position`. Requires `view:financial-position`.
 */
export function useProjectFinancialPosition(
  projectId: string,
  options: { enabled?: boolean } = {},
): UseQueryResult<ProjectFinancialPositionResponse, Error> {
  return useQuery({
    queryKey: accountingKeys.projectFinancialPosition(projectId),
    queryFn: () => getProjectFinancialPosition(projectId),
    // The endpoint requires view:financial-position and 403s without it. Callers that cannot
    // establish the permission must pass `enabled: false` so no request is made — the API
    // stays the security boundary, but the UI never provokes a 403 it will only discard.
    enabled: Boolean(projectId) && (options.enabled ?? true),
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
    meta: PERIOD_FEEDBACK,
  });
}

/** The period's name, when the transition answered with the period (rebuild and year-end do not). */
function periodName(result: unknown): string {
  return (result as Partial<AccountingPeriod> | null)?.name ?? '';
}

/** Which close a milestone was — the year's close words its dialog differently from a period's. */
function closeKind(action: unknown): 'year' | 'period' {
  return (action as PeriodActionRequest).type === 'close-year' ? 'year' : 'period';
}

/**
 * Closing a period and closing the year are the milestones of the accounting calendar — they
 * get the success dialog. Locking, reopening and rebuilding a snapshot get a toast.
 */
const PERIOD_FEEDBACK: MutationFeedbackMeta = {
  successToast: {
    key: 'accounting.feedback.periodAction',
    values: (result, action) => ({
      action: (action as PeriodActionRequest).type,
      name: periodName(result),
    }),
  },
  successDialog: {
    when: (_result, action) => {
      const type = (action as PeriodActionRequest).type;
      return type === 'close' || type === 'close-year';
    },
    title: {
      key: 'accounting.feedback.periodClosedTitle',
      values: (result, action) => ({ kind: closeKind(action), name: periodName(result) }),
    },
    description: {
      key: 'accounting.feedback.periodClosedBody',
      values: (_result, action) => ({ kind: closeKind(action) }),
    },
  },
  flashRow: false,
};

// ─── Posting profile management (ADR-040 §4) ─────────────────────────────────────

/**
 * Creating, re-pointing or (de)activating a profile invalidates the profile list and the guide —
 * the setup cycle's "posting profiles" step reads whether any exist.
 */
function invalidatePostingProfiles(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: accountingKeys.postingProfiles() });
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, 'guide'] });
  void qc.invalidateQueries({ queryKey: [...accountingKeys.all, 'readiness'] });
}

export function useCreatePostingProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePostingProfileBody) => createPostingProfile(body),
    meta: {
      successToast: {
        key: 'accounting.feedback.postingProfileCreated',
        values: (_profile, body) => ({ code: (body as CreatePostingProfileBody).code }),
      },
    },
    onSuccess: () => invalidatePostingProfiles(qc),
  });
}

export function useRepointPostingProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RepointPostingProfileBody }) =>
      repointPostingProfile(id, body),
    meta: {
      successToast: {
        key: 'accounting.feedback.postingProfileRepointed',
        values: (_profile, variables) => ({
          account: (variables as { body: RepointPostingProfileBody }).body.accountCode,
        }),
      },
    },
    onSuccess: () => invalidatePostingProfiles(qc),
    // Someone else re-pointed it meanwhile: reload so the form checks against the new latest version.
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'POSTING_PROFILE_CHANGED') {
        invalidatePostingProfiles(qc);
      }
    },
  });
}

export function useSetPostingProfileActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; code: string; active: boolean }) =>
      setPostingProfileActive(id, active),
    meta: {
      successToast: {
        key: 'accounting.feedback.postingProfileStatus',
        values: (_profile, variables) => {
          const { code, active } = variables as { code: string; active: boolean };
          return { code, action: active ? 'reactivate' : 'deactivate' };
        },
      },
      flashRow: (_profile, variables) => (variables as { id: string }).id,
    },
    onSuccess: () => invalidatePostingProfiles(qc),
  });
}

// ─── Accounting setup from a template (ADR-040) ──────────────────────────────────

/**
 * Whether the one-step setup may still run. Only asked for by someone who could run it — the
 * endpoint is an administrator question, and nobody else is offered the action.
 */
export function useAccountingSetupStatus(
  options: { enabled?: boolean } = {},
): UseQueryResult<SetupStatus, Error> {
  return useQuery({
    queryKey: accountingKeys.setupStatus(),
    queryFn: getAccountingSetupStatus,
    enabled: options.enabled ?? true,
  });
}

/** The template preview for the chosen VAT rate and bank count. Keyed on both. */
export function useAccountingSetupTemplate(
  params: { vatRate: number; banks: number },
  options: { enabled?: boolean } = {},
): UseQueryResult<SetupTemplate, Error> {
  return useQuery({
    queryKey: accountingKeys.setupTemplate(params.vatRate, params.banks),
    queryFn: () => getAccountingSetupTemplate(params),
    enabled: options.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Installing the template creates the chart, the profiles, the fiscal year and the bank
 * accounts at once, so every accounting query — the guide and readiness included, which share
 * the `accounting` root — is invalidated. It is the milestone of the whole module: the success
 * dialog, not a toast.
 */
export function useRunAccountingSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AccountingSetupBody): Promise<AccountingSetupResult> =>
      runAccountingSetup(body),
    meta: {
      successDialog: {
        title: 'accounting.feedback.setupCompleteTitle',
        description: 'accounting.feedback.setupCompleteBody',
      },
      flashRow: false,
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: accountingKeys.all });
      void qc.invalidateQueries({ queryKey: ['procurement'] });
    },
  });
}

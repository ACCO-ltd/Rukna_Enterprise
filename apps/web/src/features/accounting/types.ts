/**
 * Response shapes for the accounting module.
 *
 * Read from `apps/api/src/business/accounting/**` and `schema.prisma` on 2026-08-09, not from
 * `api-reference.md` §6.13–6.23 — that section documents a create-bill body with three wrong
 * field names, a create-account body missing a required field, and GL account codes that do
 * not exist in the seeded chart. Every one of those defects is recorded as A4–A8 in
 * `docs/backend-requests/frontend-blockers.md`.
 *
 * All monetary values are decimal STRINGS. See `@/lib/money`.
 */

export type AccountClass =
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'INCOME'
  | 'COST_OF_SALES'
  | 'EXPENSE';

export type NormalBalance = 'DEBIT' | 'CREDIT';

export type AccountStatus = 'ACTIVE' | 'INACTIVE';

/**
 * `schema.prisma:2245`. `CreateAccountDto` only accepts the first two — the third is what the
 * seeded bank accounts carry, so an account of that kind cannot be created through the API
 * (A6). Read paths must still understand it.
 */
export type ControlPostingPolicy =
  | 'UNRESTRICTED'
  | 'SYSTEM_ONLY'
  | 'SYSTEM_OR_APPROVED_ADJUSTMENT';

export type SubledgerType = 'ACCOUNTS_RECEIVABLE' | 'ACCOUNTS_PAYABLE';

/**
 * Everything an account is *called* lives on its version, not on the account.
 *
 * `Account` carries only `id`, `code`, `normalBalance` and `status` — a code and a direction
 * never change, so they are not versioned. Name, class, subtype, parent and the posting flags
 * all do change, and each change is a new `AccountVersion` with its own effective range.
 */
export interface AccountVersion {
  id: string;
  accountId: string;
  versionNumber: number;
  name: string;
  nameAr: string | null;
  parentAccountId: string | null;
  accountClass: AccountClass;
  accountSubtype: string;
  isPostingAllowed: boolean;
  isControlAccount: boolean;
  controlledSubledgerType: SubledgerType | null;
  controlPostingPolicy: ControlPostingPolicy;
  /** `effectiveTo` is EXCLUSIVE — the range is `[effectiveFrom, effectiveTo)`. */
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * `GET /accounts` and `GET /accounts/:id`.
 *
 * The list includes `versions` with `take: 1` ordered by `versionNumber` descending — the
 * LATEST version, which is not necessarily the one effective today if a future-dated change
 * has been recorded. `currentVersion` in `account-display.ts` is where that distinction is
 * handled rather than at every call site.
 */
export interface Account {
  id: string;
  organizationId: string;
  code: string;
  normalBalance: NormalBalance;
  status: AccountStatus;
  createdAt: string;
  createdBy: string;
  versions: AccountVersion[];
}

// ─── Fiscal years and periods ────────────────────────────────────────────────────

/**
 * `schema.prisma:1039` — four values, defaulting to DRAFT.
 *
 * `api-reference.md` §6.14 documents only `OPEN` and `CLOSED`. A fiscal year created through
 * `POST /fiscal-years` starts DRAFT, so the two the reference omits are the two a new
 * organisation sees first.
 */
export type FiscalYearStatus = 'DRAFT' | 'OPEN' | 'LOCKED' | 'CLOSED';

export type PeriodStatus = 'OPEN' | 'LOCKED' | 'CLOSED' | 'REOPENED';

export type PeriodType = 'OPERATING' | 'ADJUSTMENT';

export interface AccountingPeriod {
  id: string;
  fiscalYearId: string;
  organizationId: string;
  periodNumber: number;
  name: string;
  startDate: string;
  endDate: string;
  periodType: PeriodType;
  status: PeriodStatus;
  reopenReason: string | null;
  reopenedBy: string | null;
  reopenedAt: string | null;
  createdAt: string;
}

/**
 * `GET /fiscal-years` and `GET /fiscal-years/:id`.
 *
 * Both embed `periods` ordered by `periodNumber` (`fiscal-year.repository.ts:19,26`). There is
 * no `GET /periods` collection at all — the period controller exposes only the lifecycle
 * actions — so the fiscal year is the only way to enumerate periods (A10).
 */
export interface FiscalYear {
  id: string;
  organizationId: string;
  name: string;
  startDate: string;
  endDate: string;
  retainedEarningsAccountId: string;
  status: FiscalYearStatus;
  closedAt: string | null;
  closedBy: string | null;
  createdAt: string;
  createdBy: string;
  periods: AccountingPeriod[];
}

// ─── Manual journals ─────────────────────────────────────────────────────────────

export type JournalStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'POSTED'
  | 'REVERSED';

export type JournalCategory =
  | 'GENERAL'
  | 'ACCOUNTS_RECEIVABLE'
  | 'ACCOUNTS_PAYABLE'
  | 'CASH_AND_BANK'
  | 'OPENING_BALANCE'
  | 'CLOSING_ADJUSTMENT';

export type EntryPurpose = 'NORMAL' | 'REVERSAL' | 'REPLACEMENT' | 'CLOSING' | 'OPENING_BALANCE';

/**
 * A line on a journal entry.
 *
 * ⚠ `accountCodeSnapshot` and `accountNameSnapshot` are EMPTY STRINGS on a DRAFT
 * (`manual-journal.service.ts:91-93` writes `''`). They are filled at post time, when the
 * posting engine resolves the effective `AccountVersion`. A draft's lines therefore identify
 * their account only by `accountId`, and the UI has to resolve the name from `GET /accounts` —
 * see `lineAccountLabel` in `account-display.ts`.
 */
export interface JournalLine {
  id: string;
  journalEntryId: string;
  lineNumber: number;
  accountId: string;
  accountVersionId: string | null;
  /** Empty until the entry is posted. */
  accountCodeSnapshot: string;
  /** Empty until the entry is posted. */
  accountNameSnapshot: string;
  accountVersionNumber: number;
  debitAmount: string;
  creditAmount: string;
  transactionCurrencyCode: string;
  baseCurrencyAmount: string;
  description: string | null;
  projectId: string | null;
  departmentId: string | null;
  costCenterId: string | null;
}

/** `GET /journals` and `GET /journals/:id` — both include `lines` ordered by `lineNumber`. */
export interface JournalEntry {
  id: string;
  organizationId: string;
  journalNumber: string | null;
  accountingPeriodId: string | null;
  journalCategory: JournalCategory;
  entryPurpose: EntryPurpose;
  status: JournalStatus;
  documentDate: string;
  accountingDate: string;
  postedAt: string | null;
  description: string;
  currencyCode: string;
  sourceDocumentType: string | null;
  sourceDocumentId: string | null;
  reversalOfJournalEntryId: string | null;
  createdBy: string;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  postedBy: string | null;
  createdAt: string;
  lines: JournalLine[];
}

/**
 * Body for `POST /journals`.
 *
 * `debitAmount` and `creditAmount` are JS NUMBERS, not decimal strings — the whole accounting
 * write path is (A9). The service converts to `Decimal` on arrival and never sums in floating
 * point, so there is no live precision bug, but the conversion has to happen here and it must
 * happen exactly once. `toJournalPayload` in `journal-entry.ts` is the only place that does it.
 */
export interface CreateJournalPayload {
  accountingDate: string;
  documentDate?: string;
  description: string;
  currencyCode: string;
  lines: Array<{
    accountId: string;
    debitAmount?: number;
    creditAmount?: number;
    transactionCurrencyCode?: string;
    memo?: string;
    projectId?: string;
  }>;
}

export interface ApproveJournalPayload {
  approved: boolean;
  /** Required by the server when `approved` is false. */
  rejectionReason?: string;
}

export interface ReverseJournalPayload {
  reversalDate: string;
  reason: string;
}

// ─── Reports ─────────────────────────────────────────────────────────────────────

export interface TrialBalanceLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountClass: AccountClass;
  accountSubtype: string;
  openingDebit: string;
  openingCredit: string;
  periodDebit: string;
  periodCredit: string;
  closingDebit: string;
  closingCredit: string;
}

export interface TrialBalance {
  asOfDate: string;
  generatedAt: string;
  organizationId: string;
  totalOpeningDebit: string;
  totalOpeningCredit: string;
  totalPeriodDebit: string;
  totalPeriodCredit: string;
  totalClosingDebit: string;
  totalClosingCredit: string;
  /** Server-computed: closing debits equal closing credits within $0.01. */
  balanced: boolean;
  lines: TrialBalanceLine[];
}

export interface ProfitLossLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountClass: AccountClass;
  accountSubtype: string;
  amount: string;
}

export interface ProfitLossSection {
  label: string;
  total: string;
  lines: ProfitLossLine[];
}

/** `GET /reports/pl`. Entries with `entryPurpose = CLOSING` are excluded server-side. */
export interface ProfitLoss {
  fromDate: string;
  toDate: string;
  organizationId: string;
  projectId?: string;
  departmentId?: string;
  generatedAt: string;
  revenue: ProfitLossSection;
  costOfSales: ProfitLossSection;
  grossProfit: string;
  expenses: ProfitLossSection;
  netIncome: string;
}

// ─── Balance sheet ───────────────────────────────────────────────────────────────

export interface BalanceSheetLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountSubtype: string;
  balance: string;
  comparativeBalance?: string;
}

export interface BalanceSheetSection {
  label: string;
  total: string;
  comparativeTotal?: string;
  lines: BalanceSheetLine[];
}

/**
 * `GET /reports/balance-sheet`.
 *
 * `equity` includes Current Year Earnings, computed as a live P&L for an open fiscal year —
 * which is why the sheet balances before the year is closed. A CLOSED period is read from its
 * frozen snapshot.
 */
export interface BalanceSheet {
  asOfDate: string;
  comparativeDate?: string;
  organizationId: string;
  generatedAt: string;
  assets: BalanceSheetSection;
  liabilities: BalanceSheetSection;
  equity: BalanceSheetSection;
  totalLiabilitiesAndEquity: string;
  /** Assets = Liabilities + Equity, within $0.01. */
  balanced: boolean;
  comparativeTotalLiabilitiesAndEquity?: string;
  comparativeBalanced?: boolean;
}

// ─── Account ledger ──────────────────────────────────────────────────────────────

export interface LedgerLine {
  journalEntryId: string;
  journalNumber: string;
  accountingDate: string;
  documentDate: string;
  description: string;
  reference: string | null;
  debitAmount: string;
  creditAmount: string;
  /** Server-computed, carried forward from `openingBalance` down the rows. */
  runningBalance: string;
  sourceDocumentType: string | null;
  sourceDocumentId: string | null;
  projectId: string | null;
  departmentId: string | null;
  costCenterId: string | null;
}

/** `GET /reports/ledger/:accountId`. POSTED entries only. */
export interface AccountLedger {
  accountId: string;
  accountCode: string;
  accountName: string;
  openingBalance: string;
  periodDebit: string;
  periodCredit: string;
  closingBalance: string;
  lines: LedgerLine[];
}

// ─── Monthly P&L comparison ──────────────────────────────────────────────────────

export interface MonthlyPLColumn {
  periodNumber: number;
  periodName: string;
  revenue: string;
  costOfSales: string;
  grossProfit: string;
  expenses: string;
  netIncome: string;
}

/**
 * `GET /reports/pl/monthly/:fiscalYearId` — one column per period.
 *
 * ⚠ Returns `null` with a **200**, not a 404, when the fiscal year does not exist
 * (`pl-report.service.ts:180`). The hook has to treat a null body as "not found" itself.
 */
export interface MonthlyPL {
  fiscalYearId: string;
  fiscalYearName: string;
  columns: MonthlyPLColumn[];
}

/**
 * `GET /periods/:id/close-gate` — the pre-flight for closing a period.
 *
 * Returns the blockers rather than throwing, so they can be shown before anyone presses
 * Close. `closePeriod` performs the same check and throws a 400 with the list joined into one
 * sentence, which is a far worse way to find out.
 */
export interface CloseGate {
  passed: boolean;
  blockers: string[];
}

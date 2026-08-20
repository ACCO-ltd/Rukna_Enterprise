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

// ─── Client invoices (AR) ────────────────────────────────────────────────────────

/**
 * `schema.prisma` `PostingStatus` — the ledger axis, shared by every document that posts:
 * client invoices, supplier bills, payments and receipts.
 *
 * `OPENING_BALANCE` marks a subledger row loaded by the migration wizard, whose GL effect is
 * covered by the aggregate opening journal rather than by an entry of its own. It is deliberately
 * excluded from the period-close "unposted approved documents" gate, so it must not be rendered
 * as an error state — it is a settled, historical row.
 *
 * `PENDING` and `FAILED` exist for the posting engine's retry path. A FAILED document carries
 * `lastPostingErrorCode` and can be posted again.
 */
export type PostingStatus =
  | 'NOT_POSTED'
  | 'PENDING'
  | 'POSTED'
  | 'FAILED'
  | 'REVERSED'
  | 'OPENING_BALANCE';

/**
 * `schema.prisma` `InvoiceDocStatus` — three values, defaulting to DRAFT.
 *
 * Note what is absent: there is no SUBMITTED step and no REJECTED. A supplier bill has five
 * document states and a four-step approval; a client invoice has one approval and no way back
 * except CANCELLED. Do not reuse the bill's lifecycle component here.
 */
export type InvoiceDocStatus = 'DRAFT' | 'APPROVED' | 'CANCELLED';

/**
 * `GET /invoices`, `GET /invoices/:id`, and the body every lifecycle action returns.
 *
 * ─── Two independent status axes ────────────────────────────────────────────────
 *
 * `documentStatus` is the approval axis and `postingStatus` is the ledger axis. They advance
 * separately: an invoice is APPROVED before it can post, and posting moves only
 * `postingStatus`. A single badge cannot express the pair, which is why there are two.
 *
 * ─── `invoiceNumber` is null until it posts ─────────────────────────────────────
 *
 * The `INV-` sequence is drawn inside the posting transaction (`client-invoice.service.ts:146`),
 * not at creation. Every DRAFT and every APPROVED-but-unposted invoice therefore has a null
 * number, and no list may key a row or a heading on it.
 *
 * ─── No `client` relation ───────────────────────────────────────────────────────
 *
 * `ClientInvoiceRepository.findAll` embeds nothing (`client-invoice.repository.ts:37`), so the
 * client name is unresolvable from this payload alone. P16 fixed exactly this on the AP side
 * by including `supplier`; AR did not get the same treatment. Screens join against
 * `GET /clients`, which the app already fetches.
 *
 * Money is a decimal string on the way out and a JSON number on the way in (A9) — parse with
 * `src/lib/money.ts` rather than `Number`.
 */
export interface ClientInvoice {
  id: string;
  organizationId: string;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  clientId: string;
  /** The effective IPC this invoice was generated from. Null only for migrated records. */
  sourceIpcId: string | null;
  projectId: string | null;
  contractId: string | null;
  currencyCode: string;
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
  /** Falls as receipts are allocated. Equals `totalAmount` until the first allocation. */
  outstandingAmount: string;
  paymentTerms: string | null;
  documentStatus: InvoiceDocStatus;
  postingStatus: PostingStatus;
  postedJournalEntryId: string | null;
  postedAt: string | null;
  postedBy: string | null;
  reversedAt: string | null;
  reversalJournalEntryId: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  createdBy: string;
}

/** Body of `POST /invoices/from-ipc`. Dates are `YYYY-MM-DD`. */
export interface GenerateInvoicePayload {
  ipcId: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms?: string;
}

/**
 * Body of `POST /invoices/from-installment` (ADR-023 MILESTONE contracts). Dates are
 * `YYYY-MM-DD`. The server enforces the CONST-COM-011 gate: a 400 when the installment's linked
 * programme milestone is not yet verified.
 */
export interface GenerateInvoiceFromInstallmentPayload {
  installmentId: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms?: string;
}

/**
 * Body of `POST /invoices/:id/post`.
 *
 * Codes, not ids — resolved by `posting-accounts.ts`. `vatAccountCode` is omitted when the
 * invoice carries no VAT; the server only looks at it when `vatAmount > 0`.
 */
export interface PostInvoicePayload {
  arAccountCode: string;
  revenueAccountCode: string;
  vatAccountCode?: string;
}

/** Body of `POST /invoices/:id/reverse`. `reason` is capped at 500 characters server-side. */
export interface ReverseInvoicePayload {
  reversalDate: string;
  reason: string;
}

// ─── Posting profiles ────────────────────────────────────────────────────────────

/**
 * A version of a posting profile — the GL account it resolves to, over a date range.
 *
 * `effectiveTo` is **exclusive**: a version covers `[effectiveFrom, effectiveTo)`. The
 * controller returns only the newest version (`orderBy effectiveFrom desc, take: 1`), so a
 * profile whose newest version has not started yet still arrives as that version, and there
 * is no way to ask which one applies on a given date.
 */
export interface PostingProfileVersion {
  id: string;
  versionNumber: number;
  name: string;
  description: string | null;
  accountId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * `GET /posting-profiles` — live since `7cf2507` (A3 / #26).
 *
 * A profile maps a code onto the GL account a supplier bill line posts its expense to.
 * `CreateSupplierBillLineDto.expenseProfileCode` takes the `code`, and the server resolves
 * the account server-side at post time.
 *
 * **The response says nothing about what kind of account that is.** The controller embeds
 * `versions` but not the account behind `accountId`, so a profile pointing at a revenue
 * account is indistinguishable from one pointing at an expense account without joining
 * against `GET /accounts`. That matters: the seed creates four profiles and one of them,
 * `PROJECT_REVENUE`, points at income. See `expenseProfiles()` in
 * `features/procurement/bill-actions.ts`.
 *
 * Note also that the seeded codes are `PROJECT_REVENUE`, `MATERIAL_PURCHASE`,
 * `SUBCONTRACT_COST` and `OFFICE_EXPENSE` — **not** the `GENERAL-EXPENSE` that
 * `api-reference.md` §6.20 and `CreateSupplierBillLineDto`'s own example both use. A body
 * copied from either fails to resolve (A4, A8).
 */
export interface PostingProfile {
  id: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE';
  versions: PostingProfileVersion[];
}

// ─── Bank accounts ───────────────────────────────────────────────────────────────

/**
 * `GET /bank-accounts` — live, and seeded (two accounts, on GL 10100 and 10200).
 *
 * Distinct from the GL account it points at, and both are needed on a payment:
 * `POST /payments` takes the `bankAccountId` (this entity), while `POST /payments/:id/post`
 * takes a `bankGlCode` (the account's code). `glAccountId` is the bridge, and it is `@unique`
 * — one bank account per GL account, so the mapping is never ambiguous.
 *
 * Prefer this over `bankAccounts()` in `posting-accounts.ts` wherever a payment or receipt is
 * involved. That helper scans the chart for the `CASH_AND_BANK` subtype, which finds GL rows
 * that may have no bank account behind them and cannot see `allowsPayments` or `status`.
 */
export interface BankAccount {
  id: string;
  glAccountId: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  iban: string | null;
  swiftCode: string | null;
  currencyCode: string;
  branch: string | null;
  /** A receipts-only account must not appear in a payment picker. */
  allowsReceipts: boolean;
  allowsPayments: boolean;
  isReconcilable: boolean;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
}

/**
 * Body of `POST /fiscal-years`.
 *
 * `year` is `@IsInt() @Min(2000) @Max(2100)` — a calendar year, not a date range. The range is
 * derived server-side from the organisation's fiscal calendar policy.
 *
 * `retainedEarningsAccountCode` is the GL **code**, not an id, and the account must already
 * exist (404 otherwise). The seeded chart uses `31000`; §6.14's example says `3100`, which is
 * four digits against a five-digit chart and resolves to nothing (A8).
 */
export interface CreateFiscalYearPayload {
  year: number;
  retainedEarningsAccountCode: string;
}

// ─── Opening balance migration and reconciliation ────────────────────────────────

/** One control account compared against its subledger. Money is decimal strings. */
export interface ReconciliationLine {
  label: string;
  glBalance: string;
  subledgerBalance: string;
  variance: string;
  reconciled: boolean;
}

/**
 * What `POST /accounting/opening-balance` returns.
 *
 * `readyForCfoApproval` is the server's own judgement, not a status on any record — there is no
 * approval endpoint behind it. It reads as an instruction to a human.
 */
export interface MigrationReport {
  batchReference: string;
  cutoverDate: string;
  openingBalanceJournalId: string;
  openingBalanceJournalNumber: string;
  arInvoicesImported: number;
  apBillsImported: number;
  reconciliation: ReconciliationLine[];
  zeroVariance: boolean;
  readyForCfoApproval: boolean;
}

/**
 * Body of `POST /accounting/reconcile`.
 *
 * `bankAccountCodes` is `@IsArray() @IsOptional()` with no `@IsString({ each: true })`, so the
 * server would accept an array of anything. Sent as GL codes, which is what it reads.
 */
export interface RunReconciliationPayload {
  arAccountCode: string;
  apAccountCode: string;
  bankAccountCodes?: string[];
  periodId?: string;
}

/**
 * One control account as `POST /accounting/reconcile` reports it.
 *
 * Note this is **not** the same shape the migration report uses for the same idea: that one
 * carries a `label`, this one carries `accountCode`, `accountName` and `subledgerType`. Two
 * shapes for one concept, from two endpoints in the same module — worth knowing before writing
 * a component that tries to render both.
 */
export interface ControlAccountCheck {
  accountCode: string;
  accountName: string;
  subledgerType: 'AR' | 'AP' | 'BANK';
  glBalance: string;
  subledgerBalance: string;
  variance: string;
  reconciled: boolean;
  periodId?: string;
}

export interface ReconciliationReport {
  organizationId: string;
  generatedAt: string;
  checks: ControlAccountCheck[];
  allReconciled: boolean;
  /** A variance over 0.01 blocks period close. The close-gate reads the same rule. */
  blocksClose: boolean;
}

/**
 * ─── Accounting setup from a template (ADR-040) ─────────────────────────────────
 *
 * `POST /accounting/setup` installs, in one transaction, everything an organisation needs to
 * start posting: the policy rows, the construction chart of accounts, tax codes (only when VAT
 * is charged), the posting profiles, the first fiscal year with twelve open periods and one bank
 * account per bank the user names. It is allowed once — while the chart is empty.
 *
 * What the person decides at install time lives here as a draft: whether VAT is charged and at
 * what rate, which banks the company uses, and the first fiscal year. Everything else is the
 * template, previewed read-only through `GET /accounting/setup/template` before anything is
 * written.
 *
 * Pure functions only — the dialog renders, this module decides.
 */

import type { AccountClass, NormalBalance } from './types';

// ─── API shapes ──────────────────────────────────────────────────────────────────

/** A template row. `conditional` marks rows that exist only because of an install-time choice. */
export interface SetupTemplateAccount {
  code: string;
  name: string;
  accountClass: AccountClass;
  accountSubtype: string;
  normalBalance: NormalBalance;
  isHeading: boolean;
  parentCode: string | null;
  isControlAccount: boolean;
  conditional?: 'VAT' | 'BANK';
}

export interface SetupTemplatePostingProfile {
  code: string;
  name: string;
  accountCode: string;
}

/** `GET /accounting/setup/template?vatRate=&banks=`. */
export interface SetupTemplate {
  templateId: 'CONSTRUCTION';
  version: string;
  accounts: SetupTemplateAccount[];
  postingProfiles: SetupTemplatePostingProfile[];
}

/** `GET /accounting/setup/status`. */
/** Setup records that can exist without a chart — and then block the one-step install. */
export type ExistingSetupRecord =
  'TAX_CODES' | 'POSTING_PROFILES' | 'BANK_ACCOUNTS' | 'FISCAL_YEARS';

export interface SetupStatus {
  canInstall: boolean;
  /**
   * PARTIAL_SETUP: the chart is empty but some other setup records exist, so the template cannot
   * be installed over them.
   */
  reason: 'READY' | 'CHART_NOT_EMPTY' | 'PARTIAL_SETUP';
  accountCount: number;
  hasFiscalYear: boolean;
  hasPolicies: boolean;
  /** What blocks the install when `reason` is PARTIAL_SETUP; empty otherwise. */
  existingRecords: ExistingSetupRecord[];
  /**
   * ADR-041: the default sales tax Finance already configured. When set, setup leaves tax as it
   * is — the VAT answer is ignored and no tax codes are created.
   */
  defaultSalesTax?: { code: string; name: string; ratePercent: string } | null;
}

/** Body of `POST /accounting/setup`. */
export interface AccountingSetupBody {
  templateId: 'CONSTRUCTION';
  vat: { charged: boolean; ratePercent?: number };
  banks: Array<{ accountName: string; bankName: string; accountNumber?: string }>;
  fiscalYear: { year: number; startMonth: number };
}

export interface AccountingSetupResult {
  accountsCreated: number;
  postingProfilesCreated: number;
  fiscalYear: { id: string; name: string };
  bankAccountsCreated: number;
  taxCodesCreated: number;
}

// ─── The draft ───────────────────────────────────────────────────────────────────

/** A bank can be named at most this many times in one install. */
export const MAX_SETUP_BANKS = 20;

/** Operating periods the first fiscal year opens with. */
export const SETUP_PERIOD_COUNT = 12;

export type VatMode = 'none' | 'charged';

export interface SetupBankDraft {
  /** Client-only row identity, so removing a row never shifts another row's inputs. */
  key: string;
  accountName: string;
  bankName: string;
  accountNumber: string;
}

export interface SetupDraft {
  /** `''` until the person chooses — VAT is a decision, not a default. */
  vatMode: VatMode | '';
  vatRate: string;
  banks: SetupBankDraft[];
  year: string;
  /** 1–12. */
  startMonth: number;
}

let bankKeySeq = 0;

export function emptyBankDraft(): SetupBankDraft {
  bankKeySeq += 1;
  return { key: `bank-${bankKeySeq}`, accountName: '', bankName: '', accountNumber: '' };
}

export function initialSetupDraft(today: Date = new Date()): SetupDraft {
  return {
    vatMode: '',
    vatRate: '',
    banks: [emptyBankDraft()],
    year: String(today.getFullYear()),
    startMonth: 1,
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────────

/** A VAT rate as typed: up to two decimals, 0 < r ≤ 100. `null` when it is not one. */
export function parseVatRate(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const rate = Number(text);
  if (!(rate > 0) || rate > 100) return null;
  return rate;
}

/** A four-digit year the API accepts (`@Min(2000) @Max(2100)`). */
export function parseSetupYear(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{4}$/.test(text)) return null;
  const year = Number(text);
  return year >= 2000 && year <= 2100 ? year : null;
}

export type BankRowProblem = 'accountName' | 'bankName';

export interface SetupProblems {
  vatChoice: boolean;
  vatRate: boolean;
  year: boolean;
  tooManyBanks: boolean;
  /** Per bank row key: which fields are missing. Rows with nothing wrong are absent. */
  banks: Record<string, BankRowProblem[]>;
}

export function setupProblems(draft: SetupDraft): SetupProblems {
  const banks: Record<string, BankRowProblem[]> = {};
  for (const bank of draft.banks) {
    const missing: BankRowProblem[] = [];
    if (!bank.accountName.trim()) missing.push('accountName');
    if (!bank.bankName.trim()) missing.push('bankName');
    if (missing.length > 0) banks[bank.key] = missing;
  }

  return {
    vatChoice: draft.vatMode === '',
    vatRate: draft.vatMode === 'charged' && parseVatRate(draft.vatRate) === null,
    year: parseSetupYear(draft.year) === null,
    tooManyBanks: draft.banks.length > MAX_SETUP_BANKS,
    banks,
  };
}

export function hasSetupProblems(problems: SetupProblems): boolean {
  return (
    problems.vatChoice ||
    problems.vatRate ||
    problems.year ||
    problems.tooManyBanks ||
    Object.keys(problems.banks).length > 0
  );
}

// ─── What gets sent ──────────────────────────────────────────────────────────────

/** The rate as a number when VAT is charged, 0 otherwise — what the template preview takes. */
export function previewVatRate(draft: SetupDraft): number {
  return draft.vatMode === 'charged' ? (parseVatRate(draft.vatRate) ?? 0) : 0;
}

/**
 * The exact `POST /accounting/setup` body. Only call once `setupProblems` is clean.
 * An empty account number is omitted rather than sent as `''` — it is optional server-side.
 */
export function toSetupBody(draft: SetupDraft): AccountingSetupBody {
  const charged = draft.vatMode === 'charged';
  const rate = parseVatRate(draft.vatRate);
  return {
    templateId: 'CONSTRUCTION',
    vat: charged && rate !== null ? { charged: true, ratePercent: rate } : { charged: false },
    banks: draft.banks.map((bank) => {
      const accountNumber = bank.accountNumber.trim();
      return {
        accountName: bank.accountName.trim(),
        bankName: bank.bankName.trim(),
        ...(accountNumber ? { accountNumber } : {}),
      };
    }),
    fiscalYear: {
      year: parseSetupYear(draft.year) ?? new Date().getFullYear(),
      startMonth: draft.startMonth,
    },
  };
}

// ─── Fiscal year range ───────────────────────────────────────────────────────────

/** The month name for 1–12 in the given locale. */
export function monthName(month: number, locale = 'en'): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, month - 1, 1)),
  );
}

/**
 * The twelve months the first fiscal year covers: it starts in `startMonth` of `year` and ends
 * eleven months later — "January 2026 – December 2026", or "July 2026 – June 2027".
 */
export function fiscalYearRange(
  year: number,
  startMonth: number,
  locale = 'en',
): { start: string; end: string } {
  const fmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const start = new Date(Date.UTC(year, startMonth - 1, 1));
  const end = new Date(Date.UTC(year, startMonth - 1 + SETUP_PERIOD_COUNT - 1, 1));
  return { start: fmt.format(start), end: fmt.format(end) };
}

/** `FY2026` for a January start, `FY2026/27` otherwise — the name the API gives the year. */
export function fiscalYearName(year: number, startMonth: number): string {
  if (startMonth === 1) return `FY${year}`;
  return `FY${year}/${String((year + 1) % 100).padStart(2, '0')}`;
}

// ─── The chart preview ───────────────────────────────────────────────────────────

export const CLASS_ORDER: AccountClass[] = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'COST_OF_SALES',
  'EXPENSE',
];

export interface ChartPreviewRow {
  account: SetupTemplateAccount;
  /** 0 for a top-level row. */
  depth: number;
  /** The name as it will be installed — a bank row carries the bank the person typed. */
  displayName: string;
}

export interface ChartPreviewGroup {
  accountClass: AccountClass;
  rows: ChartPreviewRow[];
}

/**
 * The template as an indented tree, grouped by class, reflecting the install-time choices.
 *
 * - VAT-only rows are dropped when VAT is not charged. The server should already omit them for
 *   `vatRate=0`; dropping them here too keeps the preview honest if it does not.
 * - The n-th BANK row is named after the n-th bank typed in step 1, in order, instead of the
 *   template's placeholder name.
 * - Children follow their parent (depth-first, in template order). A row whose parent is not in
 *   the template is treated as top-level rather than hidden.
 */
export function buildChartPreview(
  template: SetupTemplate,
  choices: { vatCharged: boolean; bankNames: readonly string[] },
): ChartPreviewGroup[] {
  const kept = template.accounts.filter(
    (account) => choices.vatCharged || account.conditional !== 'VAT',
  );

  const bankName = new Map<string, string>();
  let bankIndex = 0;
  for (const account of kept) {
    if (account.conditional !== 'BANK') continue;
    const typed = choices.bankNames[bankIndex]?.trim();
    if (typed) bankName.set(account.code, typed);
    bankIndex += 1;
  }

  const codes = new Set(kept.map((account) => account.code));
  const children = new Map<string, SetupTemplateAccount[]>();
  const roots: SetupTemplateAccount[] = [];
  for (const account of kept) {
    if (
      account.parentCode &&
      codes.has(account.parentCode) &&
      account.parentCode !== account.code
    ) {
      const list = children.get(account.parentCode) ?? [];
      list.push(account);
      children.set(account.parentCode, list);
    } else {
      roots.push(account);
    }
  }

  const ordered: ChartPreviewRow[] = [];
  const seen = new Set<string>();
  const visit = (account: SetupTemplateAccount, depth: number) => {
    if (seen.has(account.code)) return;
    seen.add(account.code);
    ordered.push({
      account,
      depth,
      displayName: bankName.get(account.code) ?? account.name,
    });
    for (const child of children.get(account.code) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  // A parent cycle would leave rows unreached; show them flat rather than lose them.
  for (const account of kept) visit(account, 0);

  return CLASS_ORDER.map((accountClass) => ({
    accountClass,
    rows: ordered.filter((row) => row.account.accountClass === accountClass),
  })).filter((group) => group.rows.length > 0);
}

export function previewAccountCount(groups: readonly ChartPreviewGroup[]): number {
  return groups.reduce((sum, group) => sum + group.rows.length, 0);
}

// ─── Errors ──────────────────────────────────────────────────────────────────────

export type SetupConflict =
  { kind: 'already' } | { kind: 'partial'; existingRecords: ExistingSetupRecord[] };

/**
 * Why `POST /accounting/setup` refused to install, when it is one of its two 409s:
 * `ACCOUNTING_ALREADY_SET_UP` (the chart has accounts) or `ACCOUNTING_PARTIALLY_SET_UP` (no
 * chart, but tax codes / profiles / banks / years exist — listed in `details.existingRecords`).
 * `null` for any other error.
 */
export function setupConflict(error: unknown): SetupConflict | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as { status?: unknown; code?: unknown; message?: unknown; details?: unknown };
  const details = (e.details ?? {}) as Record<string, unknown>;
  if (e.code === 'ACCOUNTING_PARTIALLY_SET_UP') {
    const records = Array.isArray(details.existingRecords)
      ? (details.existingRecords as ExistingSetupRecord[])
      : [];
    return { kind: 'partial', existingRecords: records };
  }
  const code = 'ACCOUNTING_ALREADY_SET_UP';
  if (
    e.code === code ||
    details.code === code ||
    e.status === 409 ||
    (typeof e.message === 'string' && e.message.includes(code))
  ) {
    return { kind: 'already' };
  }
  return null;
}

/** "tax codes, posting profiles and bank accounts" — the records in plain words, as a list. */
export function existingRecordsList(
  records: readonly ExistingSetupRecord[],
  label: (record: ExistingSetupRecord) => string,
  locale = 'en',
): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
    records.map(label),
  );
}

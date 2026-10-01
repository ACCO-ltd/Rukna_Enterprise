/**
 * ADR-040 — the construction chart-of-accounts template.
 *
 * DATA, not logic: every row here is exactly the chart ADR-040 lists. Changing it affects only
 * organisations that install it afterwards — an installed chart is ordinary data, edited through
 * the chart-of-accounts screens. Pending content sign-off by Eng Ahmed Shirie / ACCO's accountant.
 *
 * Rows that depend on install-time choices are not listed here:
 *   - one CASH_AND_BANK account per bank the user names (codes 10100, 10101, … under 10000) —
 *     built by `resolveTemplate`;
 *   - No input-VAT asset: ACCO's input VAT is non-recoverable (ADR-006 ACC-TAX-001, ADR-041) — it is
 *     absorbed into the cost a bill posts to, so there is never a balance to hold.
 *
 * Invariants (enforced by `resolveTemplate` callers' tests, see construction.template.spec.ts):
 *   - exactly one ACTIVE account each of the six resolver roles; no heading carries one;
 *   - at least one CASH_AND_BANK (10900 Petty cash is always present);
 *   - every parent precedes its child; codes are unique.
 */
import type { AccountClass, AccountSubtype, ControlPostingPolicy, SubledgerType } from '@prisma/client';

export const CONSTRUCTION_TEMPLATE_ID = 'CONSTRUCTION' as const;
export const CONSTRUCTION_TEMPLATE_VERSION = '2026-09-30';

export type NormalBalanceValue = 'DEBIT' | 'CREDIT';

export interface TemplateAccount {
  code: string;
  name: string;
  accountClass: AccountClass;
  accountSubtype: AccountSubtype;
  normalBalance: NormalBalanceValue;
  /** Headings group children and never accept postings (`isPostingAllowed: false`). */
  isHeading: boolean;
  parentCode: string | null;
  isControlAccount: boolean;
  /** False for headings, control accounts, and accounts only the system may ever fill (32000). */
  isPostingAllowed: boolean;
  controlledSubledgerType: SubledgerType | null;
  controlPostingPolicy: ControlPostingPolicy;
  /** Present only on rows that exist because of an install-time choice. */
  conditional?: 'VAT' | 'BANK';
}

export interface TemplatePostingProfile {
  code: string;
  name: string;
  accountCode: string;
}

/** The six roles `PostingAccountResolver` resolves to exactly one ACTIVE account. */
export const RESOLVER_SUBTYPES: readonly AccountSubtype[] = [
  'ACCOUNTS_RECEIVABLE',
  'ACCOUNTS_PAYABLE',
  'PROJECT_REVENUE',
  'VAT_OUTPUT_PAYABLE',
  'UNAPPLIED_CLIENT_RECEIPTS',
  'SUPPLIER_ADVANCE',
] as AccountSubtype[];

// ── Row builders ──────────────────────────────────────────────────────────────

const CREDIT_CLASSES: readonly string[] = ['LIABILITY', 'EQUITY', 'INCOME'];

function normalBalanceOf(accountClass: string, accountSubtype: string): NormalBalanceValue {
  if (accountSubtype === 'ACCUMULATED_DEPRECIATION') return 'CREDIT'; // contra-asset
  return CREDIT_CLASSES.includes(accountClass) ? 'CREDIT' : 'DEBIT';
}

function row(
  code: string,
  name: string,
  accountClass: string,
  accountSubtype: string,
  opts: {
    heading?: boolean;
    parent?: string;
    control?: SubledgerType;
    policy?: ControlPostingPolicy;
    conditional?: 'VAT' | 'BANK';
    /** A non-heading account that accepts no postings at all. */
    noPosting?: boolean;
  } = {},
): TemplateAccount {
  return {
    code,
    name,
    accountClass: accountClass as AccountClass,
    accountSubtype: accountSubtype as AccountSubtype,
    normalBalance: normalBalanceOf(accountClass, accountSubtype),
    isHeading: opts.heading ?? false,
    parentCode: opts.parent ?? null,
    isControlAccount: opts.control !== undefined,
    isPostingAllowed: !(opts.heading ?? false) && opts.control === undefined && !opts.noPosting,
    controlledSubledgerType: opts.control ?? null,
    controlPostingPolicy: opts.policy ?? ('UNRESTRICTED' as ControlPostingPolicy),
    ...(opts.conditional ? { conditional: opts.conditional } : {}),
  };
}

const H = { heading: true } as const;
const SYSTEM_ONLY = 'SYSTEM_ONLY' as ControlPostingPolicy;
const SYSTEM_OR_ADJ = 'SYSTEM_OR_APPROVED_ADJUSTMENT' as ControlPostingPolicy;

const children = (parent: string, cls: string, subtype: string, rows: Array<[string, string]>) =>
  rows.map(([code, name]) => row(code, name, cls, subtype, { parent }));

// ── The chart (ADR-040 "The construction template") ─────────────────────────────

/** Heading under which bank accounts are placed. */
export const BANK_PARENT_CODE = '10000';
/** First bank's code; the n-th bank is BANK_BASE_CODE + (n − 1). Range 10100–10119. */
export const BANK_BASE_CODE = 10100;
export const MAX_BANKS = 20;
export const PETTY_CASH_CODE = '10900';
export const OUTPUT_VAT_CODE = '22000';
export const RETAINED_EARNINGS_CODE = '31000';
export const PROJECT_REVENUE_CODE = '40000';

/**
 * Static rows in chart order. Bank rows (conditional) are inserted by `resolveTemplate`
 * immediately after the 10000 heading.
 */
const STATIC_ACCOUNTS: TemplateAccount[] = [
  // Assets
  row('10000', 'Current assets', 'ASSET', 'OTHER_CURRENT_ASSET', H),
  row(PETTY_CASH_CODE, 'Petty cash', 'ASSET', 'CASH_AND_BANK', { parent: '10000', policy: SYSTEM_OR_ADJ }),
  row('11000', 'Accounts receivable (control)', 'ASSET', 'ACCOUNTS_RECEIVABLE', {
    parent: '10000', control: 'ACCOUNTS_RECEIVABLE' as SubledgerType, policy: SYSTEM_ONLY,
  }),
  row('12000', 'Site materials inventory', 'ASSET', 'INVENTORY', { parent: '10000' }),
  row('13000', 'Advances to suppliers', 'ASSET', 'SUPPLIER_ADVANCE', { parent: '10000', policy: SYSTEM_ONLY }),
  row('13100', 'Staff advances', 'ASSET', 'OTHER_CURRENT_ASSET', { parent: '10000' }),
  row('13200', 'Refundable deposits', 'ASSET', 'OTHER_CURRENT_ASSET', { parent: '10000' }),
  row('14000', 'Prepaid expenses', 'ASSET', 'PREPAYMENTS', { parent: '10000' }),
  row('15000', 'Non-current assets', 'ASSET', 'OTHER_NON_CURRENT_ASSET', H),
  ...children('15000', 'ASSET', 'FIXED_ASSETS', [
    ['15100', 'Land and buildings'],
    ['15200', 'Plant and heavy equipment'],
    ['15300', 'Vehicles'],
    ['15400', 'Office furniture and equipment'],
    ['15500', 'Computers and IT equipment'],
  ]),
  row('15900', 'Accumulated depreciation', 'ASSET', 'ACCUMULATED_DEPRECIATION', { parent: '15000' }),

  // Liabilities
  row('20000', 'Accounts payable (control)', 'LIABILITY', 'ACCOUNTS_PAYABLE', {
    control: 'ACCOUNTS_PAYABLE' as SubledgerType, policy: SYSTEM_ONLY,
  }),
  row('21000', 'Advances received from clients', 'LIABILITY', 'CLIENT_ADVANCE_LIABILITY'),
  row('21100', 'Unapplied client receipts', 'LIABILITY', 'UNAPPLIED_CLIENT_RECEIPTS', { policy: SYSTEM_ONLY }),
  row(OUTPUT_VAT_CODE, 'Output VAT payable', 'LIABILITY', 'VAT_OUTPUT_PAYABLE', { policy: SYSTEM_OR_ADJ }),
  row('23000', 'Other current liabilities', 'LIABILITY', 'OTHER_CURRENT_LIABILITY', H),
  ...children('23000', 'LIABILITY', 'OTHER_CURRENT_LIABILITY', [
    ['23100', 'Accrued expenses'],
    ['23200', 'Salaries and wages payable'],
    ['23300', 'Staff deductions payable'],
  ]),
  row('24000', 'Loans payable', 'LIABILITY', 'OTHER_NON_CURRENT_LIABILITY'),

  // Equity
  row('30000', 'Share capital', 'EQUITY', 'SHARE_CAPITAL'),
  row(RETAINED_EARNINGS_CODE, 'Retained earnings', 'EQUITY', 'RETAINED_EARNINGS'),
  // The balance sheet computes current-year earnings from the P&L, and year-end close rolls the
  // P&L into 31000 — nothing ever posts here, so a manual posting would double-count it.
  row('32000', 'Current year earnings', 'EQUITY', 'CURRENT_YEAR_EARNINGS', { policy: SYSTEM_ONLY, noPosting: true }),
  row('33000', 'Shareholder current account', 'EQUITY', 'OTHER_EQUITY'),

  // Income
  row(PROJECT_REVENUE_CODE, 'Contract revenue', 'INCOME', 'PROJECT_REVENUE'),
  row('42000', 'Other income', 'INCOME', 'OTHER_INCOME', H),
  ...children('42000', 'INCOME', 'OTHER_INCOME', [
    ['42100', 'Equipment hire income'],
    ['42200', 'Sale of scrap and surplus materials'],
    ['42900', 'Miscellaneous income'],
  ]),

  // Direct project costs (cost of sales)
  row('51000', 'Materials', 'COST_OF_SALES', 'MATERIAL_COST', H),
  ...children('51000', 'COST_OF_SALES', 'MATERIAL_COST', [
    ['51100', 'Cement and concrete'],
    ['51200', 'Steel and reinforcement'],
    ['51300', 'Blocks, sand and aggregates'],
    ['51400', 'Timber and formwork'],
    ['51500', 'Finishing materials'],
    ['51600', 'Electrical materials'],
    ['51700', 'Plumbing and sanitary materials'],
    ['51900', 'Other materials'],
  ]),
  row('52000', 'Subcontractors', 'COST_OF_SALES', 'SUBCONTRACT_COST', H),
  ...children('52000', 'COST_OF_SALES', 'SUBCONTRACT_COST', [
    ['52100', 'Civil and structural subcontract'],
    ['52200', 'Mechanical and electrical subcontract'],
    ['52300', 'Finishing subcontract'],
  ]),
  row('53000', 'Direct labour', 'COST_OF_SALES', 'DIRECT_LABOUR', H),
  ...children('53000', 'COST_OF_SALES', 'DIRECT_LABOUR', [
    ['53100', 'Site labour (daily and casual)'],
    ['53200', 'Site staff salaries'],
  ]),
  row('54000', 'Plant and equipment', 'COST_OF_SALES', 'OTHER_DIRECT_COST', H),
  ...children('54000', 'COST_OF_SALES', 'OTHER_DIRECT_COST', [
    ['54100', 'Equipment hire'],
    ['54200', 'Fuel and lubricants'],
    ['54300', 'Equipment repairs and maintenance'],
  ]),
  row('55000', 'Site overheads', 'COST_OF_SALES', 'OTHER_DIRECT_COST', H),
  ...children('55000', 'COST_OF_SALES', 'OTHER_DIRECT_COST', [
    ['55100', 'Transport and delivery'],
    ['55200', 'Site water and power'],
    ['55300', 'Site security'],
    ['55400', 'Permits and inspection fees'],
    ['55500', 'Site camp and accommodation'],
    ['55900', 'Other site costs'],
  ]),

  // Operating expenses
  row('60000', 'Administrative expenses', 'EXPENSE', 'ADMINISTRATIVE_EXPENSE', H),
  ...children('60000', 'EXPENSE', 'ADMINISTRATIVE_EXPENSE', [
    ['61000', 'Office salaries'],
    ['61100', 'Office rent'],
    ['61200', 'Office utilities and internet'],
    ['61300', 'Telephone and communication'],
    ['61400', 'Office supplies and stationery'],
    ['61500', 'Vehicle running costs'],
    ['61600', 'Travel'],
    ['61700', 'Professional and legal fees'],
    ['61800', 'Insurance'],
    ['61900', 'Tendering and marketing'],
    ['62000', 'Office repairs and maintenance'],
    ['62900', 'Other administrative expenses'],
  ]),
  row('65000', 'Depreciation', 'EXPENSE', 'DEPRECIATION_EXPENSE'),
  row('66000', 'Finance costs', 'EXPENSE', 'FINANCE_COST', H),
  ...children('66000', 'EXPENSE', 'FINANCE_COST', [
    ['66100', 'Bank charges'],
    ['66200', 'Interest expense'],
  ]),
  row('69000', 'Other expenses', 'EXPENSE', 'OTHER_EXPENSE'),
];

// ── Resolution ────────────────────────────────────────────────────────────────

export interface TemplateChoices {
  /** Display names of the banks, in order. Length 0..MAX_BANKS. */
  bankNames: string[];
}

export interface ResolvedTemplate {
  templateId: typeof CONSTRUCTION_TEMPLATE_ID;
  version: string;
  accounts: TemplateAccount[];
  postingProfiles: TemplatePostingProfile[];
}

export function bankAccountCode(index: number): string {
  return String(BANK_BASE_CODE + index);
}

/**
 * The chart an install with these choices would create, parent-first, in chart order, plus the
 * posting profiles derived from it. Pure: the preview endpoint and the install share it, so what
 * the user reviewed is exactly what is written.
 */
export function resolveTemplate(choices: TemplateChoices): ResolvedTemplate {
  if (choices.bankNames.length > MAX_BANKS) {
    throw new RangeError(`At most ${MAX_BANKS} banks, got ${choices.bankNames.length}`);
  }

  const banks = choices.bankNames.map((name, i) =>
    row(bankAccountCode(i), name, 'ASSET', 'CASH_AND_BANK', {
      parent: BANK_PARENT_CODE, policy: SYSTEM_OR_ADJ, conditional: 'BANK',
    }),
  );

  const accounts: TemplateAccount[] = [];
  for (const account of STATIC_ACCOUNTS) {
    accounts.push(account);
    if (account.code === BANK_PARENT_CODE) accounts.push(...banks);
  }

  return {
    templateId: CONSTRUCTION_TEMPLATE_ID,
    version: CONSTRUCTION_TEMPLATE_VERSION,
    accounts: accounts.map((a) => ({ ...a })),
    postingProfiles: derivePostingProfiles(accounts),
  };
}

const PROFILE_PREFIX: Partial<Record<string, string>> = {
  INCOME: 'INC',
  COST_OF_SALES: 'COST',
  EXPENSE: 'EXP',
};

/**
 * One profile per posting (non-heading) INCOME / COST_OF_SALES / EXPENSE account, named after it.
 * 40000 keeps the code `PROJECT_REVENUE` the seed and revenue flows already use.
 */
export function derivePostingProfiles(accounts: TemplateAccount[]): TemplatePostingProfile[] {
  return accounts
    .filter((a) => !a.isHeading && PROFILE_PREFIX[a.accountClass] !== undefined)
    .map((a) => ({
      code: a.code === PROJECT_REVENUE_CODE ? 'PROJECT_REVENUE' : `${PROFILE_PREFIX[a.accountClass]}_${a.code}`,
      name: a.name,
      accountCode: a.code,
    }));
}

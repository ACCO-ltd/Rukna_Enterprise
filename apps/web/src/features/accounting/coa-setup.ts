import type { AccountClass, ControlPostingPolicy, NormalBalance } from './types';

/**
 * ─── Creating a GL account ──────────────────────────────────────────────────────
 *
 * `POST /accounts` validates three things: the code is unique (409), the parent code exists
 * (404), and the DTO's own field types. It does **not** check that the subtype belongs to the
 * class, and it does **not** check that the normal balance matches the class.
 *
 * That second one matters. A trial balance ties either way — a normal balance is only which
 * column the account's balance is expected to sit in — but get it wrong and the account's sign
 * is inverted everywhere it appears: the ledger's running balance, the P&L, the balance sheet.
 * Nothing reports it, because nothing is out of balance.
 *
 * So the form defaults the normal balance from the class and warns on an override rather than
 * blocking it, because overriding is sometimes correct — see `isContraBalance`.
 */

export const ACCOUNT_CLASSES: AccountClass[] = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'COST_OF_SALES',
  'EXPENSE',
];

/** The side an account of this class normally sits on. */
const CONVENTIONAL_BALANCE: Record<AccountClass, NormalBalance> = {
  ASSET: 'DEBIT',
  COST_OF_SALES: 'DEBIT',
  EXPENSE: 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  INCOME: 'CREDIT',
};

export function conventionalBalance(accountClass: AccountClass): NormalBalance {
  return CONVENTIONAL_BALANCE[accountClass];
}

/**
 * Whether this class/balance pair is a contra account — legitimate, but worth confirming.
 *
 * `ACCUMULATED_DEPRECIATION` is the standard example: an ASSET-class account carrying a CREDIT
 * balance, which is exactly right and would be wrong to refuse. That is why the form warns
 * instead of blocking. A blocked contra account is an accountant unable to model depreciation.
 */
export function isContraBalance(
  accountClass: AccountClass,
  normalBalance: NormalBalance,
): boolean {
  return conventionalBalance(accountClass) !== normalBalance;
}

/**
 * Every `AccountSubtype` in `schema.prisma`, grouped for display.
 *
 * **The groups are display order only, not a rule.** The schema's own section comments place
 * `UNAPPLIED_CLIENT_RECEIPTS` under `// Assets`, while the seeded chart creates it as a
 * LIABILITY and the enum's own inline comment calls it "liability to client pending invoice
 * allocation" — so the schema's grouping is demonstrably not a class mapping.
 *
 * The subtype picker therefore offers all of them regardless of the chosen class. Filtering on
 * a mapping that is wrong for at least one value would make a legitimate account uncreatable,
 * and the server does not check the pairing either.
 */
export const ACCOUNT_SUBTYPE_GROUPS: { group: string; subtypes: string[] }[] = [
  {
    group: 'assets',
    subtypes: [
      'CASH_AND_BANK',
      'ACCOUNTS_RECEIVABLE',
      'SUPPLIER_ADVANCE',
      'INVENTORY',
      'FIXED_ASSETS',
      'ACCUMULATED_DEPRECIATION',
      'PREPAYMENTS',
      'VAT_INPUT_RECOVERABLE',
      'OTHER_CURRENT_ASSET',
      'OTHER_NON_CURRENT_ASSET',
    ],
  },
  {
    group: 'liabilities',
    subtypes: [
      'ACCOUNTS_PAYABLE',
      'UNAPPLIED_CLIENT_RECEIPTS',
      'CLIENT_ADVANCE_LIABILITY',
      'VAT_OUTPUT_PAYABLE',
      'OTHER_CURRENT_LIABILITY',
      'OTHER_NON_CURRENT_LIABILITY',
    ],
  },
  {
    group: 'equity',
    subtypes: ['SHARE_CAPITAL', 'RETAINED_EARNINGS', 'CURRENT_YEAR_EARNINGS', 'OTHER_EQUITY'],
  },
  { group: 'income', subtypes: ['PROJECT_REVENUE', 'OTHER_INCOME'] },
  {
    group: 'costOfSales',
    subtypes: ['MATERIAL_COST', 'SUBCONTRACT_COST', 'DIRECT_LABOUR', 'OTHER_DIRECT_COST'],
  },
  {
    group: 'expenses',
    subtypes: [
      'ADMINISTRATIVE_EXPENSE',
      'DEPRECIATION_EXPENSE',
      'FINANCE_COST',
      'OTHER_EXPENSE',
    ],
  },
];

export const ACCOUNT_SUBTYPES: string[] = ACCOUNT_SUBTYPE_GROUPS.flatMap((g) => g.subtypes);

/**
 * The control-posting policies `CreateAccountDto` accepts.
 *
 * **`SYSTEM_OR_APPROVED_ADJUSTMENT` is missing and that is a defect, not a choice** (A6). The
 * DTO declares `@IsEnum(['UNRESTRICTED','SYSTEM_ONLY'])` while the schema has three values, and
 * the seed uses the third for both bank accounts and Output VAT — the accounts whose whole
 * point is "posting engine, or a CFO-approved manual adjustment".
 *
 * So a bank or VAT account created through this API cannot be given the policy the seeded
 * chart gives its own. The form says so at the field rather than letting someone discover it
 * by comparing a new account against a seeded one months later.
 */
export const CONTROL_POSTING_POLICIES: ControlPostingPolicy[] = ['UNRESTRICTED', 'SYSTEM_ONLY'];

/** The subledger types a control account may govern. Only meaningful when `isControlAccount`. */
export const SUBLEDGER_TYPES = [
  'ACCOUNTS_RECEIVABLE',
  'ACCOUNTS_PAYABLE',
  'INVENTORY',
  'BANK',
] as const;

export interface AccountDraft {
  code: string;
  name: string;
  accountClass: AccountClass | '';
  accountSubtype: string;
  normalBalance: NormalBalance | '';
  isPostingAllowed: boolean;
  isControlAccount: boolean;
  controlledSubledgerType: string;
  controlPostingPolicy: ControlPostingPolicy;
  parentAccountCode: string;
  effectiveFrom: string;
}

export function emptyAccountDraft(): AccountDraft {
  return {
    code: '',
    name: '',
    accountClass: '',
    accountSubtype: '',
    normalBalance: '',
    // A new account is normally postable and not a control account; control accounts are
    // created by the platform, not by an administrator filling in a form.
    isPostingAllowed: true,
    isControlAccount: false,
    controlledSubledgerType: '',
    controlPostingPolicy: 'UNRESTRICTED',
    parentAccountCode: '',
    effectiveFrom: '',
  };
}

export type AccountDraftProblem =
  | 'code'
  | 'name'
  | 'accountClass'
  | 'accountSubtype'
  | 'normalBalance'
  | 'effectiveFrom'
  | 'subledgerType';

/**
 * Everything wrong with the draft, not just the first thing.
 *
 * All six required fields are reported together because the API's own reference omits two of
 * them (A5) — someone working from §6.13 will be missing `controlPostingPolicy` and
 * `effectiveFrom`, and discovering that one 400 at a time is the worst version of this.
 */
export function accountDraftProblems(draft: AccountDraft): AccountDraftProblem[] {
  const problems: AccountDraftProblem[] = [];

  if (!draft.code.trim()) problems.push('code');
  if (!draft.name.trim()) problems.push('name');
  if (!draft.accountClass) problems.push('accountClass');
  if (!draft.accountSubtype) problems.push('accountSubtype');
  if (!draft.normalBalance) problems.push('normalBalance');
  if (!draft.effectiveFrom) problems.push('effectiveFrom');

  // Not a server rule — the DTO takes `controlledSubledgerType` independently. But a control
  // account that governs nothing is a control account in name only, and the posting engine
  // resolves subledgers by this field.
  if (draft.isControlAccount && !draft.controlledSubledgerType) problems.push('subledgerType');

  return problems;
}

export interface CreateAccountBody {
  code: string;
  name: string;
  accountClass: AccountClass;
  accountSubtype: string;
  normalBalance: NormalBalance;
  isPostingAllowed: boolean;
  isControlAccount: boolean;
  controlledSubledgerType?: string;
  controlPostingPolicy: ControlPostingPolicy;
  parentAccountCode?: string;
  effectiveFrom: string;
}

/**
 * Turns a validated draft into the request body.
 *
 * Optional fields are **omitted** rather than sent empty: the API runs
 * `forbidNonWhitelisted: true` and `@IsString()` on an optional field rejects `''`, so an empty
 * `nameAr` sent as a string is a 400 rather than "no Arabic name".
 */
export function toCreateAccountBody(draft: AccountDraft): CreateAccountBody | null {
  if (accountDraftProblems(draft).length > 0) return null;
  if (!draft.accountClass || !draft.normalBalance) return null;

  return {
    code: draft.code.trim(),
    name: draft.name.trim(),
    accountClass: draft.accountClass,
    accountSubtype: draft.accountSubtype,
    normalBalance: draft.normalBalance,
    isPostingAllowed: draft.isPostingAllowed,
    isControlAccount: draft.isControlAccount,
    controlPostingPolicy: draft.controlPostingPolicy,
    effectiveFrom: draft.effectiveFrom,
    ...(draft.isControlAccount && draft.controlledSubledgerType
      ? { controlledSubledgerType: draft.controlledSubledgerType }
      : {}),
    ...(draft.parentAccountCode.trim()
      ? { parentAccountCode: draft.parentAccountCode.trim() }
      : {}),
  };
}

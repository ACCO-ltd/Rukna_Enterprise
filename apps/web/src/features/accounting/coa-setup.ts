import type { Account, AccountClass, ControlPostingPolicy, NormalBalance } from './types';
import { currentVersion } from './account-display';

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

// ─── Editing a GL account ───────────────────────────────────────────────────────
//
// `PATCH /accounts/:id` accepts only the safe fields — a rename, a re-parent, and turning
// posting on or off — plus an optional `changeReason` kept on the record. Class, subtype and
// the control-role are intentionally NOT editable: reclassifying an account that already has
// postings changes how prior years roll up, which is a domain decision, not a form field.
//
// Every field is optional. The service applies whatever is sent as a new effective-dated
// `AccountVersion`, so posted journals keep the name they were posted under.

export interface UpdateAccountBody {
  name?: string;
  isPostingAllowed?: boolean;
  /** Empty string detaches the account from its parent; a code re-parents it. */
  parentAccountCode?: string;
  changeReason?: string;
}

/** The fields the edit form binds to. Mirrors the editable slice of `AccountDraft`. */
export interface EditAccountDraft {
  name: string;
  isPostingAllowed: boolean;
  /** The parent's account code, or '' for a top-level account. */
  parentAccountCode: string;
  changeReason: string;
}

/**
 * Pre-fills the edit form from an account's current version.
 *
 * The parent is stored on the version as `parentAccountId`, not a code, so the code is resolved
 * against the chart the form already has. A parent that cannot be resolved (a deleted account,
 * say) falls back to detached rather than silently binding to nothing.
 */
export function editAccountDraftFrom(
  account: Account,
  accounts: readonly Account[],
): EditAccountDraft {
  const version = currentVersion(account);
  const parentCode = version?.parentAccountId
    ? (accounts.find((a) => a.id === version.parentAccountId)?.code ?? '')
    : '';

  return {
    name: version?.name ?? '',
    isPostingAllowed: version?.isPostingAllowed ?? true,
    parentAccountCode: parentCode,
    changeReason: '',
  };
}

/**
 * Turns an edit draft into the PATCH body, sending only the fields that actually changed.
 *
 * A re-parent to "none" is a real change and must be sent as an empty string — the convention the
 * server reads as "detach" — so the parent comparison is against the resolved original code, not
 * against absence. `changeReason` is sent only when supplied, since the API runs
 * `forbidNonWhitelisted` and an empty optional string is rejected rather than ignored.
 *
 * Returns `null` when nothing changed, so the caller can skip a no-op request.
 */
export function toUpdateAccountBody(
  draft: EditAccountDraft,
  original: EditAccountDraft,
): UpdateAccountBody | null {
  const body: UpdateAccountBody = {};

  const name = draft.name.trim();
  if (name && name !== original.name) body.name = name;
  if (draft.isPostingAllowed !== original.isPostingAllowed) {
    body.isPostingAllowed = draft.isPostingAllowed;
  }

  const parent = draft.parentAccountCode.trim();
  if (parent !== original.parentAccountCode) body.parentAccountCode = parent;

  const reason = draft.changeReason.trim();
  if (reason) body.changeReason = reason;

  // A lone `changeReason` with no substantive change is not worth a request.
  const hasChange =
    body.name !== undefined ||
    body.isPostingAllowed !== undefined ||
    body.parentAccountCode !== undefined;
  if (!hasChange) return null;

  return body;
}

/** Whether the draft leaves the account's name empty — the one thing the server will reject. */
export function editAccountProblem(draft: EditAccountDraft): 'name' | null {
  return draft.name.trim() ? null : 'name';
}

// ─── Bulk import ──────────────────────────────────────────────────────────────────

/**
 * What `POST /accounts/import` returns.
 *
 * The service upserts by code and never rejects the whole request for a bad row — it collects
 * per-row failures into `errors` and reports what it did. `skipped` is a code that already
 * existed with the same name (nothing to change).
 */
export interface ImportChartResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { code: string; message: string }[];
}

export type ImportRowProblem =
  | 'columns'
  | 'code'
  | 'name'
  | 'accountClass'
  | 'accountSubtype'
  | 'normalBalance';

export interface ImportRowError {
  /** 1-based line number in the pasted text, for a message the user can act on. */
  line: number;
  problem: ImportRowProblem;
}

export interface ParsedImport {
  rows: CreateAccountBody[];
  errors: ImportRowError[];
}

/** Whether a header line was pasted (first cell reads "code"), so it can be skipped. */
function looksLikeHeader(cells: string[]): boolean {
  return cells[0]?.trim().toLowerCase() === 'code';
}

/**
 * Splits one CSV line into cells, honouring double-quoted fields (which may contain commas)
 * and escaped quotes (`""`). Enough for a pasted chart of accounts; not a full CSV engine.
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

/**
 * Parses pasted rows (or an uploaded CSV's text) into import bodies plus per-line errors.
 *
 * Column order: `code, name, class, subtype, normalBalance, parentCode`. Normal balance may be
 * left blank to take the conventional side for the class — a chart pasted from a spreadsheet
 * often omits it. The account-level flags are not in the paste format: every imported account
 * is created postable, non-control, `UNRESTRICTED`, which is what an ordinary GL account is —
 * control accounts are provisioned by the platform, not imported. `effectiveFrom` defaults to
 * today so a row need not carry a date.
 *
 * Blank lines are ignored; a header row (`code,…`) is detected and skipped. A malformed row is
 * reported by line number and does not stop the rest from parsing, mirroring how the server
 * treats a bad row on import.
 */
export function parseChartImport(text: string, today: string): ParsedImport {
  const rows: CreateAccountBody[] = [];
  const errors: ImportRowError[] = [];

  const lines = text.split(/\r?\n/);

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;

    const cells = splitCsvLine(raw).map((c) => c.trim());
    if (index === 0 && looksLikeHeader(cells)) return;

    const lineNumber = index + 1;

    if (cells.length < 4) {
      errors.push({ line: lineNumber, problem: 'columns' });
      return;
    }

    const [code, name, classRaw, subtypeRaw, balanceRaw, parentRaw] = cells;
    const accountClass = classRaw?.toUpperCase() as AccountClass;

    if (!code) {
      errors.push({ line: lineNumber, problem: 'code' });
      return;
    }
    if (!name) {
      errors.push({ line: lineNumber, problem: 'name' });
      return;
    }
    if (!classRaw || !ACCOUNT_CLASSES.includes(accountClass)) {
      errors.push({ line: lineNumber, problem: 'accountClass' });
      return;
    }
    if (!subtypeRaw) {
      errors.push({ line: lineNumber, problem: 'accountSubtype' });
      return;
    }

    const balance = balanceRaw?.toUpperCase();
    let normalBalance: NormalBalance;
    if (!balance) {
      normalBalance = conventionalBalance(accountClass);
    } else if (balance === 'DEBIT' || balance === 'CREDIT') {
      normalBalance = balance;
    } else {
      errors.push({ line: lineNumber, problem: 'normalBalance' });
      return;
    }

    rows.push({
      code,
      name,
      accountClass,
      accountSubtype: subtypeRaw.toUpperCase(),
      normalBalance,
      isPostingAllowed: true,
      isControlAccount: false,
      controlPostingPolicy: 'UNRESTRICTED',
      effectiveFrom: today,
      ...(parentRaw ? { parentAccountCode: parentRaw } : {}),
    });
  });

  return { rows, errors };
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

/**
 * The next free code under `parent`, offered as a starting point the user can overwrite.
 *
 * Numbered charts step by one digit below the parent's last significant one: under 51000 the
 * children are 51100, 51200…; under 66000 they are 66100, 66200. So the step is a tenth of the
 * parent's block, and a suggestion never leaves the block (51000 can't suggest 52000, which would
 * read as a sibling). It continues after the last child when it can — a new account goes at the
 * end of its group — and otherwise takes the first gap. `null` when the parent's code is not a
 * round number or its block is full: the user types a code as before.
 */
export function suggestChildCode(parent: Account, accounts: readonly Account[]): string | null {
  const code = parent.code;
  if (!/^\d+$/.test(code)) return null;
  const zeros = code.length - code.replace(/0+$/, '').length;
  if (zeros === 0) return null;

  const base = Number(code);
  const step = 10 ** (zeros - 1);
  const blockEnd = base + 10 ** zeros; // exclusive
  const width = code.length;
  const taken = new Set(accounts.map((a) => a.code));
  const toCode = (n: number) => String(n).padStart(width, '0');

  const children = accounts
    .filter(
      (a) =>
        currentVersion(a)?.parentAccountId === parent.id &&
        a.code.length === width &&
        /^\d+$/.test(a.code),
    )
    .map((a) => Number(a.code));

  const free = (from: number): string | null => {
    for (let n = Math.ceil(from / step) * step; n < blockEnd; n += step) {
      if (n > base && !taken.has(toCode(n))) return toCode(n);
    }
    return null;
  };

  const last = children.length > 0 ? Math.max(...children) : base;
  return free(last + step) ?? free(base + step);
}

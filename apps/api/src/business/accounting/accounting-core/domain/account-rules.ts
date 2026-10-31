import type { AccountClass, AccountSubtype, ControlPostingPolicy } from '@prisma/client';

import { parseDateOnly } from './calendar-day.js';

/**
 * GL-C — which subtypes belong to which class. The schema enum's section comments are not this
 * mapping (they place UNAPPLIED_CLIENT_RECEIPTS under assets; it is a liability, as the seeded
 * chart and the enum's own comment say). This is the grouping the chart-of-accounts form offers.
 */
export const SUBTYPES_BY_CLASS: Record<AccountClass, readonly AccountSubtype[]> = {
  ASSET: [
    'CASH_AND_BANK', 'ACCOUNTS_RECEIVABLE', 'RETENTION_RECEIVABLE', 'SUPPLIER_ADVANCE', 'INVENTORY', 'FIXED_ASSETS',
    'ACCUMULATED_DEPRECIATION', 'PREPAYMENTS', 'VAT_INPUT_RECOVERABLE', 'OTHER_CURRENT_ASSET', 'OTHER_NON_CURRENT_ASSET',
  ],
  LIABILITY: [
    'ACCOUNTS_PAYABLE', 'UNAPPLIED_CLIENT_RECEIPTS', 'CLIENT_ADVANCE_LIABILITY', 'VAT_OUTPUT_PAYABLE',
    'OTHER_CURRENT_LIABILITY', 'OTHER_NON_CURRENT_LIABILITY',
  ],
  EQUITY: ['SHARE_CAPITAL', 'RETAINED_EARNINGS', 'CURRENT_YEAR_EARNINGS', 'OTHER_EQUITY'],
  INCOME: ['PROJECT_REVENUE', 'OTHER_INCOME'],
  COST_OF_SALES: ['MATERIAL_COST', 'SUBCONTRACT_COST', 'DIRECT_LABOUR', 'OTHER_DIRECT_COST'],
  EXPENSE: ['ADMINISTRATIVE_EXPENSE', 'DEPRECIATION_EXPENSE', 'FINANCE_COST', 'BAD_DEBT_EXPENSE', 'OTHER_EXPENSE'],
};

export interface AccountProblem {
  errorCode: string;
  message: string;
  field?: string;
}

export interface VersionFlags {
  isPostingAllowed: boolean;
  isControlAccount: boolean;
  controlPostingPolicy: ControlPostingPolicy;
}

/**
 * A heading only adds up the accounts under it. "Posting allowed" off is not enough: the template
 * also clears it on control and system-only accounts, which the system posts to by design.
 */
export const isHeading = (v: VersionFlags) => !v.isPostingAllowed && !v.isControlAccount && v.controlPostingPolicy !== 'SYSTEM_ONLY';

/** Codes are letters, digits, dots and dashes — what a person types and a report sorts. */
const CODE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

export function accountFieldsProblem(a: {
  code?: string;
  name?: string;
  accountClass?: AccountClass;
  accountSubtype?: AccountSubtype;
  effectiveFrom?: string;
}): AccountProblem | null {
  if (a.code !== undefined && !CODE.test(a.code.trim())) {
    return { errorCode: 'ACCOUNT_CODE_INVALID', field: 'code', message: 'The code is letters, digits, dots or dashes, with no spaces.' };
  }
  if (a.name !== undefined && !a.name.trim()) return { errorCode: 'FIELD_REQUIRED', field: 'name', message: 'Give the account a name.' };
  if (a.accountClass && a.accountSubtype && !SUBTYPES_BY_CLASS[a.accountClass]?.includes(a.accountSubtype)) {
    return { errorCode: 'SUBTYPE_NOT_IN_CLASS', field: 'accountSubtype', message: `${a.accountSubtype} is not a kind of ${a.accountClass} account.` };
  }
  if (a.effectiveFrom !== undefined && !(a.effectiveFrom.length >= 10 && parseDateOnly(a.effectiveFrom))) {
    return { errorCode: 'DATE_INVALID', field: 'effectiveFrom', message: 'The start date must be a real date written YYYY-MM-DD.' };
  }
  return null;
}

export interface ParentFacts {
  id: string;
  code: string;
  name: string;
  accountClass: AccountClass;
  heading: boolean;
  active: boolean;
  /** The parent itself and every account above it. */
  lineage: readonly string[];
}

/** Why an account cannot sit under this parent, or null. */
export function parentProblem(child: { id?: string; accountClass: AccountClass }, parent: ParentFacts | null, code: string): AccountProblem | null {
  if (!parent) return { errorCode: 'PARENT_NOT_FOUND', field: 'parentAccountCode', message: `There is no account ${code}.` };
  const label = `${parent.code} ${parent.name}`;
  if (child.id && parent.lineage.includes(child.id)) {
    return { errorCode: 'PARENT_CYCLE', field: 'parentAccountCode', message: `${label} sits under this account; it cannot also be above it.` };
  }
  if (!parent.heading) return { errorCode: 'PARENT_NOT_HEADING', field: 'parentAccountCode', message: `${label} takes entries; only a heading can have accounts under it.` };
  if (parent.accountClass !== child.accountClass) {
    return { errorCode: 'PARENT_OTHER_CLASS', field: 'parentAccountCode', message: `${label} is a ${parent.accountClass} heading; this is a ${child.accountClass} account.` };
  }
  if (!parent.active) return { errorCode: 'PARENT_INACTIVE', field: 'parentAccountCode', message: `${label} is inactive.` };
  return null;
}

/** Turning an account into a heading, or a heading into an account, without breaking what is there. */
export function postingSwitchProblem(to: boolean, f: { hasEntries: boolean; hasChildren: boolean; linkedToBank: boolean }): AccountProblem | null {
  if (!to && f.hasEntries) {
    return { errorCode: 'ACCOUNT_HAS_ENTRIES', message: 'This account has entries; as a heading its balance would disappear from every report. Move them first.' };
  }
  if (!to && f.linkedToBank) return { errorCode: 'ACCOUNT_LINKED_TO_BANK', message: 'A bank or cash account posts here; it must keep taking entries.' };
  if (to && f.hasChildren) return { errorCode: 'ACCOUNT_HAS_CHILDREN', message: 'Accounts sit under this heading; move them before it takes entries itself.' };
  return null;
}

/**
 * Why an account cannot be made inactive, or null. An inactive account takes no new entries, so
 * it must hold nothing and nothing may still post to it.
 */
export function deactivateProblem(f: { balance: string; activeChildren: number; linkedToBank: boolean; usedBy: readonly string[] }): AccountProblem | null {
  if (Number(f.balance) !== 0) {
    return { errorCode: 'ACCOUNT_HAS_BALANCE', message: `The account holds ${f.balance}; move it to another account first.` };
  }
  if (f.activeChildren > 0) return { errorCode: 'ACCOUNT_HAS_ACTIVE_CHILDREN', message: 'Accounts under this heading are still active.' };
  if (f.linkedToBank) return { errorCode: 'ACCOUNT_LINKED_TO_BANK', message: 'A bank or cash account posts here; close it first.' };
  if (f.usedBy.length > 0) return { errorCode: 'ACCOUNT_IN_USE', message: `Still used by ${f.usedBy.join(', ')}.` };
  return null;
}

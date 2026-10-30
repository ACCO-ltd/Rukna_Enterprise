/**
 * BK — what a new bank, cash or wallet account must be before it is saved. The platform keeps its
 * books in US dollars only, so an account in any other currency could never take a payment or a
 * transfer (both refuse a currency other than the other side's).
 */
export const BANK_ACCOUNT_CURRENCY = 'USD';

export interface BankAccountRuleProblem {
  errorCode: string;
  message: string;
  field?: string;
}

export interface BankAccountFields {
  accountName: string;
  bankName: string;
  accountNumber: string;
  currencyCode?: string | null;
}

/** The fields trimmed; the first problem with them, or null. */
export function bankAccountFieldsProblem(fields: BankAccountFields): BankAccountRuleProblem | null {
  for (const field of ['accountName', 'bankName', 'accountNumber'] as const) {
    if (!fields[field]?.trim()) {
      return { errorCode: 'FIELD_REQUIRED', message: `${FIELD_LABEL[field]} is required.`, field };
    }
  }
  const currency = (fields.currencyCode ?? BANK_ACCOUNT_CURRENCY).trim().toUpperCase();
  if (currency !== BANK_ACCOUNT_CURRENCY) {
    return { errorCode: 'CURRENCY_NOT_SUPPORTED', message: 'Accounts are kept in US dollars (USD) only.', field: 'currencyCode' };
  }
  return null;
}

const FIELD_LABEL = { accountName: 'The account name', bankName: 'The bank or provider', accountNumber: 'The account number' } as const;

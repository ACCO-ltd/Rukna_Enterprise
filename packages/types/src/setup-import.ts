/**
 * Step 5 — importing suppliers or clients from a spreadsheet, with their opening balances
 * (POST /finance/import/:kind/check, then POST /finance/import/:kind).
 *
 * The browser reads the file and maps its columns; the server checks and imports the mapped rows.
 * Every cell arrives as text, exactly as typed in the spreadsheet: the server is the one place the
 * rules (phone numbers, payment terms, money) are applied, so the check and the import agree.
 */
export type SetupImportKind = 'suppliers' | 'clients';

/** The fields a spreadsheet column can be matched to. */
export type SetupImportField =
  | 'name'
  | 'code'
  | 'taxNumber'
  | 'contactName'
  | 'phone'
  | 'email'
  | 'paymentTerms'
  | 'currency'
  | 'address'
  | 'city'
  | 'country'
  | 'clientType'
  | 'openingBalance';

/** What to do with a row. A likely duplicate can be merged into the existing record instead. */
export type SetupImportAction = 'CREATE' | 'MERGE' | 'SKIP';

export type SetupImportRow = Partial<Record<SetupImportField, string>> & {
  action?: SetupImportAction;
  /** With MERGE: the existing supplier or client the row's opening balance goes to. */
  mergeIntoId?: string;
};

export interface SetupImportRequest {
  rows: SetupImportRow[];
  /** ISO-3166 alpha-2: the country of a phone number written without a +country code. */
  defaultCountry: string;
  /** The date opening balances are owed as of (YYYY-MM-DD). Needed when any row has a balance. */
  openingDate?: string;
  /** Import: skip rows that still have errors instead of refusing the whole import. */
  skipRowsWithErrors?: boolean;
}

export type SetupImportProblemCode =
  | 'NAME_REQUIRED'
  | 'CODE_TAKEN'
  | 'CODE_INVALID'
  | 'DUPLICATE_IN_FILE'
  | 'LIKELY_DUPLICATE'
  | 'PHONE_REQUIRED'
  | 'PHONE_INVALID'
  | 'EMAIL_INVALID'
  | 'CONTACT_REQUIRED'
  | 'PAYMENT_TERMS_UNKNOWN'
  | 'CURRENCY_INVALID'
  | 'COUNTRY_INVALID'
  | 'CLIENT_TYPE_UNKNOWN'
  | 'TEXT_TOO_LONG'
  | 'AMOUNT_INVALID'
  | 'BALANCE_NEGATIVE'
  | 'BALANCE_CURRENCY'
  | 'OPENING_BALANCES_CLOSED'
  | 'OPENING_BALANCES_FORBIDDEN'
  | 'MERGE_TARGET_INVALID';

export interface SetupImportProblem {
  /** The field the problem is in, or null when it is about the row as a whole. */
  field: SetupImportField | null;
  code: SetupImportProblemCode;
  /** An error stops the row being imported; a warning is for the reader to decide. */
  severity: 'ERROR' | 'WARNING';
  message: string;
  /** For a repeat within the file: the 0-based index of the earlier row it repeats. */
  relatedIndex?: number;
}

export interface SetupImportExisting {
  id: string;
  code: string;
  name: string;
}

export interface SetupImportRowResult {
  /** 0-based position in the request's `rows`. */
  index: number;
  status: 'READY' | 'WARNING' | 'ERROR' | 'SKIPPED';
  action: SetupImportAction;
  problems: SetupImportProblem[];
  /** An existing record this row most likely is (same tax number or same name). */
  duplicateOf: SetupImportExisting | null;
  /** The opening balance as the server read it (decimal string), or null when there is none. */
  openingBalance: string | null;
}

export interface SetupImportCheck {
  kind: SetupImportKind;
  rows: SetupImportRowResult[];
  summary: {
    total: number;
    toCreate: number;
    toMerge: number;
    skipped: number;
    withErrors: number;
    withWarnings: number;
    /** Opening balances of the rows that would be imported (decimal string). */
    openingBalanceTotal: string;
    openingItems: number;
  };
  /** False once the opening-balance journal is posted: from then on balances come in by journal. */
  openingBalancesOpen: boolean;
}

export interface SetupImportResult {
  kind: SetupImportKind;
  created: number;
  merged: number;
  skipped: number;
  openingItems: number;
  openingBalanceTotal: string;
  /** Stamped on every opening item, so the batch can be found and tied out. */
  batchReference: string;
}

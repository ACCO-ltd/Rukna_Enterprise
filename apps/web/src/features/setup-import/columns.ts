import type { SetupImportField, SetupImportKind, SetupImportRow } from '@erp/types';

/**
 * Step 5 — matching a spreadsheet's columns to the import's fields.
 *
 * Every export names its columns differently ("Vendor", "Supplier name", "Company"), so each field
 * carries the headers it is usually found under. A header is matched to at most one field and a
 * field to at most one column; anything left over is the reader's to match by hand.
 */
export interface ImportFieldSpec {
  field: SetupImportField;
  required: boolean;
  /** Lower-case, punctuation-free headers this field is usually exported under. */
  aliases: string[];
}

const COMMON: ImportFieldSpec[] = [
  { field: 'name', required: true, aliases: ['name', 'company', 'company name', 'business name', 'display name', 'legal name'] },
  { field: 'taxNumber', required: false, aliases: ['tax number', 'tax no', 'tin', 'vat number', 'vat no', 'tax id', 'tax registration'] },
  { field: 'contactName', required: false, aliases: ['contact', 'contact name', 'contact person', 'primary contact', 'attention'] },
  { field: 'phone', required: false, aliases: ['phone', 'phone number', 'telephone', 'tel', 'mobile', 'mobile number', 'cell'] },
  { field: 'email', required: false, aliases: ['email', 'email address', 'e mail', 'mail'] },
  { field: 'paymentTerms', required: false, aliases: ['terms', 'payment terms', 'credit terms', 'due days', 'credit days'] },
  { field: 'currency', required: false, aliases: ['currency', 'currency code', 'ccy'] },
  { field: 'address', required: false, aliases: ['address', 'street', 'street address', 'billing address', 'address line 1'] },
  { field: 'country', required: false, aliases: ['country', 'country code'] },
  {
    field: 'openingBalance',
    required: false,
    aliases: ['balance', 'opening balance', 'open balance', 'balance due', 'amount due', 'outstanding', 'outstanding balance', 'amount owed'],
  },
];

export const IMPORT_FIELDS: Record<SetupImportKind, ImportFieldSpec[]> = {
  suppliers: [
    { ...COMMON[0], aliases: [...COMMON[0].aliases, 'supplier', 'supplier name', 'vendor', 'vendor name'] },
    { field: 'code', required: false, aliases: ['code', 'supplier code', 'vendor code', 'supplier id', 'vendor id', 'account', 'account no', 'reference'] },
    ...COMMON.slice(1),
  ],
  clients: [
    { ...COMMON[0], aliases: [...COMMON[0].aliases, 'client', 'client name', 'customer', 'customer name'] },
    ...COMMON.slice(1, 8),
    { field: 'city', required: false, aliases: ['city', 'town'] },
    ...COMMON.slice(8),
    { field: 'clientType', required: false, aliases: ['type', 'client type', 'customer type', 'category'] },
  ],
};

/** Column index per field; null = not imported. */
export type ColumnMapping = Partial<Record<SetupImportField, number | null>>;

function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** The best first guess: exact alias matches only, so a guess is never a surprising one. */
export function guessMapping(kind: SetupImportKind, columns: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<number>();
  for (const spec of IMPORT_FIELDS[kind]) {
    const index = columns.findIndex((c, i) => !taken.has(i) && spec.aliases.includes(normaliseHeader(c)));
    mapping[spec.field] = index >= 0 ? index : null;
    if (index >= 0) taken.add(index);
  }
  return mapping;
}

/** The fields still to be matched before rows can be checked. */
export function missingRequired(kind: SetupImportKind, mapping: ColumnMapping): SetupImportField[] {
  return IMPORT_FIELDS[kind].filter((s) => s.required && (mapping[s.field] ?? null) === null).map((s) => s.field);
}

/** Spreadsheet rows as import rows: one text cell per matched field. Blank rows are dropped. */
export function toImportRows(mapping: ColumnMapping, rows: string[][]): { rows: SetupImportRow[]; sourceLine: number[] } {
  const out: SetupImportRow[] = [];
  const sourceLine: number[] = [];
  rows.forEach((cells, index) => {
    if (cells.every((c) => c.trim() === '')) return;
    const row: SetupImportRow = {};
    for (const [field, column] of Object.entries(mapping) as Array<[SetupImportField, number | null]>) {
      if (column !== null && column !== undefined && cells[column] !== undefined && cells[column] !== '') row[field] = cells[column];
    }
    out.push(row);
    // The header is line 1 of the sheet, so the first data row is line 2.
    sourceLine.push(index + 2);
  });
  return { rows: out, sourceLine };
}

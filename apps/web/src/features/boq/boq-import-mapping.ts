import type { BoqImportRow } from '@erp/types';

/**
 * Column mapping for a BOQ import.
 *
 * The user tells us which sheet column is the Code, the Description, and so on; everything else
 * (the tree, validation, the amounts) is the server's job via the preview/commit endpoints. This
 * module only turns "column 3 is the Rate" into the `BoqImportRow[]` the API expects.
 */
export type ImportField = 'code' | 'description' | 'unit' | 'quantity' | 'unitRate' | 'sheetAmount';

/** In display order. */
export const IMPORT_FIELDS: ImportField[] = [
  'code',
  'description',
  'unit',
  'quantity',
  'unitRate',
  'sheetAmount',
];

/** Code and Description must be mapped before a preview is possible. */
export const REQUIRED_FIELDS: readonly ImportField[] = ['code', 'description'];

/** Each BOQ field to a column index in the sheet, or null when the sheet has no such column. */
export type ColumnMapping = Record<ImportField, number | null>;

/**
 * Best-effort guess from the header names, so the common sheet maps itself. Fields are resolved in
 * priority order and each claims the first *unused* column it matches, so a header called "Item"
 * cannot land as both the code and the description.
 */
export function autoGuessMapping(columns: string[]): ColumnMapping {
  const normalized = columns.map((column) => column.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const used = new Set<number>();
  const pick = (patterns: RegExp[]): number | null => {
    for (let index = 0; index < normalized.length; index += 1) {
      if (used.has(index)) continue;
      if (patterns.some((pattern) => pattern.test(normalized[index]!))) {
        used.add(index);
        return index;
      }
    }
    return null;
  };

  return {
    // A lone "Item" column is the item *number* in most BOQs, so code claims it (after the
    // more specific patterns) before description can.
    code: pick([/^code$/, /^itemno$/, /^itemcode$/, /^billno$/, /^ref$/, /^reference$/, /^srno$/, /^slno$/, /^sno$/, /^sl$/, /^item$/]),
    description: pick([/^description$/, /descriptionofwork/, /^particulars?$/, /^workdescription$/, /^details?$/, /^desc$/]),
    unit: pick([/^unit$/, /^uom$/, /^units$/]),
    quantity: pick([/^qty$/, /^quantity$/, /^quan$/, /^nos$/]),
    unitRate: pick([/^rate$/, /^unitrate$/, /^price$/, /^unitprice$/]),
    sheetAmount: pick([/^amount$/, /^total$/, /^value$/, /^amt$/]),
  };
}

/** True once the two required fields are mapped — the gate on the Preview action. */
export function isMappingComplete(mapping: ColumnMapping): boolean {
  return REQUIRED_FIELDS.every((field) => mapping[field] !== null);
}

/**
 * Applies the mapping, producing one `BoqImportRow` per non-empty sheet row.
 *
 * `rowNumber` is the sheet line the user sees: data row index + 2 (1-based, plus the header). A
 * row with no code, description, quantity or rate is dropped — trailing blank rows are ubiquitous
 * in exported sheets and are not errors to report.
 */
export function applyMapping(rows: string[][], mapping: ColumnMapping): BoqImportRow[] {
  const valueAt = (row: string[], field: ImportField): string | null => {
    const index = mapping[field];
    if (index === null) return null;
    const value = (row[index] ?? '').trim();
    return value.length > 0 ? value : null;
  };

  const result: BoqImportRow[] = [];
  rows.forEach((row, index) => {
    const code = valueAt(row, 'code') ?? '';
    const description = valueAt(row, 'description') ?? '';
    const quantity = valueAt(row, 'quantity');
    const unitRate = valueAt(row, 'unitRate');
    if (code === '' && description === '' && quantity === null && unitRate === null) return;

    result.push({
      rowNumber: index + 2,
      code,
      description,
      unit: valueAt(row, 'unit'),
      quantity,
      unitRate,
      sheetAmount: valueAt(row, 'sheetAmount'),
    });
  });
  return result;
}

/** The convenience template (Q1): a header row and two example lines, one section, one item. */
export function importTemplateCsv(): string {
  return (
    [
      'Code,Description,Unit,Quantity,Rate',
      '02,Concrete works,,,',
      '02.01.001,Mass concrete C25,m3,120.5,85.00',
    ].join('\r\n') + '\r\n'
  );
}

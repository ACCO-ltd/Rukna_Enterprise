import { describe, expect, it } from 'vitest';

import {
  applyMapping,
  autoGuessMapping,
  importTemplateCsv,
  isMappingComplete,
  type ColumnMapping,
} from './boq-import-mapping';

describe('autoGuessMapping', () => {
  it('maps the common header names', () => {
    const mapping = autoGuessMapping(['Code', 'Description', 'Unit', 'Qty', 'Rate', 'Amount']);
    expect(mapping).toEqual({
      code: 0,
      description: 1,
      unit: 2,
      quantity: 3,
      unitRate: 4,
      sheetAmount: 5,
    });
  });

  it('handles alternative spellings and spacing', () => {
    const mapping = autoGuessMapping(['Item No', 'Description of Work', 'UOM', 'Quantity', 'Unit Price', 'Total']);
    expect(mapping.code).toBe(0);
    expect(mapping.description).toBe(1);
    expect(mapping.unit).toBe(2);
    expect(mapping.quantity).toBe(3);
    expect(mapping.unitRate).toBe(4);
    expect(mapping.sheetAmount).toBe(5);
  });

  it('never assigns one column to two fields', () => {
    // "Item" could match either code or description; code claims it first, description stays null.
    const mapping = autoGuessMapping(['Item', 'Notes']);
    expect(mapping.code).toBe(0);
    expect(mapping.description).toBeNull();
  });

  it('leaves unmatched fields null', () => {
    const mapping = autoGuessMapping(['Code', 'Description']);
    expect(mapping.unit).toBeNull();
    expect(mapping.quantity).toBeNull();
  });
});

describe('isMappingComplete', () => {
  const base: ColumnMapping = { code: null, description: null, unit: null, quantity: null, unitRate: null, sheetAmount: null };

  it('requires code and description', () => {
    expect(isMappingComplete(base)).toBe(false);
    expect(isMappingComplete({ ...base, code: 0 })).toBe(false);
    expect(isMappingComplete({ ...base, code: 0, description: 1 })).toBe(true);
  });
});

describe('applyMapping', () => {
  const mapping: ColumnMapping = { code: 0, description: 1, unit: 2, quantity: 3, unitRate: 4, sheetAmount: null };

  it('builds rows with the sheet line number (header is row 1)', () => {
    const rows = applyMapping(
      [
        ['02', 'Concrete', '', '', ''],
        ['02.01.001', 'Mass concrete', 'm3', '10', '85.00'],
      ],
      mapping,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ rowNumber: 2, code: '02', description: 'Concrete', unit: null, quantity: null });
    expect(rows[1]).toMatchObject({ rowNumber: 3, code: '02.01.001', unit: 'm3', quantity: '10', unitRate: '85.00' });
  });

  it('drops fully-blank rows but keeps their effect on later row numbers', () => {
    const rows = applyMapping(
      [
        ['1', 'First', '', '1', '2'],
        ['', '', '', '', ''],
        ['2', 'Third', '', '1', '2'],
      ],
      mapping,
    );
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 4]);
  });

  it('returns null for unmapped and empty cells, never empty strings', () => {
    const [row] = applyMapping([['1', 'x', '', '5', '']], mapping);
    expect(row!.unitRate).toBeNull();
    expect(row!.sheetAmount).toBeNull();
    expect(row!.quantity).toBe('5');
  });
});

describe('importTemplateCsv', () => {
  it('has the mappable header and a section + item example', () => {
    const csv = importTemplateCsv();
    expect(csv.split('\r\n')[0]).toBe('Code,Description,Unit,Quantity,Rate');
    expect(csv).toContain('02.01.001');
  });
});

import { describe, expect, it } from 'vitest';

import { guessMapping, missingRequired, toImportRows } from './columns';

describe('setup import columns (Step 5)', () => {
  it('matches the usual headers, each column at most once', () => {
    const mapping = guessMapping('suppliers', ['Vendor Name', 'Vendor ID', 'Phone', 'E-mail', 'Terms', 'Balance Due', 'Notes']);
    expect(mapping).toMatchObject({ name: 0, code: 1, phone: 2, email: 3, paymentTerms: 4, openingBalance: 5, taxNumber: null });
    expect(missingRequired('suppliers', mapping)).toEqual([]);
  });

  it('leaves an unrecognised name column for the reader to match', () => {
    const mapping = guessMapping('clients', ['Party', 'Mobile']);
    expect(mapping.name).toBeNull();
    expect(mapping.phone).toBe(1);
    expect(missingRequired('clients', mapping)).toEqual(['name']);
  });

  it('turns sheet rows into import rows, dropping blank lines and keeping sheet line numbers', () => {
    const { rows, sourceLine } = toImportRows({ name: 0, phone: 2, openingBalance: null }, [
      ['Horn Cement', 'x', '0712 345 678'],
      ['', '', ''],
      ['Blue Nile', 'y', ''],
    ]);
    expect(rows).toEqual([{ name: 'Horn Cement', phone: '0712 345 678' }, { name: 'Blue Nile' }]);
    expect(sourceLine).toEqual([2, 4]);
  });
});

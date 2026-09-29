import { describe, expect, it } from 'vitest';

import { parseChartImport } from './coa-setup';

const TODAY = '2026-09-29';

describe('parseChartImport', () => {
  it('parses a well-formed row into a create body, defaulting the flags', () => {
    const { rows, errors } = parseChartImport('10100,Salaam Bank,ASSET,CASH_AND_BANK,DEBIT,', TODAY);

    expect(errors).toEqual([]);
    expect(rows).toEqual([
      {
        code: '10100',
        name: 'Salaam Bank',
        accountClass: 'ASSET',
        accountSubtype: 'CASH_AND_BANK',
        normalBalance: 'DEBIT',
        isPostingAllowed: true,
        isControlAccount: false,
        controlPostingPolicy: 'UNRESTRICTED',
        effectiveFrom: TODAY,
      },
    ]);
  });

  it('defaults the normal balance from the class when the column is blank', () => {
    const { rows } = parseChartImport('42600,Project Revenue,INCOME,PROJECT_REVENUE,,', TODAY);
    // INCOME conventionally sits on the credit side.
    expect(rows[0]?.normalBalance).toBe('CREDIT');
  });

  it('carries the parent code through when present, and omits it when blank', () => {
    const { rows } = parseChartImport(
      '10000,Assets,ASSET,OTHER_CURRENT_ASSET,DEBIT,\n10100,Cash,ASSET,CASH_AND_BANK,DEBIT,10000',
      TODAY,
    );
    expect(rows[0]).not.toHaveProperty('parentAccountCode');
    expect(rows[1]?.parentAccountCode).toBe('10000');
  });

  it('detects and skips a header row', () => {
    const { rows, errors } = parseChartImport(
      'code,name,class,subtype,normalBalance,parentCode\n10100,Salaam Bank,ASSET,CASH_AND_BANK,DEBIT,',
      TODAY,
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe('10100');
  });

  it('ignores blank lines and honours quoted fields containing commas', () => {
    const { rows, errors } = parseChartImport(
      '\n"10100","Salaam Bank, Main","ASSET","CASH_AND_BANK","DEBIT",\n',
      TODAY,
    );
    expect(errors).toEqual([]);
    expect(rows[0]?.name).toBe('Salaam Bank, Main');
  });

  it('reports a malformed row by line number without stopping the rest', () => {
    const { rows, errors } = parseChartImport(
      '10100,Salaam Bank,NONSENSE,CASH_AND_BANK,DEBIT,\n42600,Project Revenue,INCOME,PROJECT_REVENUE,CREDIT,',
      TODAY,
    );
    expect(errors).toEqual([{ line: 1, problem: 'accountClass' }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe('42600');
  });

  it('flags too-few columns, a missing code, a missing name and a bad balance', () => {
    const { errors } = parseChartImport(
      '10100,Salaam Bank\n,Name,ASSET,CASH_AND_BANK,DEBIT,\n10200,,ASSET,CASH_AND_BANK,DEBIT,\n10300,Cash,ASSET,CASH_AND_BANK,SIDEWAYS,',
      TODAY,
    );
    expect(errors).toEqual([
      { line: 1, problem: 'columns' },
      { line: 2, problem: 'code' },
      { line: 3, problem: 'name' },
      { line: 4, problem: 'normalBalance' },
    ]);
  });
});

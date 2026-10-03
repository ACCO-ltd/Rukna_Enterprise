import { describe, expect, it } from 'vitest';

import { neutraliseFormula, reportFilename, toCsv } from './export-csv';

describe('toCsv', () => {
  it('joins a header row and body rows with CRLF', () => {
    const csv = toCsv(['Code', 'Name'], [['10100', 'Salaam Bank']]);
    expect(csv).toBe('Code,Name\r\n10100,Salaam Bank');
  });

  it('quotes cells that hold a comma, a quote or a newline, doubling embedded quotes', () => {
    const csv = toCsv(
      ['Name', 'Note'],
      [['Bank, Main', 'He said "hi"'], ['Line one\nLine two', 'plain']],
    );
    expect(csv).toBe(
      'Name,Note\r\n"Bank, Main","He said ""hi"""\r\n"Line one\nLine two",plain',
    );
  });

  it('writes an empty cell for null or undefined, and keeps a numeric zero', () => {
    const csv = toCsv(['A', 'B', 'C'], [[null, undefined, 0]]);
    expect(csv).toBe('A,B,C\r\n,,0');
  });
});

describe('CSV formula injection', () => {
  it('prefixes a text cell a spreadsheet would run as a formula with a quote', () => {
    expect(['=SUM(A1)', '+1+1', '-2+3', '@cmd', '\tx', '\rx'].map(neutraliseFormula)).toEqual([
      "'=SUM(A1)",
      "'+1+1",
      "'-2+3",
      "'@cmd",
      "'\tx",
      "'\rx",
    ]);
  });

  it('leaves numbers, plain decimal strings and ordinary text alone', () => {
    expect(neutraliseFormula(-1234.5)).toBe(-1234.5);
    expect(neutraliseFormula('-1234.50')).toBe('-1234.50');
    expect(neutraliseFormula('-7')).toBe('-7');
    expect(neutraliseFormula('Salaam Bank')).toBe('Salaam Bank');
    expect(neutraliseFormula(null)).toBeNull();
  });

  it('applies inside toCsv, quoting still per RFC 4180', () => {
    expect(toCsv(['Name', 'Amount'], [['=HYPERLINK("x")', -50], ['-1,5', '-12.00']])).toBe(
      'Name,Amount\r\n"\'=HYPERLINK(""x"")",-50\r\n"\'-1,5",-12.00',
    );
  });
});

describe('reportFilename', () => {
  it('slugs the parts into a lower-case .csv name', () => {
    expect(reportFilename('trial-balance', '2026-01-31')).toBe('trial-balance-2026-01-31.csv');
  });

  it('drops empty parts and collapses punctuation to single hyphens', () => {
    expect(reportFilename('monthly-comparison', undefined)).toBe('monthly-comparison.csv');
    expect(reportFilename('account-ledger', 'FY 2026 / Q1')).toBe('account-ledger-fy-2026-q1.csv');
  });
});

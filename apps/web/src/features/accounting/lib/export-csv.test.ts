import { describe, expect, it } from 'vitest';

import { reportFilename, toCsv } from './export-csv';

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

describe('reportFilename', () => {
  it('slugs the parts into a lower-case .csv name', () => {
    expect(reportFilename('trial-balance', '2026-01-31')).toBe('trial-balance-2026-01-31.csv');
  });

  it('drops empty parts and collapses punctuation to single hyphens', () => {
    expect(reportFilename('monthly-comparison', undefined)).toBe('monthly-comparison.csv');
    expect(reportFilename('account-ledger', 'FY 2026 / Q1')).toBe('account-ledger-fy-2026-q1.csv');
  });
});

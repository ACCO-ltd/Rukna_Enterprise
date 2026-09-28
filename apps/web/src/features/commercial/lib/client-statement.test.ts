import { describe, expect, it } from 'vitest';

import { statementToCsv } from './client-statement';

const label = (key: string) => key;

describe('statementToCsv', () => {
  it('writes the server figures verbatim, one row per line, then the closing balance', () => {
    const csv = statementToCsv(
      {
        projectId: 'p1',
        contractNumber: 'C1',
        clientName: 'Hayat Market',
        currency: 'USD',
        asOf: '2026-09-28T00:00:00Z',
        lines: [
          { date: '2026-06-01T00:00:00Z', kind: 'INVOICE', reference: 'INV-1', description: 'Advance, 40%', debit: '165000.00', credit: null, balance: '165000.00' },
          { date: '2026-06-12T00:00:00Z', kind: 'RECEIPT', reference: 'RCPT-1', description: 'Bank transfer', debit: null, credit: '165000.00', balance: '0.00' },
        ],
        closingBalance: '0.00',
      },
      label,
    );
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('date,kind,reference,description,debit,credit,balance');
    expect(lines[1]).toBe('2026-06-01,INVOICE,INV-1,"Advance, 40%",165000.00,,165000.00');
    expect(lines[2]).toBe('2026-06-12,RECEIPT,RCPT-1,Bank transfer,,165000.00,0.00');
    expect(lines[3]).toBe(',,,closing,,,0.00');
  });

  it('neutralises spreadsheet formulas in text but leaves negative numbers alone', () => {
    const csv = statementToCsv(
      {
        projectId: 'p1',
        contractNumber: null,
        clientName: null,
        currency: 'USD',
        asOf: '',
        lines: [{ date: '2026-06-01', kind: 'CREDIT_NOTE', reference: null, description: '=HYPERLINK("x")', debit: null, credit: '-5.00', balance: '-5.00' }],
        closingBalance: '-5.00',
      },
      label,
    );
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(',-5.00,-5.00');
  });
});

import type { CommercialClientStatementResponse } from '@erp/types';

type StatementLabel = 'date' | 'kind' | 'reference' | 'description' | 'debit' | 'credit' | 'balance' | 'closing' | 'INVOICE' | 'CREDIT_NOTE' | 'RECEIPT';

/**
 * The client statement as CSV. Figures are written exactly as the server sent them (decimal
 * strings) — the running balance is the server's, never re-summed here.
 */
export function statementToCsv(
  statement: CommercialClientStatementResponse,
  label: (key: StatementLabel) => string,
): string {
  const header = [label('date'), label('kind'), label('reference'), label('description'), label('debit'), label('credit'), label('balance')];
  const rows = statement.lines.map((line) => [
    line.date.slice(0, 10),
    label(line.kind),
    line.reference ?? '',
    line.description,
    line.debit ?? '',
    line.credit ?? '',
    line.balance ?? '',
  ]);
  const closing = ['', '', '', label('closing'), '', '', statement.closingBalance ?? ''];
  return [header, ...rows, closing].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function csvCell(value: string): string {
  // Quote anything a spreadsheet would split on; neutralise formula injection (=, +, -, @).
  const safe = /^[=+\-@]/.test(value) && !/^-?\d/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Hands the browser a text file and revokes the object URL straight after. */
export function downloadTextFile(filename: string, contents: string, type = 'text/csv;charset=utf-8;'): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

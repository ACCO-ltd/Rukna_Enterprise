import readXlsxFile from 'read-excel-file/browser';
import Papa from 'papaparse';

/**
 * A spreadsheet read into a header row plus data rows — the shape the mapping step works on.
 *
 * Parsing happens entirely in the browser (Q3): the API never receives a file, only the mapped
 * rows. Every cell is coerced to a trimmed string, because the mapping and the server both treat
 * quantities and rates as decimal *strings* (CONST-BOQ-014) — turning an Excel number cell into a
 * JS number here would be the one place precision could be lost before it is ever validated.
 */
export interface ParsedSheet {
  /** Header-row cell values, in column order. */
  columns: string[];
  /** Data rows (header excluded); each padded/truncated to the header width. */
  rows: string[][];
}

const MAX_ROWS = 20000;

export async function parseSpreadsheet(file: File): Promise<ParsedSheet> {
  const name = file.name.toLowerCase();
  return name.endsWith('.csv') ? parseCsv(file) : parseXlsx(file);
}

async function parseXlsx(file: File): Promise<ParsedSheet> {
  // The browser build returns every worksheet; a BOQ workbook's bill is the first sheet.
  const sheets = await readXlsxFile(file);
  const first = sheets[0]?.data ?? [];
  return toSheet(first as unknown as unknown[][]);
}

function parseCsv(file: File): Promise<ParsedSheet> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: 'greedy',
      complete: (result) => resolve(toSheet(result.data as unknown[][])),
      error: (error) => reject(error),
    });
  });
}

function toSheet(rows: unknown[][]): ParsedSheet {
  const [header = [], ...body] = rows;
  const columns = header.map(cellToString);
  const width = columns.length;
  return {
    columns,
    rows: body.slice(0, MAX_ROWS).map((row) => normalizeRow(row, width)),
  };
}

function normalizeRow(row: unknown[], width: number): string[] {
  const out: string[] = [];
  for (let index = 0; index < width; index += 1) out.push(cellToString(row[index]));
  return out;
}

function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

/**
 * ─── Client-side CSV export for the accounting reports ────────────────────────────
 *
 * The reports are already fully loaded in the browser (there is no server export endpoint),
 * so a CSV is built from the same rows on screen and offered as a download. This keeps the
 * export honest: it is a serialisation of exactly what the reader is looking at, generated at
 * the moment they ask for it, never a second fetch that could differ from the report above it.
 *
 * Money is written as the raw decimal string the API sent — not the locale-formatted display
 * string — so the figures land in a spreadsheet as numbers a `SUM()` can add, rather than
 * "1,234.00 USD" text a spreadsheet reads as zero. Formatting is a display concern; a CSV is
 * for arithmetic.
 */

/** One field of a CSV row: a string, a number, or nothing. Absence becomes an empty cell. */
export type CsvCell = string | number | null | undefined;

/** A plain decimal ("-1234.50") — a number written as text, which a spreadsheet cannot run. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * CSV formula injection: a spreadsheet runs a text cell that starts with `=`, `+`, `-`, `@`, tab
 * or carriage return as a formula, and names, descriptions and references in these exports are
 * user-entered. Such a string cell is prefixed with a single quote so it opens as text. Numbers
 * stay numbers: a `number` cell is never touched, and neither is a string that is just a plain
 * decimal (a negative amount sent as "-1234.50"). Callers should still pass money as numbers.
 */
export function neutraliseFormula(cell: CsvCell): CsvCell {
  if (typeof cell !== 'string' || PLAIN_NUMBER.test(cell)) return cell;
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

/**
 * Escapes a single cell per RFC 4180: wrap in quotes when it holds a comma, a quote or a
 * newline, and double any embedded quote. Everything else is written bare. A string that a
 * spreadsheet would run as a formula is neutralised first (`neutraliseFormula`).
 */
function escapeCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  const text = String(neutraliseFormula(cell));
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Serialises a header row plus body rows into an RFC-4180 CSV string (CRLF line endings). */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(','));
  return lines.join('\r\n');
}

/**
 * Triggers a browser download of `content` as `filename`.
 *
 * A BOM (`﻿`) leads the file so Excel opens UTF-8 without mangling non-ASCII names, and
 * the object URL is revoked after the click so the blob is not retained for the tab's lifetime.
 * No-ops outside the browser (SSR), where there is no document to click.
 */
export function downloadCsv(filename: string, content: string): void {
  if (typeof document === 'undefined') return;

  const blob = new Blob([`﻿${content}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** Builds the CSV and downloads it in one call — the shape every report screen uses. */
export function exportCsv(filename: string, headers: string[], rows: CsvCell[][]): void {
  downloadCsv(filename, toCsv(headers, rows));
}

/**
 * A stable, filesystem-safe filename: `<slug>-<asOfOrRange>.csv`, lower-cased, with spaces and
 * punctuation collapsed to single hyphens. `parts` are joined so a report can stamp its date or
 * range into the name (`trial-balance-2026-01-31.csv`).
 */
export function reportFilename(slug: string, ...parts: (string | null | undefined)[]): string {
  const stamp = parts.filter(Boolean).join('-');
  const base = [slug, stamp].filter(Boolean).join('-');
  return `${base.replace(/[^a-z0-9-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.csv`;
}

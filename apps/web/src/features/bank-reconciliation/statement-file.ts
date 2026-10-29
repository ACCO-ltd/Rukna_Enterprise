import type { ImportStatementLine } from '@erp/types';

import { MONEY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

/**
 * Step 6 — reading a bank statement export into statement lines.
 *
 * Banks export either one signed amount column or separate money-in and money-out columns, and
 * write dates in their own order. The reader matches the columns (`StatementColumns`) and picks the
 * date order; every row is then read here, and a row that cannot be read is reported by its sheet
 * line rather than dropped, because a statement with a silently missing line can never reconcile.
 */
export type StatementField = 'date' | 'description' | 'reference' | 'amount' | 'moneyIn' | 'moneyOut';
export type StatementColumns = Partial<Record<StatementField, number | null>>;
export type DateOrder = 'DMY' | 'MDY' | 'YMD';

const ALIASES: Record<StatementField, string[]> = {
  date: ['date', 'transaction date', 'posting date', 'value date', 'txn date', 'booking date'],
  description: ['description', 'details', 'narrative', 'particulars', 'memo', 'transaction details', 'remarks'],
  reference: ['reference', 'ref', 'cheque', 'cheque no', 'check no', 'transaction id', 'reference no'],
  amount: ['amount', 'value', 'net amount', 'transaction amount'],
  moneyIn: ['credit', 'credits', 'money in', 'deposit', 'deposits', 'paid in', 'in'],
  moneyOut: ['debit', 'debits', 'money out', 'withdrawal', 'withdrawals', 'paid out', 'out'],
};

const normalise = (h: string) => h.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function guessStatementColumns(columns: string[]): StatementColumns {
  const out: StatementColumns = {};
  const taken = new Set<number>();
  for (const field of Object.keys(ALIASES) as StatementField[]) {
    const index = columns.findIndex((c, i) => !taken.has(i) && ALIASES[field].includes(normalise(c)));
    out[field] = index >= 0 ? index : null;
    if (index >= 0) taken.add(index);
  }
  // One signed column wins over a lone in or out column the guess happened to find.
  if (out.amount !== null && out.amount !== undefined) {
    if ((out.moneyIn ?? null) === null || (out.moneyOut ?? null) === null) {
      out.moneyIn = null;
      out.moneyOut = null;
    }
  }
  return out;
}

export function columnsReady(c: StatementColumns): boolean {
  const has = (f: StatementField) => c[f] !== null && c[f] !== undefined;
  return has('date') && has('description') && (has('amount') || (has('moneyIn') && has('moneyOut')));
}

/** "2026-10-05", or "05/10/2026" / "5-10-26" in the chosen order. Returns YYYY-MM-DD or null. */
export function readDate(text: string, order: DateOrder): string | null {
  const t = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  let y: number, m: number, d: number;
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else {
    const parts = t.split(/[/.\-\s]+/).map(Number);
    if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p))) return null;
    if (order === 'YMD') [y, m, d] = parts;
    else if (order === 'MDY') [m, d, y] = parts;
    else [d, m, y] = parts;
    if (y < 100) y += 2000;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Money as a statement shows it: "1,234.50", "(75.00)", "-75", "USD 12.5". Minor units, or null. */
export function readMoney(text: string): number | null {
  // A currency code or sign is stripped only where it sits against the number ("USD12.5", "12.5$").
  let body = text.trim().replace(/[\s,]/g, '').replace(/^([A-Za-z]{3}|\$)(?=[\d(.-])/, '').replace(/(?<=[\d.)])([A-Za-z]{3}|\$)$/, '');
  if (body === '' || body === '-') return 0;
  let negative = false;
  if (/^\(.*\)$/.test(body)) {
    negative = true;
    body = body.slice(1, -1);
  }
  if (body.startsWith('-')) {
    negative = !negative;
    body = body.slice(1);
  }
  if (/[^0-9.]/.test(body)) return null;
  const minor = parseMinorUnits(body, MONEY_SCALE);
  return minor === null ? null : negative ? -minor : minor;
}

export interface ReadStatement {
  lines: ImportStatementLine[];
  /** Sheet line (header = 1) and what is wrong with it. */
  problems: Array<{ line: number; problem: 'date' | 'amount' | 'description' }>;
  firstDate: string | null;
  lastDate: string | null;
  /** Sum of the lines, minor units. */
  netMinor: number;
}

export function readStatement(rows: string[][], c: StatementColumns, order: DateOrder): ReadStatement {
  const lines: ImportStatementLine[] = [];
  const problems: ReadStatement['problems'] = [];
  let netMinor = 0;
  const cell = (row: string[], f: StatementField) => (c[f] === null || c[f] === undefined ? '' : (row[c[f]!] ?? '').trim());
  rows.forEach((row, index) => {
    if (row.every((v) => v.trim() === '')) return;
    const line = index + 2;
    const date = readDate(cell(row, 'date'), order);
    let minor: number | null;
    if (c.amount !== null && c.amount !== undefined) {
      minor = readMoney(cell(row, 'amount'));
    } else {
      const moneyIn = readMoney(cell(row, 'moneyIn'));
      const moneyOut = readMoney(cell(row, 'moneyOut'));
      minor = moneyIn === null || moneyOut === null ? null : Math.abs(moneyIn) - Math.abs(moneyOut);
    }
    const description = cell(row, 'description');
    if (!date) problems.push({ line, problem: 'date' });
    else if (minor === null || minor === 0) problems.push({ line, problem: 'amount' });
    else if (!description) problems.push({ line, problem: 'description' });
    else {
      const reference = cell(row, 'reference');
      lines.push({ transactionDate: date, description, ...(reference ? { reference } : {}), amount: fromMinorUnits(minor, MONEY_SCALE) });
      netMinor += minor;
    }
  });
  const dates = lines.map((l) => l.transactionDate).sort();
  return { lines, problems, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null, netMinor };
}

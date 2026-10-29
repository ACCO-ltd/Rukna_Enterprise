import { Decimal } from '@prisma/client/runtime/library';

/**
 * One movement on a party's account, before it is placed in a period. `debit` and `credit` are the
 * statement's own columns; the balance runs as debit − credit (a client statement: what the client
 * owes). A supplier statement passes `{ creditNormal: true }` so the balance runs credit − debit.
 */
export interface StatementMovement<K extends string = string> {
  date: Date;
  kind: K;
  documentId: string;
  reference: string | null;
  description: string | null;
  debit: Decimal;
  credit: Decimal;
  /** Orders same-day movements: a document before its own reversal. */
  sequence: number;
}

const DAY_MS = 86_400_000;

export interface StatementLine<K extends string = string> {
  date: string;
  kind: K;
  documentId: string;
  reference: string | null;
  description: string | null;
  debit: string | null;
  credit: string | null;
  balance: string;
}

/**
 * AR-3 / AP-3 — places movements on a statement: everything before `from` folds into the opening
 * balance, the period's movements run in date order with a running balance, and later
 * movements are left out. Pure, so the arithmetic is tested without a database.
 */
export function buildStatementLines<K extends string>(
  movements: StatementMovement<K>[],
  from: Date,
  to: Date,
  opts: { creditNormal?: boolean } = {},
): { opening: Decimal; lines: StatementLine<K>[]; debits: Decimal; credits: Decimal; closing: Decimal } {
  const sign = opts.creditNormal ? -1 : 1;
  const net = (m: StatementMovement<K>) => m.debit.minus(m.credit).times(sign);
  const end = new Date(to.getTime() + DAY_MS);
  const sorted = [...movements].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.sequence - b.sequence || a.documentId.localeCompare(b.documentId),
  );
  let opening = new Decimal(0);
  let debits = new Decimal(0);
  let credits = new Decimal(0);
  const lines: StatementLine<K>[] = [];
  let running = new Decimal(0);
  for (const m of sorted) {
    if (m.date < from) {
      opening = opening.plus(net(m));
      continue;
    }
    if (m.date >= end) continue;
    if (lines.length === 0) running = opening;
    running = running.plus(net(m));
    debits = debits.plus(m.debit);
    credits = credits.plus(m.credit);
    lines.push({
      date: m.date.toISOString().slice(0, 10),
      kind: m.kind,
      documentId: m.documentId,
      reference: m.reference,
      description: m.description,
      debit: m.debit.isZero() ? null : m.debit.toFixed(2),
      credit: m.credit.isZero() ? null : m.credit.toFixed(2),
      balance: running.toFixed(2),
    });
  }
  return { opening, lines, debits, credits, closing: opening.plus(debits.minus(credits).times(sign)) };
}

/** Days-past-due buckets for open document balances, as at `asOf`. A document with no due date is current. */
export function ageOpenItems(items: Array<{ dueDate: Date | null; outstanding: Decimal }>, asOf: Date) {
  const buckets = { current: new Decimal(0), d1_30: new Decimal(0), d31_60: new Decimal(0), d61_90: new Decimal(0), d90_plus: new Decimal(0) };
  for (const item of items) {
    if (item.outstanding.lte(0)) continue;
    const late = item.dueDate ? Math.floor((asOf.getTime() - item.dueDate.getTime()) / DAY_MS) : 0;
    const key = late <= 0 ? 'current' : late <= 30 ? 'd1_30' : late <= 60 ? 'd31_60' : late <= 90 ? 'd61_90' : 'd90_plus';
    buckets[key] = buckets[key].plus(item.outstanding);
  }
  return {
    current: buckets.current.toFixed(2),
    d1_30: buckets.d1_30.toFixed(2),
    d31_60: buckets.d31_60.toFixed(2),
    d61_90: buckets.d61_90.toFixed(2),
    d90_plus: buckets.d90_plus.toFixed(2),
  };
}

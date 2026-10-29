import { Decimal } from '@prisma/client/runtime/library';
import type { ClientStatementLine, ClientStatementLineKind } from '@erp/types';

/** One receivables movement, before it is placed in a period: a debit raises what the client owes. */
export interface StatementMovement {
  date: Date;
  kind: Exclude<ClientStatementLineKind, 'OPENING_BALANCE'>;
  documentId: string;
  reference: string | null;
  description: string | null;
  debit: Decimal;
  credit: Decimal;
  /** Orders same-day movements: a document before its own reversal. */
  sequence: number;
}

const DAY_MS = 86_400_000;

/**
 * AR-3 — places movements on a statement: everything before `from` folds into the opening
 * balance, the period's movements run in date order with a running balance, and later
 * movements are left out. Pure, so the arithmetic is tested without a database.
 */
export function buildStatementLines(
  movements: StatementMovement[],
  from: Date,
  to: Date,
): { opening: Decimal; lines: ClientStatementLine[]; debits: Decimal; credits: Decimal; closing: Decimal } {
  const end = new Date(to.getTime() + DAY_MS);
  const sorted = [...movements].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.sequence - b.sequence || a.documentId.localeCompare(b.documentId),
  );
  let opening = new Decimal(0);
  let debits = new Decimal(0);
  let credits = new Decimal(0);
  const lines: ClientStatementLine[] = [];
  let running = new Decimal(0);
  for (const m of sorted) {
    if (m.date < from) {
      opening = opening.plus(m.debit).minus(m.credit);
      continue;
    }
    if (m.date >= end) continue;
    if (lines.length === 0) running = opening;
    running = running.plus(m.debit).minus(m.credit);
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
  return { opening, lines, debits, credits, closing: opening.plus(debits).minus(credits) };
}

/** Days-past-due buckets for open invoice balances, as at `asOf`. An invoice with no due date is current. */
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

import { Decimal } from '@prisma/client/runtime/library';

/**
 * Step 6 — bank reconciliation rules. Pure: no Prisma, no Nest.
 *
 * A statement line and a ledger line on the bank's GL account match when they move the same money
 * the same way (statement amount = ledger debit − credit) within a few days of each other. Matching
 * is one-to-one: a ledger line clears at most one statement line.
 */

/** How far apart (in days) a statement line and its ledger line may be dated and still be suggested. */
export const MATCH_WINDOW_DAYS = 7;

export interface StatementLineFact {
  id: string;
  transactionDate: Date;
  /** Signed: money in positive. */
  amount: Decimal;
}

export interface LedgerLineFact {
  id: string;
  accountingDate: Date;
  /** Debit less credit on the bank account: money in positive. */
  amount: Decimal;
}

export interface Suggestion {
  statementLineId: string;
  journalLineId: string;
  daysApart: number;
}

const DAY = 86_400_000;
export function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / DAY);
}

/**
 * Suggestions for the unmatched lines: for each statement line, the ledger line of the same amount
 * dated closest to it inside the window. A suggestion is made only when it is unambiguous — one
 * closest candidate, which is not also the closest for another statement line of the same amount
 * and date. Anything else is left for a person to match.
 */
export function suggestMatches(statement: StatementLineFact[], ledger: LedgerLineFact[], windowDays = MATCH_WINDOW_DAYS): Suggestion[] {
  const candidatesOf = (s: StatementLineFact) =>
    ledger
      .filter((l) => l.amount.eq(s.amount) && daysBetween(l.accountingDate, s.transactionDate) <= windowDays)
      .map((l) => ({ line: l, days: daysBetween(l.accountingDate, s.transactionDate) }))
      .sort((a, b) => a.days - b.days);

  const proposals: Suggestion[] = [];
  for (const s of statement) {
    const candidates = candidatesOf(s);
    if (candidates.length === 0) continue;
    // Two equally close candidates: which one is this? Not ours to guess.
    if (candidates.length > 1 && candidates[1].days === candidates[0].days) continue;
    proposals.push({ statementLineId: s.id, journalLineId: candidates[0].line.id, daysApart: candidates[0].days });
  }
  // Two statement lines proposing the same ledger line (two identical payments): leave both.
  const claims = new Map<string, number>();
  for (const p of proposals) claims.set(p.journalLineId, (claims.get(p.journalLineId) ?? 0) + 1);
  return proposals.filter((p) => claims.get(p.journalLineId) === 1);
}

/** The statement's own arithmetic: opening plus every line equals closing. */
export function statementAddsUp(opening: Decimal, amounts: Decimal[], closing: Decimal): { adds: boolean; computedClosing: Decimal } {
  const computedClosing = amounts.reduce((sum, a) => sum.plus(a), opening);
  return { adds: computedClosing.eq(closing), computedClosing };
}

export interface ReconciliationFacts {
  /** The bank GL balance (debit − credit) at the statement date. */
  ledgerBalance: Decimal;
  /** Ledger lines up to the statement date that no statement line has cleared (money in positive). */
  uncleared: Decimal[];
  statementClosing: Decimal;
}

/**
 * The reconciliation: the ledger balance, less what the bank has not seen yet (uncleared ledger
 * lines — cheques not presented, deposits in transit), should equal the bank's closing balance.
 */
export function reconcile(f: ReconciliationFacts) {
  const outstanding = f.uncleared.reduce((sum, a) => sum.plus(a), new Decimal(0));
  const adjustedLedger = f.ledgerBalance.minus(outstanding);
  const difference = f.statementClosing.minus(adjustedLedger);
  return { outstanding, adjustedLedger, difference, balanced: difference.isZero() };
}

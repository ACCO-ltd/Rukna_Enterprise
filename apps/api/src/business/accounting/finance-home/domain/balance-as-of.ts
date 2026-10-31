import { Decimal } from '@prisma/client/runtime/library';

/**
 * AG-1 — what was still open on a document (an invoice's balance, a receipt's money on account) at
 * the end of a past day, from what is true today and the dated movements against it.
 *
 * A movement (payment applied, credit note, write-off, refund) counts on a day when it is dated on
 * or before it and was not reversed by then. So the balance on `day` is today's balance, plus the
 * live movements dated after it (they had not happened yet), less the movements that counted on
 * `day` but were reversed since (they have been added back to today's balance).
 *
 * A document reversed after `day` has no balance today to start from; its balance is its total
 * less what counted on `day`. A document posted after `day`, or reversed by then, did not exist.
 */

export interface DatedMovement {
  amount: Decimal;
  date: Date;
  /** The day it was reversed; null while it stands. */
  reversedOn: Date | null;
}

export interface DatedDocument {
  total: Decimal;
  /** Today's open balance (an invoice's outstanding, a receipt's unallocated). */
  openNow: Decimal;
  postedOn: Date;
  reversedOn: Date | null;
  movements: readonly DatedMovement[];
}

const after = (a: Date, b: Date) => a.getTime() > b.getTime();

/** Whether the document stood at the end of `day`. */
export function existedOn(doc: Pick<DatedDocument, 'postedOn' | 'reversedOn'>, day: Date): boolean {
  return !after(doc.postedOn, day) && (doc.reversedOn === null || after(doc.reversedOn, day));
}

/** The document's open balance at the end of `day`; null when it did not stand that day. */
export function balanceOn(doc: DatedDocument, day: Date): Decimal | null {
  if (!existedOn(doc, day)) return null;
  const countedOn = (m: DatedMovement) => !after(m.date, day) && (m.reversedOn === null || after(m.reversedOn, day));
  if (doc.reversedOn !== null) {
    return doc.movements.filter(countedOn).reduce((open, m) => open.minus(m.amount), doc.total);
  }
  return doc.movements.reduce((open, m) => {
    if (m.reversedOn === null && after(m.date, day)) return open.plus(m.amount);
    if (m.reversedOn !== null && !after(m.date, day) && after(m.reversedOn, day)) return open.minus(m.amount);
    return open;
  }, doc.openNow);
}


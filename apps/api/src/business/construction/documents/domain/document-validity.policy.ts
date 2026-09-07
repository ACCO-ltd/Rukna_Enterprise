import { DocumentValidity } from '@erp/types';

/**
 * Whether a controlled document can be relied on today.
 *
 * **Derived on every read, never stored.** A persisted `EXPIRED` is true only until the clock
 * passes the next document's expiry date, and from then on the register is lying until some job
 * runs. There is no job. So validity is a function of two dates and one threshold, computed where
 * it is read, and the only thing the database holds is the dates themselves.
 *
 * The threshold is server-owned for the same reason the ratio guards in Finance are: a "30 days"
 * written into a React component is a product policy nobody agreed to, invisible to the people who
 * set it and impossible to change without a deploy. It is stated back to the client on every
 * summary (`expiringSoonDays`) so the screen can say *why* something is flagged rather than just
 * colouring it orange.
 *
 * `NOT_YET_VALID` is not in the original four states. It is here because `validFrom` exists: a
 * permit that starts next month is not VALID today, and reporting it as VALID would be the
 * register's first falsehood — the exact class of defect the Finance audit spent a phase removing.
 */

export const DEFAULT_EXPIRING_SOON_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DocumentValidityInput {
  validFrom: Date | null;
  expiresAt: Date | null;
}

export interface DocumentValidityResult {
  validity: DocumentValidity;
  /** Whole days until expiry — negative once past it. Null when the document has no expiry. */
  daysUntilExpiry: number | null;
}

/**
 * Both stored dates are `@db.Date`, so they carry no meaningful time. Comparing them against a
 * timestamp would make a document expire at midnight UTC rather than at the end of its last day,
 * which is a day early for anyone east of Greenwich — Mogadishu included. Everything is therefore
 * compared at UTC midnight, on both sides.
 */
function atUtcMidnight(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function deriveValidity(
  input: DocumentValidityInput,
  now: Date = new Date(),
  expiringSoonDays: number = DEFAULT_EXPIRING_SOON_DAYS,
): DocumentValidityResult {
  const today = atUtcMidnight(now);

  // Checked before expiry: a document that has not started cannot be "expiring soon", and saying
  // so would put it in an attention queue that no action can clear.
  if (input.validFrom && atUtcMidnight(input.validFrom) > today) {
    return {
      validity: DocumentValidity.NOT_YET_VALID,
      daysUntilExpiry: input.expiresAt
        ? Math.round((atUtcMidnight(input.expiresAt) - today) / MS_PER_DAY)
        : null,
    };
  }

  // No expiry date is not the same fact as "expires far in the future". A construction drawing
  // never expires; a permit that has simply not had its date entered is a gap in the register.
  // Both read as NO_EXPIRY here, and the register's own attention states are what distinguish
  // them — this policy reports what the dates say and invents nothing.
  if (!input.expiresAt) {
    return { validity: DocumentValidity.NO_EXPIRY, daysUntilExpiry: null };
  }

  const daysUntilExpiry = Math.round((atUtcMidnight(input.expiresAt) - today) / MS_PER_DAY);

  // The last day of validity is a valid day. `expiresAt === today` is EXPIRING_SOON, not EXPIRED.
  if (daysUntilExpiry < 0) {
    return { validity: DocumentValidity.EXPIRED, daysUntilExpiry };
  }
  if (daysUntilExpiry <= expiringSoonDays) {
    return { validity: DocumentValidity.EXPIRING_SOON, daysUntilExpiry };
  }
  return { validity: DocumentValidity.VALID, daysUntilExpiry };
}

/** The validity states that put a document in the register's attention queue. */
export const ATTENTION_VALIDITY: readonly DocumentValidity[] = [
  DocumentValidity.EXPIRED,
  DocumentValidity.EXPIRING_SOON,
];

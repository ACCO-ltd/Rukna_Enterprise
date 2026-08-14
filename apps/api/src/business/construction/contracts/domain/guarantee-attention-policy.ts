import type { GuaranteeStatus } from '@prisma/client';

/**
 * CONST-COM / A7 — Guarantee attention derivation.
 *
 * Separates the stored legal lifecycle (`GuaranteeStatus`: ACTIVE | DISCHARGED | CALLED |
 * EXPIRED | CANCELLED*) from a *derived* attention condition computed from the expiry date
 * against an authoritative backend clock. The browser clock is never authoritative.
 *
 * (*) The schema `GuaranteeStatus` enum still carries a stored `EXPIRED` value for backward
 * compatibility. Going forward, expiry is a derived condition — see ADR-017. We do not
 * migrate the enum here (would require a reviewed migration).
 *
 * PROVISIONAL: the "expiring soon" window is 30 days, taken from the accepted platform
 * default documented in docs/02-architecture/frontend-design.md (guarantee expiring within
 * 30 days is a WARNING signal). Made explicit here and documented as provisional in ADR-017.
 */

export type GuaranteeAttention = 'NONE' | 'EXPIRING_SOON' | 'EXPIRED';

/** PROVISIONAL default — see module doc / ADR-017. */
export const GUARANTEE_EXPIRING_SOON_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Attention only applies to guarantees that are still legally live (ACTIVE). A guarantee
 * that has been DISCHARGED, CALLED, or CANCELLED is settled and needs no expiry attention.
 * A stored EXPIRED status maps directly to EXPIRED attention.
 */
export function deriveGuaranteeAttention(
  expiryDate: Date,
  status: GuaranteeStatus,
  now: Date,
  windowDays: number = GUARANTEE_EXPIRING_SOON_DAYS,
): GuaranteeAttention {
  if (status === 'EXPIRED') return 'EXPIRED';
  if (status !== 'ACTIVE') return 'NONE';

  // Compare on calendar-day boundaries in UTC so a guarantee expiring "today" is not
  // treated as already expired by a few hours.
  const expiryDay = Date.UTC(
    expiryDate.getUTCFullYear(),
    expiryDate.getUTCMonth(),
    expiryDate.getUTCDate(),
  );
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysUntilExpiry = Math.floor((expiryDay - nowDay) / MS_PER_DAY);

  if (daysUntilExpiry < 0) return 'EXPIRED';
  if (daysUntilExpiry <= windowDays) return 'EXPIRING_SOON';
  return 'NONE';
}

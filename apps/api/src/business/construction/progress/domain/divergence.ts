// Pure classification for the cockpit "two percentages compared" signals (physical-vs-cost,
// collection-vs-physical, planned-vs-actual). No Prisma, no NestJS — the service reads the two
// figures and calls this, so the classification is unit-tested directly.

/** Percentage points before a gap counts as a real divergence (cf. ADR-023 CONST-COM-018). */
export const DIVERGENCE_THRESHOLD = 20;

export interface DivergenceResult<P extends string, N extends string> {
  divergence: number | null;
  status: P | N | 'ALIGNED' | 'INSUFFICIENT_DATA';
}

/**
 * `value1 − value2`, banded against `DIVERGENCE_THRESHOLD`: above the band → `positiveStatus`,
 * below it → `negativeStatus`, inside it → `'ALIGNED'`. Either side being `null` (a figure that
 * genuinely cannot be computed yet — no budget baselined, no contract value, no planned curve) is
 * `'INSUFFICIENT_DATA'`, never a comparison against a number nobody agreed.
 *
 * Two recorded zeros are NOT the same as an aligned pair, and are also `'INSUFFICIENT_DATA'`.
 * Before any cost has been incurred and before any work has been built, `value1 − value2 = 0`
 * bands identically to "on track" — but nothing has actually been compared yet. A brand-new
 * project with a budget set and nothing spent would otherwise read "On track" from day one, which
 * is a claim about two numbers that have never moved. This only fires on an *exact* double zero —
 * a real 0.01% on either side is real activity and is classified normally.
 */
export function classifyDivergence<P extends string, N extends string>(
  value1: number | null,
  value2: number | null,
  positiveStatus: P,
  negativeStatus: N,
): DivergenceResult<P, N> {
  if (value1 === null || value2 === null) {
    return { divergence: null, status: 'INSUFFICIENT_DATA' };
  }
  if (value1 === 0 && value2 === 0) {
    return { divergence: null, status: 'INSUFFICIENT_DATA' };
  }
  const diff = value1 - value2;
  const status =
    diff > DIVERGENCE_THRESHOLD
      ? positiveStatus
      : diff < -DIVERGENCE_THRESHOLD
        ? negativeStatus
        : 'ALIGNED';
  return { divergence: Math.round(diff * 100) / 100, status };
}

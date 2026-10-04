import { MONEY_SCALE, QUANTITY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import type { MaterialRequest } from './types';

/**
 * A material request's estimate for the list: the server's `estimatedTotal` when the enriched
 * list read sends it, else Σ requested quantity × estimated unit price over the lines the list
 * already carries. `null` when no line is estimated — an unestimated request is not free, so it
 * never reads as $0.
 */
export function mrEstimatedTotal(request: MaterialRequest): string | null {
  if (request.estimatedTotal !== undefined) return request.estimatedTotal;
  let totalMinor = 0;
  let estimated = false;
  for (const line of request.lines ?? []) {
    const price = parseMinorUnits(line.estimatedUnitPrice ?? null, MONEY_SCALE);
    const quantity = parseMinorUnits(line.requestedQuantity, QUANTITY_SCALE);
    if (price === null || quantity === null) continue;
    estimated = true;
    // qty (scale 3) × price (scale 2) is scale 5; round back to cents.
    totalMinor += Math.round((quantity * price) / 10 ** QUANTITY_SCALE);
  }
  return estimated ? fromMinorUnits(totalMinor, MONEY_SCALE) : null;
}

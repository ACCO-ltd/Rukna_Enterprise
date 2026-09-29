import { apportionUnits, PROGRESS_WEIGHT_DECIMALS } from '@erp/types';

/**
 * Work-package weights as the Plan & setup table edits them (ADR-039 §2: values in a table are
 * edited in the table).
 *
 * Arithmetic is done in integer "units" of the stored precision — 10^-4 of the project, so 1 unit is
 * 0.01% — which is exactly what a percent with two decimal places can say. A stored weight is shown
 * as it is (2dp); nothing untouched is ever re-rounded or re-sent.
 */

/** Units in the whole project: 1.0000 at four places. */
export const WHOLE_UNITS = 10 ** PROGRESS_WEIGHT_DECIMALS;

/** A stored 0..1 weight ("0.2721") in units (2721). */
export function unitsOfWeight(weight: string | number): number {
  const value = Number(weight);
  return Number.isFinite(value) ? Math.round(value * WHOLE_UNITS) : 0;
}

/** A typed percent ("27.21") in units (2721), or null when it is not a percent from 0 to 100. */
export function unitsOfPercent(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value * (WHOLE_UNITS / 100));
}

/** Units as a percent string without float noise or trailing zeros: 2721 → "27.21", 3300 → "33". */
export function percentTextOfUnits(units: number): string {
  return String(Number((units / (WHOLE_UNITS / 100)).toFixed(2)));
}

/** Units as the stored 0..1 fraction the PATCH takes: 2721 → 0.2721. */
export function weightOfUnits(units: number): number {
  return Number((units / WHOLE_UNITS).toFixed(PROGRESS_WEIGHT_DECIMALS));
}

export interface WeightRow {
  id: string;
  /** The stored weight, units. */
  storedUnits: number;
  /** What the user typed, if they touched the row. */
  draft?: string;
}

/** The units a row currently counts for: its valid draft, else what is stored. */
export function currentUnits(row: WeightRow): number {
  if (row.draft === undefined) return row.storedUnits;
  return unitsOfPercent(row.draft) ?? 0;
}

/**
 * "Balance to 100%": new drafts (percent text, by row id) that make the set total exactly 100%.
 *
 * - `scope: 'edited'` rebalances only the rows the user edited; untouched rows keep their stored
 *   value. The edited rows share what is left after the untouched ones, in proportion to what was
 *   typed (evenly when everything typed is 0). Returns null when the untouched rows alone already
 *   exceed 100%, or nothing is edited — there is then nothing the edited rows can do.
 * - `scope: 'all'` rebalances every row in proportion to its current value.
 *
 * Both use the shared largest-remainder helper, so the result sums to exactly 10000 units.
 */
export function balanceTo100(rows: readonly WeightRow[], scope: 'edited' | 'all'): Record<string, string> | null {
  const target = scope === 'all' ? rows : rows.filter((r) => r.draft !== undefined);
  if (target.length === 0) return null;
  const fixedUnits = rows.filter((r) => !target.includes(r)).reduce((sum, r) => sum + r.storedUnits, 0);
  const remaining = WHOLE_UNITS - fixedUnits;
  if (remaining < 0) return null;

  const current = target.map(currentUnits);
  const currentTotal = current.reduce((sum, u) => sum + u, 0);
  const shares = currentTotal > 0 ? current : target.map(() => 1);
  const shareTotal = shares.reduce((sum, s) => sum + s, 0);

  // The fixed rows ride along as one exact share, so the helper's whole (10000) splits into
  // exactly `fixedUnits` for them — an integer with no remainder — and `remaining` for the target.
  const scaled = shares.map((s) => (remaining === 0 ? 0 : (s / shareTotal) * remaining));
  const units = apportionUnits([...scaled, fixedUnits], PROGRESS_WEIGHT_DECIMALS);
  return Object.fromEntries(target.map((row, index) => [row.id, percentTextOfUnits(units[index]!)]));
}

import type { PrismaClient } from '@prisma/client';

/**
 * The unit-of-measure registry's starting set, and the routine that installs it.
 *
 * ─── Why ─────────────────────────────────────────────────────────────────────────
 *
 * Until ADR-039 nothing seeded this registry: it held whatever a procurement administrator had
 * typed in, and a BOQ editor could not read it anyway. The BOQ unit picker now reads it through
 * `GET /units-of-measure`, so a tenant needs the units a construction bill is written in from day
 * one. Exported (like `seedDistricts`) so tenant provisioning and the release migration runner can
 * both call it; `units-of-measure.seed.ts` is the manual entry point.
 *
 * ─── What it will not do ─────────────────────────────────────────────────────────
 *
 * Strictly additive. A standard unit is skipped when the organization already has a unit with the
 * same CODE or the same SYMBOL (case-insensitive), so a tenant that registered tonnes as `T`
 * rather than `TON` does not get a second tonne. It never renames, never reactivates and never
 * deletes: a deactivated unit keeps its row and its code, so it is not re-added either. The
 * registry is administered in Procurement setup, and a seed that overrode a deliberate change
 * would be a data-loss bug wearing a helpful face.
 */
export const STANDARD_UNITS_OF_MEASURE: readonly { code: string; name: string; symbol: string }[] = [
  { code: 'M3', name: 'Cubic metre', symbol: 'm³' },
  { code: 'M2', name: 'Square metre', symbol: 'm²' },
  { code: 'M', name: 'Metre', symbol: 'm' },
  { code: 'KG', name: 'Kilogram', symbol: 'kg' },
  // TON, not T: the code the API reference and the procurement examples already use.
  { code: 'TON', name: 'Tonne', symbol: 't' },
  { code: 'NR', name: 'Number', symbol: 'nr' },
  { code: 'ITEM', name: 'Item', symbol: 'item' },
  // Lump-sum lines: imported bills write their unit as LS (or "sum"). Without these every such
  // line would read as an unknown unit in the BOQ picker.
  { code: 'LS', name: 'Lump sum', symbol: 'LS' },
  { code: 'SUM', name: 'Sum', symbol: 'sum' },
];

/**
 * A symbol as a comparison key: trimmed, lower-cased, whitespace removed, and ASCII powers folded
 * to superscripts, so `m3`, `M3`, `m^3` and `m³` are one unit (and the same for `2`). Without this
 * a tenant that typed `m3` would get a second cubic metre beside it.
 */
// The web's BOQ unit picker matches stored units against the registry with a wider alias set
// (sqm → m², nos → nr, …) built on the same rule: apps/web/src/features/units-of-measure/unit-aliases.ts.
export function normaliseUnitSymbol(symbol: string): string {
  return symbol
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\^?3$/, '³')
    .replace(/\^?2$/, '²');
}

export interface UnitOfMeasureSeedResult {
  created: number;
  alreadyPresent: number;
}

/** Idempotent. Adds only the standard units this organization has neither the code nor the symbol of. */
export async function seedUnitsOfMeasure(
  prisma: Pick<PrismaClient, 'unitOfMeasure'>,
  organizationId: string,
): Promise<UnitOfMeasureSeedResult> {
  const existing = await prisma.unitOfMeasure.findMany({
    where: { organizationId },
    select: { code: true, symbol: true },
  });
  const codes = new Set(existing.map((unit) => unit.code.trim().toLowerCase()));
  const symbols = new Set(existing.map((unit) => normaliseUnitSymbol(unit.symbol)));

  const missing = STANDARD_UNITS_OF_MEASURE.filter(
    (unit) => !codes.has(unit.code.toLowerCase()) && !symbols.has(normaliseUnitSymbol(unit.symbol)),
  );
  // The count Postgres reports, not the length of what was asked for: `skipDuplicates` drops a row
  // that a concurrent run inserted between the read above and this write.
  const created =
    missing.length > 0
      ? (
          await prisma.unitOfMeasure.createMany({
            data: missing.map((unit) => ({ ...unit, organizationId })),
            skipDuplicates: true,
          })
        ).count
      : 0;

  return {
    created,
    alreadyPresent: STANDARD_UNITS_OF_MEASURE.length - created,
  };
}

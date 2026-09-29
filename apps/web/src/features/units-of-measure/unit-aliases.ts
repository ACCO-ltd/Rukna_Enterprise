import type { UnitOfMeasureOption } from '@erp/types';

/**
 * Matching a unit typed into a bill against the unit registry.
 *
 * Imported bills write the same unit many ways — `m2`, `M2`, `m^2`, `sqm`, `sq.m` — and all of
 * them mean the registry's `m²`. Flagging each as "not listed" turned a healthy bill into a wall of
 * warnings, so the picker resolves them to the listed unit first and keeps the warning for units
 * that are genuinely unknown.
 *
 * Read-only: nothing stored is rewritten on read. When a line is saved, the listed symbol is sent.
 *
 * The key rule mirrors `normaliseUnitSymbol` in apps/api/prisma/seeds/units-of-measure.ts (the
 * seed's m3/m^3 → m³ matching), widened with dots removed and the alias table below. Keep the
 * aliases pointing at symbols that seed installs.
 */

/** A comparison key: trimmed, lower-cased, no whitespace or dots, ASCII powers as superscripts. */
export function unitKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s.]+/g, '')
    .replace(/\^?3$/, '³')
    .replace(/\^?2$/, '²');
}

/** Alias key → the key of the standard symbol it means. */
const ALIASES: Record<string, string> = {
  sqm: 'm²',
  cum: 'm³',
  lm: 'm',
  rm: 'm',
  kgs: 'kg',
  ton: 't',
  tons: 't',
  tonne: 't',
  tonnes: 't',
  no: 'nr',
  nos: 'nr',
};

/**
 * The registry unit a stored value means, or null when it is truly unknown.
 *
 * Precedence, first hit wins: the exact symbol; then the symbol, the code and the name by key
 * (`unitKey`), in that order across the whole list; then the alias table. A unit whose symbol
 * matches therefore always beats another whose code or name happens to match — `t` is the tonne
 * whose symbol is `t`, not a unit coded `T`.
 */
export function resolveListedUnit(
  units: readonly UnitOfMeasureOption[],
  value: string | null | undefined,
): UnitOfMeasureOption | null {
  if (!value || !value.trim()) return null;
  const exact = units.find((unit) => unit.symbol === value);
  if (exact) return exact;

  const key = unitKey(value);
  for (const field of ['symbol', 'code', 'name'] as const) {
    const match = units.find((unit) => unitKey(unit[field]) === key);
    if (match) return match;
  }

  const alias = ALIASES[key];
  return alias ? (units.find((unit) => unitKey(unit.symbol) === alias) ?? null) : null;
}

/** The value to show and to save: the listed symbol when the stored unit resolves, else as stored. */
export function canonicalUnit(units: readonly UnitOfMeasureOption[] | undefined, value: string): string {
  if (!units || units.length === 0) return value;
  return resolveListedUnit(units, value)?.symbol ?? value;
}

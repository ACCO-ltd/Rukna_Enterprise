/**
 * A YYYY-MM-DD (or ISO) date → that calendar day at UTC midnight (`@db.Date`), or null when it is
 * not a real day. `new Date('2026-02-31')` rolls over to 3 March; this refuses it instead.
 */
export function parseDateOnly(value: string | undefined | null): Date | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day ? null : d;
}

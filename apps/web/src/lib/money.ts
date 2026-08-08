/**
 * ─── Decimal arithmetic for money and quantities ────────────────────────────────
 *
 * The API sends every monetary and quantity value as a decimal STRING — `"4500000.00"`,
 * `"1200.000"` — precisely so that no float ever touches it. Parsing one with `Number` to add
 * it up reintroduces exactly the error the `Decimal` column exists to prevent.
 *
 * So everything here works in integer minor units: the value scaled by `10^scale` and held as
 * a JS integer. At two decimal places, integers are exact up to `Number.MAX_SAFE_INTEGER`
 * — about 90 trillion — which is five orders of magnitude above ACCO's largest contract. A
 * decimal library would be the first runtime dependency added purely for arithmetic, and it
 * would buy nothing at these magnitudes.
 *
 * ─── Scale is explicit ──────────────────────────────────────────────────────────
 *
 * `scale` is a required argument rather than a default of 2. Money is 2dp; BOQ and
 * procurement quantities are 3dp (`Decimal(18,3)`). An earlier version of this code hardcoded
 * two places, so `toMinorUnits("1.005")` silently returned `100` — the third decimal was
 * dropped without a word. Naming the scale at each call site makes that impossible to do by
 * accident, and `MONEY_SCALE` / `QUANTITY_SCALE` keep the call sites readable.
 *
 * ─── Unparseable input is `null`, not `0` ───────────────────────────────────────
 *
 * `parseMinorUnits` returns `null` when it cannot parse. It does NOT fall back to zero.
 *
 * Zero is a valid amount, so a parse failure that returns it is indistinguishable from a
 * genuine nil — and in a journal editor that means a typo'd debit reads as a balanced line,
 * the client-side ∑Dr = ∑Cr check passes, and the server rejects the journal with an error
 * the user cannot connect to anything they typed.
 *
 * `toMinorUnits` keeps the coalescing form for callers that genuinely want "absent means
 * nothing" — a missing optional amount on a response — and is written in terms of the
 * strict one so there is a single parser.
 */

/** Money is `Decimal(18,2)` throughout the API. */
export const MONEY_SCALE = 2;

/** BOQ and procurement quantities are `Decimal(18,3)`. */
export const QUANTITY_SCALE = 3;

/**
 * `"1234.50"` at scale 2 → `123450`. Returns `null` for anything that is not a decimal
 * number, including `null`, `undefined`, empty and whitespace.
 *
 * Digits beyond `scale` are truncated rather than rounded, matching how the database stores
 * a value that exceeds its column scale.
 */
export function parseMinorUnits(
  value: string | null | undefined,
  scale: number,
): number | null {
  if (value === null || value === undefined) return null;

  const trimmed = value.trim();
  // Anchored so that "12abc", "1.2.3" and "" are rejected rather than partly parsed.
  if (!/^-?\d+(\.\d*)?$|^-?\.\d+$/.test(trimmed)) return null;

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = '0', fraction = ''] = unsigned.split('.');

  const scaled = `${whole}${fraction.padEnd(scale, '0').slice(0, scale)}`;
  const total = Number.parseInt(scaled || '0', 10);
  if (!Number.isSafeInteger(total)) return null;

  return negative ? -total : total;
}

/**
 * As `parseMinorUnits`, but unparseable and absent both read as `0`.
 *
 * Use where a missing value genuinely means nothing — summing an optional amount off a
 * response. Do NOT use to validate user input: see the note at the top of this file.
 */
export function toMinorUnits(value: string | null | undefined, scale: number): number {
  return parseMinorUnits(value, scale) ?? 0;
}

/** `123450` at scale 2 → `"1234.50"`. The inverse, for values sent back to the API. */
export function fromMinorUnits(minor: number, scale: number): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const divisor = 10 ** scale;

  const whole = Math.floor(abs / divisor);
  const fraction = String(abs % divisor).padStart(scale, '0');

  return `${negative ? '-' : ''}${whole}${scale > 0 ? `.${fraction}` : ''}`;
}

/** Sums decimal strings exactly, in minor units. Unparseable entries contribute nothing. */
export function sumMinorUnits(
  values: readonly (string | null | undefined)[],
  scale: number,
): number {
  return values.reduce<number>((sum, v) => sum + toMinorUnits(v, scale), 0);
}
